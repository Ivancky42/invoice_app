/**
 * Integration tests against a real, disposable Postgres. Skipped unless
 * TEST_DATABASE_URL is set — it TRUNCATES the invoicing tables, so never point it at
 * a database you care about.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5544/inv pnpm test
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("invoicing against Postgres", () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let docs: typeof import("@/lib/invoicing/documents");
  let rec: typeof import("@/lib/invoicing/recurring");
  let sched: typeof import("@/lib/invoicing/schedule");
  let companyId: string;
  let today: Date;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@/lib/prisma"));
    docs = await import("@/lib/invoicing/documents");
    rec = await import("@/lib/invoicing/recurring");
    sched = await import("@/lib/invoicing/schedule");
    today = sched.todayInTimeZone();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE "InvoiceEmail", "Document", "RecurringInvoice", "ClientProfile", "CompanyProfile" CASCADE`,
    );
    const c = await prisma.companyProfile.create({
      data: { name: "Grumpy Pixels", address: "KL", currency: "MYR", taxRate: 8, isDefault: true },
    });
    companyId = c.id;
    await prisma.clientProfile.create({ data: { name: "Acme Sdn. Bhd.", email: "ap@acme.test" } });
  });

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it("a 6-month schedule bills today, catches up, then ends after 6", async () => {
    const { schedule, generatedNow } = await rec.createRecurringInvoice({
      name: "Acme retainer",
      startDate: iso(today),
      maxOccurrences: 6,
      clientName: "acme sdn bhd",
      paymentTerms: "Net 14",
      items: [{ description: "Retainer {{period}} ({{n}}/{{of}})", quantity: 1, unitPrice: 1000 }],
    });
    expect(generatedNow).toHaveLength(1);
    expect(schedule.clientName).toBe("Acme Sdn. Bhd."); // matched saved client ignoring dots/case
    expect(schedule.company).toBe("Grumpy Pixels");

    const first = await docs.getDocument(generatedNow[0].documentId);
    expect(first.status).toBe("ISSUED");
    expect(first.issueDate).toBe(iso(today));
    expect(first.dueDate).toBe(iso(sched.addDays(today, 14)));
    expect(first.total).toBe(1080); // 8% tax from the company profile
    expect(first.items[0].description).toMatch(/^Retainer \w+ \d{4} \(1\/6\)$/);
    expect(first.clientEmail).toBe("ap@acme.test");

    // Same day again: nothing new.
    expect((await rec.runDueRecurringInvoices({ today })).generated).toHaveLength(0);

    // Cron down for ~3 months: each missed month is billed with its own date.
    const later = sched.addDays(today, 95);
    const caught = await rec.runDueRecurringInvoices({ today: later });
    expect(caught.generated).toHaveLength(3);
    expect(new Set(caught.generated.map((g) => g.runDate)).size).toBe(3);

    const end = await rec.runDueRecurringInvoices({ today: sched.addDays(today, 800) });
    expect(end.generated).toHaveLength(2);
    const after = await rec.getRecurringInvoice(schedule.id);
    expect(after.status).toBe("ENDED");
    expect(after.nextRunDate).toBeNull();
    expect(after.invoices).toHaveLength(6);
    expect(new Set(after.invoices.map((i) => i.number)).size).toBe(6);
  });

  it("concurrent runs never double-bill a slot", async () => {
    const { schedule } = await rec.createRecurringInvoice({
      name: "Indefinite",
      startDate: iso(sched.addDays(today, 1)),
      clientName: "Walk-in",
      items: [{ description: "Hosting", quantity: 1, unitPrice: 50 }],
    });
    const runDay = sched.addDays(today, 40);
    const [a, b] = await Promise.all([
      rec.generateForSchedule(schedule.id, runDay),
      rec.generateForSchedule(schedule.id, runDay),
    ]);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    const count = await prisma.document.count({ where: { recurringInvoiceId: schedule.id } });
    expect(a.generated.length + b.generated.length).toBe(count);
    expect(count).toBe(2); // tomorrow + one month later
  });

  it("a schedule made from an existing invoice counts it as #1 and continues on its day", async () => {
    const src = await docs.createDocument({
      type: "INVOICE",
      status: "ISSUED",
      issueDate: iso(sched.addDays(today, -10)),
      clientName: "Acme Sdn. Bhd.",
      paymentTerms: "Net 30",
      items: [{ description: "Design work", quantity: 2, unitPrice: 500 }],
    });
    expect(src.dueDate).toBe(iso(sched.addDays(today, 20)));
    const { schedule, generatedNow } = await rec.createRecurringFromDocument({
      documentId: src.number,
      maxOccurrences: 3,
    });
    expect(generatedNow).toHaveLength(0);
    expect(schedule.occurrencesGenerated).toBe(1);
    const issueDay = sched.parseDateOnly(src.issueDate).getUTCDate();
    expect(schedule.dayOfMonth).toBe(issueDay);
    expect(schedule.upcoming).toHaveLength(2);
    expect(sched.parseDateOnly(schedule.upcoming[0]) > today).toBe(true);

    const linked = await docs.getDocument(src.id);
    expect(linked.recurring?.id).toBe(schedule.id);
    await expect(rec.createRecurringFromDocument({ documentId: src.id })).rejects.toThrow(/already belongs/);
  });

  it("two concurrent 'make recurring' requests on one invoice leave exactly one schedule", async () => {
    const src = await docs.createDocument({
      type: "INVOICE",
      issueDate: iso(sched.addDays(today, -3)),
      clientName: "Walk-in",
      items: [{ description: "Fee", quantity: 1, unitPrice: 10 }],
    });
    const results = await Promise.allSettled([
      rec.createRecurringFromDocument({ documentId: src.id }),
      rec.createRecurringFromDocument({ documentId: src.id }),
      rec.createRecurringInvoice(
        { name: "Dup", startDate: iso(sched.addDays(today, 5)), clientName: "Walk-in", items: [{ description: "Fee", quantity: 1, unitPrice: 10 }] },
        { linkDocumentId: src.id },
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.recurringInvoice.count()).toBe(1);
    const linked = await prisma.document.findUniqueOrThrow({ where: { id: src.id } });
    const only = await prisma.recurringInvoice.findFirstOrThrow();
    expect(linked.recurringInvoiceId).toBe(only.id);
  });

  it("editing an active schedule keeps a due-but-unbilled date instead of skipping it", async () => {
    const { schedule } = await rec.createRecurringInvoice({
      name: "Missed by cron",
      startDate: iso(sched.addDays(today, 1)),
      clientName: "Walk-in",
      items: [{ description: "Fee", quantity: 1, unitPrice: 10 }],
    });
    // Simulate the cron having missed this schedule's date three days ago.
    const missed = sched.addDays(today, -3);
    await prisma.recurringInvoice.update({ where: { id: schedule.id }, data: { startDate: missed, nextRunDate: missed } });

    // The app's form re-sends every timing field unchanged alongside a notes edit.
    const r = await rec.updateRecurringInvoice({
      id: schedule.id,
      notes: "new notes",
      frequency: "MONTHLY",
      interval: 1,
      dayOfMonth: null,
      startDate: iso(missed),
      endDate: null,
      maxOccurrences: null,
    });
    expect(r.generatedNow.map((g) => g.runDate)).toEqual([iso(missed)]);
    expect(r.schedule.notes).toBe("new notes");
  });

  it("a backdated template continues its series: a period already passed is billed now, dated its slot", async () => {
    const issue = sched.addDays(today, -40);
    const src = await docs.createDocument({
      type: "INVOICE",
      status: "ISSUED",
      issueDate: iso(issue),
      clientName: "Walk-in",
      items: [{ description: "Retainer", quantity: 1, unitPrice: 100 }],
    });
    const { schedule, generatedNow } = await rec.createRecurringFromDocument({ documentId: src.id, maxOccurrences: 6 });
    const shape = { frequency: "MONTHLY" as const, interval: 1, dayOfMonth: issue.getUTCDate(), startDate: issue };
    const second = sched.nextOccurrenceAfter(shape, issue);
    expect(second <= today).toBe(true);
    expect(generatedNow.map((g) => g.runDate)).toEqual([iso(second)]);
    expect(schedule.occurrencesGenerated).toBe(2);
    expect(sched.parseDateOnly(schedule.nextRunDate!) > today).toBe(true);
  });

  it("the app's Make recurring flow (linked invoice, past start) bills the passed slot instead of skipping it", async () => {
    const issue = sched.addDays(today, -40);
    const src = await docs.createDocument({
      type: "INVOICE",
      status: "ISSUED",
      issueDate: iso(issue),
      clientName: "Walk-in",
      items: [{ description: "Retainer", quantity: 1, unitPrice: 100 }],
    });
    const shape = { frequency: "MONTHLY" as const, interval: 1, dayOfMonth: issue.getUTCDate(), startDate: issue };
    const second = sched.nextOccurrenceAfter(shape, issue);
    const { schedule, generatedNow } = await rec.createRecurringInvoice(
      {
        name: "From UI",
        startDate: iso(second),
        dayOfMonth: issue.getUTCDate(),
        maxOccurrences: 6,
        clientName: "Walk-in",
        items: [{ description: "Retainer {{period}}", quantity: 1, unitPrice: 100 }],
      },
      { linkDocumentId: src.id },
    );
    expect(generatedNow.map((g) => g.runDate)).toEqual([iso(second)]);
    expect(schedule.occurrencesGenerated).toBe(2);
  });

  it("billing summary counts only the requested company's recurring schedules", async () => {
    const other = await prisma.companyProfile.create({ data: { name: "Other Co", address: "x", currency: "USD" } });
    await rec.createRecurringInvoice({ name: "Mine", startDate: iso(sched.addDays(today, 9)), clientName: "A", items: [{ description: "x", quantity: 1, unitPrice: 1 }] });
    await rec.createRecurringInvoice({ name: "Theirs", companyId: other.id, startDate: iso(sched.addDays(today, 2)), clientName: "B", items: [{ description: "x", quantity: 1, unitPrice: 1 }] });
    const mine = await docs.billingSummary({ companyId: companyId });
    expect(mine.recurring).toMatchObject({ activeSchedules: 1, next: { name: "Mine" } });
    expect((await docs.billingSummary({})).recurring.activeSchedules).toBe(2);
  });

  describe("auto-email (Resend mocked)", () => {
    let sends: { key: string; body: any }[];
    let attempts: { key: string; body: string }[];
    let failNext: number;
    let hangNext: number;

    beforeEach(async () => {
      sends = [];
      attempts = [];
      failNext = 0;
      hangNext = 0;
      process.env.RESEND_API_KEY = "re_test";
      await prisma.companyProfile.update({
        where: { id: companyId },
        data: {
          emailFrom: "Grumpy Pixels <billing@grumpypixels.my>",
          email: "hello@grumpypixels.my",
          emailCc: "ivan.chewky@gmail.com, trishateh@gmail.com",
          emailBcc: "copy@grumpypixels.my",
        },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          attempts.push({ key: (init.headers as Record<string, string>)["Idempotency-Key"], body: String(init.body) });
          if (hangNext > 0) {
            hangNext--;
            throw new Error("The operation was aborted due to timeout");
          }
          if (failNext > 0) {
            failNext--;
            return new Response(JSON.stringify({ message: "rate limited" }), { status: 429 });
          }
          sends.push({ key: (init.headers as Record<string, string>)["Idempotency-Key"], body: JSON.parse(String(init.body)) });
          return new Response(JSON.stringify({ id: `em_${sends.length}` }), { status: 200 });
        }),
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.RESEND_API_KEY;
    });

    const schedule = (extra: Record<string, unknown> = {}) =>
      rec.createRecurringInvoice({
        name: "Emailed retainer",
        startDate: iso(today),
        maxOccurrences: 3,
        clientName: "Acme Sdn. Bhd.",
        paymentTerms: "Net 30",
        autoEmail: true,
        items: [{ description: "Retainer {{period}}", quantity: 1, unitPrice: 500 }],
        ...extra,
      });

    it("emails the generated invoice with its PDF, once, from billing@ with replies to the company", async () => {
      const { generatedNow } = await schedule();
      expect(sends).toHaveLength(1);
      const [{ key, body }] = sends;
      expect(key).toBe(`recurring-invoice/${generatedNow[0].documentId}`);
      expect(body).toMatchObject({
        from: "Grumpy Pixels <billing@grumpypixels.my>",
        to: ["ap@acme.test"],
        bcc: ["copy@grumpypixels.my"],
        reply_to: ["hello@grumpypixels.my"],
      });
      expect(body.attachments[0].filename).toBe(`${generatedNow[0].number}.pdf`);
      expect(Buffer.from(body.attachments[0].content, "base64").subarray(0, 5).toString()).toBe("%PDF-");
      const doc = await docs.getDocument(generatedNow[0].documentId);
      expect(doc.emailPending).toBe(false);
      expect(doc.emails).toEqual([expect.objectContaining({ status: "SENT", trigger: "recurring" })]);
      // A later run doesn't send it again.
      await rec.runDueRecurringInvoices({ today });
      expect(sends).toHaveLength(1);
    });

    it("a failed send is recorded and retried on the next run", async () => {
      failNext = 1;
      const { generatedNow, schedule: s } = await schedule({ emailTo: "billing@acme.test, ops@acme.test" });
      expect(sends).toHaveLength(0);
      const after = await rec.getRecurringInvoice(s.id);
      expect(after.lastError).toMatch(/failed: Email not sent: Resend 429: rate limited/);
      expect((await docs.getDocument(generatedNow[0].documentId)).emailPending).toBe(true);

      const run = await rec.runDueRecurringInvoices({ today });
      expect(run.emails.sent.map((e) => e.number)).toEqual([generatedNow[0].number]);
      expect(sends[0].body.to).toEqual(["billing@acme.test", "ops@acme.test"]);
      const doc = await docs.getDocument(generatedNow[0].documentId);
      expect(doc.emails.map((e) => e.status)).toEqual(["SENT", "FAILED"]);
    });

    it("never emails an invoice issued more than 7 days ago, and never emails ones made before auto-email", async () => {
      failNext = 1;
      const { generatedNow, schedule: s } = await schedule();
      // Pretend the failed one is old.
      await prisma.document.update({ where: { id: generatedNow[0].documentId }, data: { issueDate: sched.addDays(today, -8) } });
      const run = await rec.runDueRecurringInvoices({ today });
      expect(run.emails.sent).toHaveLength(0);
      expect(run.emails.dropped).toHaveLength(1);
      expect(sends).toHaveLength(0);
      expect((await rec.getRecurringInvoice(s.id)).lastError).toMatch(/was not emailed/);

      // An invoice that existed before (like one made recurring) is not pending → never auto-sent.
      const old = await docs.createDocument({ status: "ISSUED", clientName: "Acme Sdn. Bhd.", items: [{ description: "x", quantity: 1, unitPrice: 1 }] });
      await rec.runDueRecurringInvoices({ today });
      expect(sends).toHaveLength(0);
      expect((await docs.getDocument(old.id)).emailPending).toBe(false);
    });

    it("an unconfirmed send (timeout) is retried with an identical request inside 24h, never after", async () => {
      hangNext = 1;
      const { generatedNow, schedule: s } = await schedule();
      expect(sends).toHaveLength(0);
      const doc = await docs.getDocument(generatedNow[0].documentId);
      expect(doc.emails[0]).toMatchObject({ status: "FAILED" });
      expect(doc.emails[0].error).toMatch(/^\[unconfirmed\]/);

      // Inside the idempotency window: retried with the same key AND byte-identical body
      // (deterministic PDF), so Resend would deduplicate if the first one did go out.
      const { sendPendingInvoiceEmails } = await import("@/lib/invoicing/email");
      hangNext = 1;
      await sendPendingInvoiceEmails({ now: new Date(Date.now() + 60 * 60 * 1000) });
      expect(attempts).toHaveLength(2);
      expect(attempts[1].key).toBe(attempts[0].key);
      expect(attempts[1].body).toBe(attempts[0].body);

      // After the window: not retried, flagged for a human.
      const late = await sendPendingInvoiceEmails({ now: new Date(Date.now() + 25 * 60 * 60 * 1000) });
      expect(attempts).toHaveLength(2);
      expect(late.dropped[0].reason).toMatch(/couldn't be confirmed/);
      expect((await rec.getRecurringInvoice(s.id)).lastError).toMatch(/check Resend/);
    });

    it("once Resend accepts, a bookkeeping failure is not reported as a failed send, and it's never re-sent", async () => {
      const { sendInvoiceEmail, sendPendingInvoiceEmails } = await import("@/lib/invoicing/email");
      const d = await docs.createDocument({ clientName: "Acme Sdn. Bhd.", items: [{ description: "x", quantity: 1, unitPrice: 1 }] });
      // Recording the SENT row fails once, right after Resend accepted the email.
      const spy = vi
        .spyOn(prisma.invoiceEmail, "create")
        .mockImplementationOnce((() => Promise.reject(new Error("db blip"))) as never);
      const r = await sendInvoiceEmail(d.id, { trigger: "app" });
      spy.mockRestore();
      expect(r.sent).toBe(true);
      expect(r.status).toBe("ISSUED");
      expect((await docs.getDocument(d.id)).emails).toHaveLength(0); // nothing claims it failed

      // A pending invoice that already has a recorded successful send is cleared, not re-sent.
      const { generatedNow } = await schedule();
      const sentBefore = sends.length;
      await prisma.document.update({ where: { id: generatedNow[0].documentId }, data: { emailPending: true } });
      await sendPendingInvoiceEmails();
      expect(sends.length).toBe(sentBefore);
      expect((await docs.getDocument(generatedNow[0].documentId)).emailPending).toBe(false);
    });

    it("the 24h window runs from the FIRST unconfirmed attempt, not the latest retry or refusal", async () => {
      hangNext = 1;
      const { generatedNow } = await schedule();
      const docId = generatedNow[0].documentId;
      const first = await prisma.invoiceEmail.findFirstOrThrow({ where: { documentId: docId } });
      // Backdate the first (unconfirmed) attempt 26h, then add later failures 14h and 2h ago:
      // one unconfirmed retry and one clean refusal.
      const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
      await prisma.invoiceEmail.update({ where: { id: first.id }, data: { createdAt: hoursAgo(26) } });
      await prisma.invoiceEmail.createMany({
        data: [
          { documentId: docId, status: "FAILED", trigger: "recurring", to: "ap@acme.test", subject: "s", error: "[unconfirmed] timeout", createdAt: hoursAgo(14) },
          { documentId: docId, status: "FAILED", trigger: "recurring", to: "ap@acme.test", subject: "s", error: "Resend 422: bad", createdAt: hoursAgo(2) },
        ],
      });
      const { sendPendingInvoiceEmails } = await import("@/lib/invoicing/email");
      const before = attempts.length;
      const r = await sendPendingInvoiceEmails();
      expect(attempts.length).toBe(before); // not re-sent
      expect(r.dropped[0].reason).toMatch(/couldn't be confirmed/);
    });

    it("one attempt per invoice per run; run results include sends made during generation; Run now stays in its schedule", async () => {
      const other = await schedule({ name: "Other", startDate: iso(sched.addDays(today, 1)) });
      const mine = await rec.createRecurringInvoice({
        name: "Mine",
        startDate: iso(sched.addDays(today, 1)),
        clientName: "Acme Sdn. Bhd.",
        autoEmail: true,
        items: [{ description: "Fee", quantity: 1, unitPrice: 10 }],
      });
      expect(sends).toHaveLength(0);
      failNext = 1; // the first send of the run fails
      const tomorrow = sched.addDays(today, 1);
      const run = await rec.runDueRecurringInvoices({ today: tomorrow, scheduleId: mine.schedule.id });
      expect(run.generated).toHaveLength(1);
      expect(attempts).toHaveLength(1); // failed once, not retried again in the same run
      expect(run.emails.failed).toHaveLength(1);
      const run2 = await rec.runDueRecurringInvoices({ today: tomorrow, scheduleId: mine.schedule.id });
      expect(run2.emails.sent.map((e) => e.number)).toEqual([run.generated[0].number]);
      // "Other"'s invoice due tomorrow wasn't generated or emailed by Mine's Run now.
      expect((await rec.getRecurringInvoice(other.schedule.id)).invoices).toHaveLength(0);

      const all = await rec.runDueRecurringInvoices({ today: tomorrow });
      expect(all.emails.sent).toHaveLength(1); // Other's, sent during generation, is reported
    });

    it("refuses cancelled documents and records refused attempts; bad setups are rejected on save", async () => {
      const { sendInvoiceEmail } = await import("@/lib/invoicing/email");
      const d = await docs.createDocument({ status: "CANCELLED", clientName: "Acme Sdn. Bhd.", items: [{ description: "x", quantity: 1, unitPrice: 1 }] });
      await expect(sendInvoiceEmail(d.id, { trigger: "agent" })).rejects.toThrow(/CANCELLED/);
      expect((await docs.getDocument(d.id)).status).toBe("CANCELLED");
      await expect(sendInvoiceEmail(d.id, { trigger: "agent", to: "nope" })).rejects.toThrow(/CANCELLED|Not an email/);
      expect((await docs.getDocument(d.id)).emails.map((e) => e.status)).toEqual(["FAILED", "FAILED"]);

      await expect(schedule({ emailTo: "billing@acme,com" })).rejects.toThrow(/Not an email/);
      await prisma.companyProfile.update({ where: { id: companyId }, data: { emailFrom: null } });
      await expect(schedule()).rejects.toThrow(/Email from/);
      const plain = await schedule({ autoEmail: false, startDate: iso(sched.addDays(today, 3)) });
      await expect(rec.updateRecurringInvoice({ id: plain.schedule.id, autoEmail: true })).rejects.toThrow(/Email from/);
    });

    it("draft schedules don't auto-email; emailing a draft by hand sends it and marks it ISSUED", async () => {
      await schedule({ autoIssue: false });
      expect(sends).toHaveLength(0);
      const { sendInvoiceEmail } = await import("@/lib/invoicing/email");
      const draft = await docs.createDocument({
        clientName: "Acme Sdn. Bhd.",
        paymentTerms: "Net 14",
        items: [{ description: "x", quantity: 1, unitPrice: 1 }],
      });
      expect(draft.status).toBe("DRAFT");
      expect(draft.dueDate).toBe(iso(sched.addDays(today, 14))); // set from terms on create
      await prisma.document.update({ where: { id: draft.id }, data: { dueDate: null } });

      const r = await sendInvoiceEmail(draft.id, { trigger: "app" });
      expect(r.status).toBe("ISSUED");
      const after = await docs.getDocument(draft.id);
      expect(after.status).toBe("ISSUED");
      expect(after.dueDate).toBe(iso(sched.addDays(today, 14))); // re-derived when issued

      await prisma.companyProfile.update({ where: { id: companyId }, data: { emailFrom: null } });
      await expect(sendInvoiceEmail(draft.id, { trigger: "app" })).rejects.toThrow(/Email from/);
    });

    it("always CCs the company list on top of the client's or sender's CC, without duplicates", async () => {
      const { sendInvoiceEmail } = await import("@/lib/invoicing/email");
      const d = await docs.createDocument({ status: "ISSUED", clientName: "Acme Sdn. Bhd.", items: [{ description: "x", quantity: 1, unitPrice: 1 }] });

      await sendInvoiceEmail(d.id, { trigger: "agent" });
      expect(sends.at(-1)!.body.to).toEqual(["ap@acme.test"]);
      expect(sends.at(-1)!.body.cc).toEqual(["ivan.chewky@gmail.com", "trishateh@gmail.com"]);
      expect(sends.at(-1)!.body.bcc).toEqual(["copy@grumpypixels.my"]);

      // A per-email CC adds to the company list rather than replacing it.
      await sendInvoiceEmail(d.id, { trigger: "app", cc: "boss@acme.test" });
      expect(sends.at(-1)!.body.cc).toEqual(["boss@acme.test", "ivan.chewky@gmail.com", "trishateh@gmail.com"]);

      // Clearing the per-email CC still keeps the company's.
      await sendInvoiceEmail(d.id, { trigger: "app", cc: "" });
      expect(sends.at(-1)!.body.cc).toEqual(["ivan.chewky@gmail.com", "trishateh@gmail.com"]);

      // Someone already on To isn't copied again.
      await sendInvoiceEmail(d.id, { trigger: "app", to: "Ivan.Chewky@gmail.com" });
      expect(sends.at(-1)!.body.cc).toEqual(["trishateh@gmail.com"]);
    });

    it("uses the client's invoice recipients for manual and automatic sends (the Person Edge setup)", async () => {
      const { sendInvoiceEmail } = await import("@/lib/invoicing/email");
      const client = await prisma.clientProfile.findFirstOrThrow({ where: { name: "Acme Sdn. Bhd." } });
      await docs.upsertClient({
        id: client.id,
        name: client.name,
        invoiceEmailTo: "xinjie@acme.test",
        invoiceEmailCc: "ben@acme.test, meisze@acme.test, siang@acme.test, cailin@acme.test",
      });
      const expectedCc = [
        "ben@acme.test",
        "meisze@acme.test",
        "siang@acme.test",
        "cailin@acme.test",
        "ivan.chewky@gmail.com",
        "trishateh@gmail.com",
      ];

      const d = await docs.createDocument({ status: "ISSUED", clientName: "Acme Sdn. Bhd.", items: [{ description: "x", quantity: 1, unitPrice: 1 }] });
      expect(d.clientEmail).toBe("ap@acme.test"); // the printed bill-to email is unchanged

      // The confirmation dialog's preview is exactly what the send then posts to Resend.
      const { previewInvoiceEmail } = await import("@/lib/invoicing/email");
      const before = await prisma.invoiceEmail.count({ where: { documentId: d.id } });
      const preview = await previewInvoiceEmail(d.id, { message: "Hi Xinjie" });
      expect(await prisma.invoiceEmail.count({ where: { documentId: d.id } })).toBe(before); // nothing recorded
      const sendsBefore = sends.length;

      await sendInvoiceEmail(d.id, { trigger: "app", message: "Hi Xinjie" });
      expect(sends.length).toBe(sendsBefore + 1);
      const sent = sends.at(-1)!.body;
      expect(sent.to).toEqual(["xinjie@acme.test"]);
      expect(sent.cc).toEqual(expectedCc);
      expect(preview.to).toEqual(sent.to);
      expect(preview.cc).toEqual(sent.cc);
      expect(preview.bcc).toEqual(sent.bcc ?? []);
      expect(preview.from).toBe(sent.from);
      expect(preview.subject).toBe(sent.subject);
      expect(preview.html).toBe(sent.html);
      expect(preview.attachment).toBe(sent.attachments[0].filename);

      // Auto-email from a schedule without its own "send to" uses the same recipients.
      await schedule();
      expect(sends.at(-1)!.body.to).toEqual(["xinjie@acme.test"]);
      expect(sends.at(-1)!.body.cc).toEqual(expectedCc);

      await expect(docs.upsertClient({ id: client.id, name: client.name, invoiceEmailCc: "ben@acme,test" })).rejects.toThrow(/Not an email/);
    });
  });

  it("concurrent creates never collide on a document number", async () => {
    const made = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        docs.createDocument({ clientName: "Walk-in", items: [{ description: `Job ${i}`, quantity: 1, unitPrice: 1 }] }),
      ),
    );
    expect(new Set(made.map((d) => d.number)).size).toBe(12);
  });

  it("pause stops generation; resume skips the paused dates", async () => {
    const { schedule } = await rec.createRecurringInvoice({
      name: "Pausable",
      startDate: iso(today),
      clientName: "Walk-in",
      items: [{ description: "Fee", quantity: 1, unitPrice: 10 }],
    });
    await rec.updateRecurringInvoice({ id: schedule.id, status: "PAUSED" });
    expect((await rec.runDueRecurringInvoices({ today: sched.addDays(today, 70) })).generated).toHaveLength(0);
    const resumed = await rec.updateRecurringInvoice({ id: schedule.id, status: "ACTIVE" });
    expect(resumed.schedule.status).toBe("ACTIVE");
    expect(sched.parseDateOnly(resumed.schedule.nextRunDate!) > today).toBe(true);
    expect(resumed.schedule.occurrencesGenerated).toBe(1);
  });

  it("billing report rows: due/overdue computed server-side, filtered by company name", async () => {
    const other = await prisma.companyProfile.create({ data: { name: "Other Co", address: "x", currency: "USD" } });
    const late = await docs.createDocument({
      type: "INVOICE",
      status: "ISSUED",
      issueDate: iso(sched.addDays(today, -40)),
      paymentTerms: "Net 30",
      clientName: "Acme Sdn. Bhd.",
      items: [{ description: "Work", quantity: 1, unitPrice: 100 }],
    });
    await docs.createDocument({ companyId: other.id, clientName: "Elsewhere", items: [{ description: "x", quantity: 1, unitPrice: 1 }] });
    await rec.createRecurringInvoice({
      name: "Retainer",
      startDate: iso(sched.addDays(today, 3)),
      clientName: "Walk-in",
      items: [{ description: "Fee", quantity: 2, unitPrice: 50 }],
    });
    const { billingReport } = await import("@/lib/invoicing/report");

    const d = await billingReport({ view: "documents", companies: ["grumpy pixels"] });
    expect(d.cut).toBe(false);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({
      number: late.number,
      company: "Grumpy Pixels",
      due_date: iso(sched.addDays(today, -10)),
      days_overdue: 10,
      total: 108,
      recurring: false,
    });
    expect((await billingReport({ view: "documents" })).rows).toHaveLength(2);

    const r = await billingReport({ view: "recurring", companies: ["Grumpy Pixels"] });
    expect(r.rows).toEqual([
      expect.objectContaining({ name: "Retainer", status: "ACTIVE", next_run: iso(sched.addDays(today, 3)), generated: 0, per_invoice: 108 }),
    ]);
    expect((await billingReport({ view: "recurring", companies: ["Other Co"] })).rows).toHaveLength(0);
  });

  it("records the paid date as status changes, and the report gives days to pay and email status", async () => {
    const inv = await docs.createDocument({
      status: "ISSUED",
      issueDate: iso(sched.addDays(today, -20)),
      clientName: "Acme Sdn. Bhd.",
      items: [{ description: "Work", quantity: 1, unitPrice: 100 }],
    });
    expect(inv.paidDate).toBeNull();

    // Marking it paid records today; a given date wins; a future one is refused.
    expect((await docs.setDocumentStatus(inv.id, "PAID")).paidDate).toBe(iso(today));
    expect((await docs.setDocumentStatus(inv.id, "PAID", { paidDate: iso(sched.addDays(today, -5)) })).paidDate).toBe(
      iso(sched.addDays(today, -5)),
    );
    await expect(docs.setDocumentStatus(inv.id, "PAID", { paidDate: iso(sched.addDays(today, 1)) })).rejects.toThrow(
      /future/,
    );
    await expect(docs.setDocumentStatus(inv.id, "ISSUED", { paidDate: iso(today) })).rejects.toThrow(/PAID/);
    // Editing a paid invoice keeps its date; re-marking it paid without a date keeps it too.
    expect((await docs.updateDocument({ id: inv.id, notes: "thanks" })).paidDate).toBe(iso(sched.addDays(today, -5)));
    expect((await docs.setDocumentStatus(inv.id, "PAID")).paidDate).toBe(iso(sched.addDays(today, -5)));

    const { billingReport } = await import("@/lib/invoicing/report");
    const docRow = (rows: object[], number: string) =>
      (rows as Record<string, unknown>[]).find((r) => r.number === number)!;
    let row = docRow((await billingReport({ view: "documents" })).rows, inv.number);
    expect(row).toMatchObject({ status: "PAID", paid_date: iso(sched.addDays(today, -5)), days_to_pay: 15, email_status: null });

    // Paid before dates were recorded (null): edits and re-marking keep it undated; a date sets it.
    await prisma.document.update({ where: { id: inv.id }, data: { paidAt: null } });
    expect((await docs.updateDocument({ id: inv.id, notes: "edited" })).paidDate).toBeNull();
    expect((await docs.setDocumentStatus(inv.id, "PAID")).paidDate).toBeNull();
    expect((await docs.setDocumentStatus(inv.id, "PAID", { paidDate: iso(sched.addDays(today, -5)) })).paidDate).toBe(
      iso(sched.addDays(today, -5)),
    );

    // Back to issued clears it; created paid (agent) defaults to today or takes paidDate.
    expect((await docs.setDocumentStatus(inv.id, "ISSUED")).paidDate).toBeNull();
    const paid = await docs.createDocument({
      status: "PAID",
      issueDate: iso(sched.addDays(today, -3)),
      paidDate: iso(sched.addDays(today, -1)),
      clientName: "Acme Sdn. Bhd.",
      items: [{ description: "Work", quantity: 1, unitPrice: 100 }],
    });
    expect(paid.paidDate).toBe(iso(sched.addDays(today, -1)));
    expect((await docs.updateDocument({ id: paid.id, status: "ISSUED" })).paidDate).toBeNull();

    // Email status follows the latest attempt; emailed_at is the last successful send.
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
    await prisma.invoiceEmail.createMany({
      data: [
        { documentId: inv.id, status: "SENT", trigger: "app", to: "a@acme.test", subject: "s", providerId: "p1", createdAt: at(2) },
        { documentId: inv.id, status: "FAILED", trigger: "app", to: "a@acme.test", subject: "s", error: "Resend 403: domain not verified", createdAt: at(1) },
      ],
    });
    row = docRow((await billingReport({ view: "documents" })).rows, inv.number);
    expect(row).toMatchObject({
      paid_date: null,
      days_to_pay: null,
      email_status: "FAILED",
      emailed_at: iso(sched.todayInTimeZone(at(2))),
      email_error: "Resend 403: domain not verified",
    });
  });

  it("document lifecycle: status, overdue, convert, duplicate, delete, summary", async () => {
    const q = await docs.createDocument({
      type: "QUOTATION",
      clientName: "Acme Sdn. Bhd.",
      items: [{ description: "Build", quantity: 1, unitPrice: 2000 }],
    });
    expect(q.number).toMatch(/^QUO-\d{4}-0001$/);
    const inv = await docs.convertDocument(q.id);
    expect(inv.type).toBe("INVOICE");
    expect(inv.parent?.id).toBe(q.id);

    const old = await docs.updateDocument({
      id: inv.number,
      issueDate: iso(sched.addDays(today, -45)),
      paymentTerms: "Net 30",
      items: [{ description: "Build", quantity: 1, unitPrice: 3000 }],
    });
    expect(old.total).toBe(3240);
    const issued = await docs.setDocumentStatus(old.id, "ISSUED");
    expect(issued.daysOverdue).toBe(15);

    const overdue = await docs.listDocuments({ overdueOnly: true });
    expect(overdue.documents.map((d) => d.id)).toEqual([old.id]);
    const summary = await docs.billingSummary({});
    expect(summary.byCompany[0]).toMatchObject({ outstanding: 3240, overdue: 3240, overdueCount: 1 });

    await docs.setDocumentStatus(old.id, "PAID");
    expect((await docs.listDocuments({ overdueOnly: true })).total).toBe(0);

    const dup = await docs.duplicateDocument(old.id);
    expect(dup.status).toBe("DRAFT");
    expect(dup.number).not.toBe(old.number);

    await docs.deleteDocument(q.id); // parent of the invoice: link is cleared, invoice stays
    expect((await docs.getDocument(old.id)).parent).toBeNull();
    expect((await docs.listDocuments({ search: "acme" })).total).toBe(2);
  });
});
