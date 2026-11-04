/**
 * Integration tests against a real, disposable Postgres. Skipped unless
 * TEST_DATABASE_URL is set — it TRUNCATES the invoicing tables, so never point it at
 * a database you care about.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5544/inv pnpm test
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

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
      `TRUNCATE "Document", "RecurringInvoice", "ClientProfile", "CompanyProfile" CASCADE`,
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
