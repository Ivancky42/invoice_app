/**
 * Recurring invoices: schedules that issue a copy of a template invoice on a set day.
 *
 * Generation is idempotent and transactional per invoice: the schedule row is locked,
 * the invoice for that slot is created (unique on schedule + date, so it can never be
 * billed twice), and the schedule advances in the same transaction. Missed days (cron
 * outage) are caught up on the next run, each invoice dated its own slot.
 */
import type { Prisma, RecurringInvoice } from "@/generated/prisma/client";
import { nextDocumentNumber } from "@/lib/numbering";
import { sendPendingInvoiceEmails } from "@/lib/invoicing/email";
import { prisma } from "@/lib/prisma";
import { calcTotals, type DiscountType, type LineItem } from "@/lib/types";
import {
  appUrl,
  findDocumentRow,
  withFreshNumber,
  InvoicingError,
  resolveClient,
  resolveCompany,
} from "@/lib/invoicing/documents";
import type {
  CreateRecurringInput,
  RecurringFromDocumentInput,
  UpdateRecurringInput,
} from "@/lib/invoicing/inputs";
import {
  addDays,
  formatDateOnly,
  isBeyondEnd,
  netDaysFromTerms,
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
  parseDateOnly,
  previewOccurrences,
  renderTemplate,
  templatizePeriod,
  toDateOnly,
  todayInTimeZone,
  type ScheduleShape,
} from "@/lib/invoicing/schedule";

/** Most invoices one schedule may catch up in a single run (guards a bad start date). */
export const MAX_CATCH_UP_PER_RUN = 24;

function shapeOf(s: RecurringInvoice): ScheduleShape {
  return {
    frequency: s.frequency,
    interval: s.interval,
    dayOfMonth: s.dayOfMonth,
    startDate: s.startDate,
    endDate: s.endDate,
    maxOccurrences: s.maxOccurrences,
  };
}

const nullIfBlank = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v);

/** Where the schedule stands after `generated` invoices, looking from `from` (inclusive). */
function nextState(shape: ScheduleShape, from: Date, generated: number) {
  const next = nextOccurrenceOnOrAfter(shape, from);
  return isBeyondEnd(shape, next, generated)
    ? { nextRunDate: null, status: "ENDED" as const }
    : { nextRunDate: next, status: "ACTIVE" as const };
}

/**
 * Link an existing invoice to a new schedule as #1 — only if no other schedule has
 * claimed it in the meantime. The conditional update is the claim: two concurrent
 * "make recurring" requests can both pass the earlier read, but only one matches here;
 * the other throws, rolling back its schedule, so the invoice is never billed twice.
 */
async function claimSourceInvoice(
  tx: Prisma.TransactionClient,
  documentId: string,
  number: string,
  scheduleId: string,
  runDate: Date,
) {
  const claimed = await tx.document.updateMany({
    where: { id: documentId, recurringInvoiceId: null },
    data: { recurringInvoiceId: scheduleId, recurringRunDate: runDate },
  });
  if (claimed.count !== 1) {
    throw new InvoicingError("conflict", `${number} already belongs to a recurring schedule`);
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * @param opts.linkDocumentId an existing invoice to adopt as #1 of the series (the
 *   "Make recurring" flow in the app): it counts toward maxOccurrences and the first
 *   generated invoice is the first slot after it.
 */
export async function createRecurringInvoice(
  input: CreateRecurringInput,
  opts: { linkDocumentId?: string } = {},
) {
  const company = await resolveCompany(input);
  const client = await resolveClient(input);
  // An explicit clientId may carry a custom bill-to name; a name match uses the saved spelling.
  const clientName =
    (input.clientId ? input.clientName?.trim() : undefined) || client?.name || input.clientName?.trim();
  if (!clientName) throw new InvoicingError("invalid", "clientName or clientId is required");

  const startDate = parseDateOnly(input.startDate);
  const endDate = input.endDate ? parseDateOnly(input.endDate) : null;
  if (endDate && endDate < startDate) throw new InvoicingError("invalid", "endDate is before startDate");

  const shape: ScheduleShape = {
    frequency: input.frequency ?? "MONTHLY",
    interval: input.interval ?? 1,
    dayOfMonth: input.dayOfMonth ?? null,
    startDate,
    endDate,
    maxOccurrences: input.maxOccurrences ?? null,
  };
  const today = todayInTimeZone();
  const linked = opts.linkDocumentId ? await findDocumentRow(opts.linkDocumentId) : null;
  if (linked && linked.type !== "INVOICE") {
    throw new InvoicingError("invalid", `${linked.number} is a ${linked.type}, not an INVOICE`);
  }
  if (linked?.recurringInvoiceId) {
    throw new InvoicingError("conflict", `${linked.number} already belongs to a recurring schedule`);
  }
  const already = linked ? 1 : 0;
  // Adopting an invoice as #1 continues its series, so a past slot is billed now (as
  // createRecurringFromDocument does) rather than skipped while the invoice still counts.
  let firstFrom = input.backfill || linked || startDate >= today ? startDate : today;
  if (linked && firstFrom <= toDateOnly(linked.issueDate)) firstFrom = addDays(linked.issueDate, 1);
  const state = nextState(shape, firstFrom, already);
  if (!state.nextRunDate) {
    throw new InvoicingError(
      "invalid",
      "This schedule has no billing dates left — check startDate / endDate / maxOccurrences",
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.recurringInvoice.create({
      data: {
        occurrencesGenerated: already,
        lastRunDate: linked ? toDateOnly(linked.issueDate) : null,
        sourceDocumentId: linked?.id ?? null,
        name: input.name.trim(),
        frequency: shape.frequency,
        interval: shape.interval,
        dayOfMonth: shape.dayOfMonth,
        startDate,
        endDate,
        maxOccurrences: shape.maxOccurrences,
        nextRunDate: state.nextRunDate,
        status: "ACTIVE",
        autoIssue: input.autoIssue ?? true,
        autoEmail: input.autoEmail ?? false,
        emailTo: input.emailTo?.trim() || null,
        dueInDays: input.dueInDays ?? null,
        companyId: company?.id ?? null,
        clientId: client?.id ?? null,
        clientName,
        clientAddress: nullIfBlank(input.clientAddress) ?? client?.address ?? null,
        clientEmail: nullIfBlank(input.clientEmail) ?? client?.email ?? null,
        clientPhone: nullIfBlank(input.clientPhone) ?? client?.phone ?? null,
        shipToAttn: nullIfBlank(input.shipToAttn) ?? client?.shipToAttn ?? null,
        shipToAddress: nullIfBlank(input.shipToAddress) ?? client?.shipToAddress ?? null,
        poNumber: nullIfBlank(input.poNumber),
        projectTitle: nullIfBlank(input.projectTitle),
        projectDescription: nullIfBlank(input.projectDescription),
        items: input.items as unknown as Prisma.InputJsonValue,
        taxRate: input.taxRate ?? company?.taxRate ?? 0,
        discountType: input.discountType ?? "PERCENT",
        discountValue: input.discountValue ?? 0,
        paymentTerms: nullIfBlank(input.paymentTerms),
        notes: input.notes === undefined ? (company?.notes ?? null) : nullIfBlank(input.notes),
        terms: nullIfBlank(input.terms),
      },
    });
    if (linked) await claimSourceInvoice(tx, linked.id, linked.number, row.id, toDateOnly(linked.issueDate));
    return row;
  });

  // A schedule that starts today (or backfills) bills now, not at tomorrow's 06:00 run.
  const run = await generateForSchedule(created.id, today);
  return { schedule: await getRecurringInvoice(created.id), generatedNow: run.generated, error: run.error };
}

/**
 * Turn an existing invoice into a recurring schedule. By default the invoice counts as
 * #1 of the series and the first generated one is the next slot after its issue date.
 */
export async function createRecurringFromDocument(input: RecurringFromDocumentInput) {
  const doc = await findDocumentRow(input.documentId);
  if (doc.type !== "INVOICE") throw new InvoicingError("invalid", `${doc.number} is a ${doc.type}, not an INVOICE`);
  if (doc.recurringInvoiceId) {
    throw new InvoicingError("conflict", `${doc.number} already belongs to a recurring schedule (${doc.recurringInvoiceId})`);
  }
  const countTemplate = input.countTemplateAsFirst ?? true;
  const frequency = input.frequency ?? "MONTHLY";
  const interval = input.interval ?? 1;
  const issue = toDateOnly(doc.issueDate);
  const dayOfMonth = input.dayOfMonth ?? (frequency === "WEEKLY" ? null : issue.getUTCDate());

  // Anchor the grid on the template invoice so "every month on its day" lines up with it.
  const anchor = countTemplate ? issue : input.startDate ? parseDateOnly(input.startDate) : issue;
  const shape: ScheduleShape = {
    frequency,
    interval,
    dayOfMonth,
    startDate: anchor,
    endDate: input.endDate ? parseDateOnly(input.endDate) : null,
    maxOccurrences: input.maxOccurrences ?? null,
  };
  const already = countTemplate ? 1 : 0;
  const today = todayInTimeZone();
  // With the template as #1 the series continues from it: a period that already passed
  // (template dated 3 Oct, made recurring on 4 Nov → 3 Nov) is billed now, dated its own
  // slot, rather than silently skipped. An explicit startDate is taken as given. Without
  // the template in the series there is nothing to continue, so start no earlier than today.
  const firstFrom = input.startDate
    ? parseDateOnly(input.startDate)
    : countTemplate
      ? addDays(issue, 1)
      : (() => {
          const next = nextOccurrenceAfter(shape, issue);
          return next < today ? today : next;
        })();
  const state = nextState(shape, firstFrom, already);
  if (!state.nextRunDate) {
    throw new InvoicingError("invalid", "This schedule has no billing dates left — check maxOccurrences / endDate");
  }
  const company = doc.companyId ? await prisma.companyProfile.findUnique({ where: { id: doc.companyId } }) : null;

  const schedule = await prisma.$transaction(async (tx) => {
    const s = await tx.recurringInvoice.create({
      data: {
        name: input.name?.trim() || doc.projectTitle || `${doc.clientName} — ${frequency.toLowerCase()}`,
        frequency,
        interval,
        dayOfMonth,
        startDate: anchor,
        endDate: shape.endDate,
        maxOccurrences: shape.maxOccurrences,
        occurrencesGenerated: already,
        lastRunDate: countTemplate ? issue : null,
        nextRunDate: state.nextRunDate,
        status: "ACTIVE",
        autoIssue: input.autoIssue ?? true,
        autoEmail: input.autoEmail ?? false,
        emailTo: input.emailTo?.trim() || null,
        dueInDays: input.dueInDays ?? null,
        companyId: doc.companyId,
        clientId: doc.clientId,
        clientName: doc.clientName,
        clientAddress: doc.clientAddress,
        clientEmail: doc.clientEmail,
        clientPhone: doc.clientPhone,
        shipToAttn: doc.shipToAttn,
        shipToAddress: doc.shipToAddress,
        poNumber: doc.poNumber,
        projectTitle: doc.projectTitle && templatizePeriod(doc.projectTitle, issue, frequency),
        projectDescription: doc.projectDescription && templatizePeriod(doc.projectDescription, issue, frequency),
        items: ((doc.items as unknown as LineItem[]) ?? []).map((i) => ({
          ...i,
          description: templatizePeriod(String(i.description ?? ""), issue, frequency),
        })) as unknown as Prisma.InputJsonValue,
        taxRate: doc.taxRate ?? company?.taxRate ?? 0,
        discountType: doc.discountType,
        discountValue: doc.discountValue,
        paymentTerms: doc.paymentTerms,
        notes: doc.notes,
        terms: doc.terms,
        sourceDocumentId: doc.id,
      },
    });
    if (countTemplate) await claimSourceInvoice(tx, doc.id, doc.number, s.id, issue);
    return s;
  });

  const run = await generateForSchedule(schedule.id, today);
  return { schedule: await getRecurringInvoice(schedule.id), generatedNow: run.generated, error: run.error };
}

// ---------------------------------------------------------------------------
// Update / delete
// ---------------------------------------------------------------------------

export async function updateRecurringInvoice(input: UpdateRecurringInput) {
  const s = await prisma.recurringInvoice.findUnique({ where: { id: input.id } });
  if (!s) throw new InvoicingError("not_found", `No recurring schedule "${input.id}"`);

  const data: Prisma.RecurringInvoiceUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.autoIssue !== undefined) data.autoIssue = input.autoIssue;
  if (input.autoEmail !== undefined) data.autoEmail = input.autoEmail;
  if (input.emailTo !== undefined) data.emailTo = input.emailTo?.trim() || null;
  if (input.dueInDays !== undefined) data.dueInDays = input.dueInDays;
  if (input.companyId || input.companyName) data.companyId = (await resolveCompany(input))!.id;
  if (input.clientId !== undefined) {
    const c = input.clientId ? await resolveClient({ clientId: input.clientId }) : null;
    data.clientId = c?.id ?? null;
    if (c) {
      data.clientName = input.clientName?.trim() || c.name;
      data.clientAddress = input.clientAddress !== undefined ? nullIfBlank(input.clientAddress) : c.address;
      data.clientEmail = input.clientEmail !== undefined ? nullIfBlank(input.clientEmail) : c.email;
      data.clientPhone = input.clientPhone !== undefined ? nullIfBlank(input.clientPhone) : c.phone;
    }
  }
  const text = [
    "clientName",
    "clientAddress",
    "clientEmail",
    "clientPhone",
    "shipToAttn",
    "shipToAddress",
    "poNumber",
    "projectTitle",
    "projectDescription",
    "paymentTerms",
    "notes",
    "terms",
  ] as const;
  for (const f of text) {
    if (input[f] !== undefined && data[f] === undefined) {
      if (f === "clientName") {
        if (!input.clientName?.trim()) throw new InvoicingError("invalid", "clientName cannot be blank");
        data.clientName = input.clientName.trim();
      } else data[f] = nullIfBlank(input[f]);
    }
  }
  if (input.items) data.items = input.items as unknown as Prisma.InputJsonValue;
  if (input.taxRate !== undefined) data.taxRate = input.taxRate;
  if (input.discountType !== undefined) data.discountType = input.discountType;
  if (input.discountValue !== undefined) data.discountValue = input.discountValue;

  // Schedule timing: recompute the next date only when a timing value actually changed
  // (the app's form re-sends every field on any edit).
  const shape: ScheduleShape = {
    frequency: input.frequency ?? s.frequency,
    interval: input.interval ?? s.interval,
    dayOfMonth: input.dayOfMonth !== undefined ? input.dayOfMonth : s.dayOfMonth,
    startDate: input.startDate ? parseDateOnly(input.startDate) : s.startDate,
    endDate: input.endDate !== undefined ? (input.endDate ? parseDateOnly(input.endDate) : null) : s.endDate,
    maxOccurrences: input.maxOccurrences !== undefined ? input.maxOccurrences : s.maxOccurrences,
  };
  const sameDay = (a: Date | null | undefined, b: Date | null | undefined) =>
    (a ? formatDateOnly(a) : null) === (b ? formatDateOnly(b) : null);
  const timingChanged =
    shape.frequency !== s.frequency ||
    shape.interval !== s.interval ||
    shape.dayOfMonth !== s.dayOfMonth ||
    !sameDay(shape.startDate, s.startDate) ||
    !sameDay(shape.endDate, s.endDate) ||
    shape.maxOccurrences !== s.maxOccurrences;
  if (timingChanged) {
    // Reject edits that would silently end an active schedule, as create does.
    if (shape.endDate && toDateOnly(shape.endDate) < toDateOnly(shape.startDate)) {
      throw new InvoicingError("invalid", "endDate is before startDate");
    }
    if (shape.maxOccurrences != null && shape.maxOccurrences < s.occurrencesGenerated) {
      throw new InvoicingError(
        "invalid",
        `maxOccurrences (${shape.maxOccurrences}) is below the ${s.occurrencesGenerated} invoices already generated — set status ENDED to stop instead`,
      );
    }
    data.frequency = shape.frequency;
    data.interval = shape.interval;
    data.dayOfMonth = shape.dayOfMonth;
    data.startDate = shape.startDate;
    data.endDate = shape.endDate;
    data.maxOccurrences = shape.maxOccurrences;
  }

  const today = todayInTimeZone();
  // Never re-bill a slot already billed.
  const afterLast = s.lastRunDate ? addDays(s.lastRunDate, 1) : shape.startDate;
  // Resuming a paused schedule skips the dates missed while paused.
  const resumeFrom = afterLast > today ? afterLast : today;
  // An active schedule keeps a slot that is due but not yet billed (e.g. the cron missed
  // a day): recompute from that pending date, never past it.
  const pending = s.nextRunDate && toDateOnly(s.nextRunDate) < today ? toDateOnly(s.nextRunDate) : today;
  const activeFrom = afterLast > pending ? afterLast : pending;
  const targetStatus = input.status ?? s.status;

  if (targetStatus === "ENDED") {
    data.status = "ENDED";
    data.nextRunDate = null;
  } else if (targetStatus === "PAUSED") {
    data.status = "PAUSED";
    if (timingChanged) data.nextRunDate = nextState(shape, resumeFrom, s.occurrencesGenerated).nextRunDate;
  } else if (input.status === "ACTIVE" && s.status !== "ACTIVE") {
    const st = nextState(shape, resumeFrom, s.occurrencesGenerated);
    if (!st.nextRunDate) {
      throw new InvoicingError("invalid", "Nothing left to bill — extend endDate or maxOccurrences first");
    }
    Object.assign(data, st);
  } else if (timingChanged) {
    Object.assign(data, nextState(shape, activeFrom, s.occurrencesGenerated));
  }
  data.lastError = null;

  await prisma.recurringInvoice.update({ where: { id: s.id }, data });
  const run = (data.status ?? s.status) === "ACTIVE" ? await generateForSchedule(s.id, today) : null;
  return { schedule: await getRecurringInvoice(s.id), generatedNow: run?.generated ?? [], error: run?.error };
}

export async function deleteRecurringInvoice(id: string) {
  const s = await prisma.recurringInvoice.findUnique({ where: { id } });
  if (!s) throw new InvoicingError("not_found", `No recurring schedule "${id}"`);
  // Generated invoices stay; the FK clears their schedule link.
  await prisma.recurringInvoice.delete({ where: { id } });
  return { deleted: { id: s.id, name: s.name } };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Total of one invoice generated from this schedule's template (before {{…}} filling). */
export function scheduleAmount(
  s: Pick<RecurringInvoice, "items" | "taxRate" | "discountType" | "discountValue">,
): number {
  const items = (s.items as unknown as LineItem[]) ?? [];
  const t = calcTotals(items, s.taxRate, s.discountType === "AMOUNT" ? "AMOUNT" : "PERCENT", s.discountValue);
  return Math.round(t.total * 100) / 100;
}

/** Same query as list_recurring_invoices; shared with the dashboard report. */
export function findSchedules(where?: Prisma.RecurringInvoiceWhereInput, take?: number) {
  return prisma.recurringInvoice.findMany({
    where,
    include: { company: { select: { name: true, currency: true } } },
    orderBy: [{ status: "asc" }, { nextRunDate: "asc" }, { name: "asc" }],
    take,
  });
}

function summarizeSchedule(s: RecurringInvoice & { company?: { name: string; currency: string } | null }) {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    frequency: s.frequency,
    interval: s.interval,
    dayOfMonth: s.dayOfMonth,
    startDate: formatDateOnly(s.startDate),
    endDate: s.endDate ? formatDateOnly(s.endDate) : null,
    maxOccurrences: s.maxOccurrences,
    occurrencesGenerated: s.occurrencesGenerated,
    remaining: s.maxOccurrences == null ? null : Math.max(0, s.maxOccurrences - s.occurrencesGenerated),
    nextRunDate: s.nextRunDate ? formatDateOnly(s.nextRunDate) : null,
    lastRunDate: s.lastRunDate ? formatDateOnly(s.lastRunDate) : null,
    autoIssue: s.autoIssue,
    autoEmail: s.autoEmail,
    emailTo: s.emailTo,
    dueInDays: s.dueInDays,
    company: s.company?.name ?? null,
    companyId: s.companyId,
    currency: s.company?.currency ?? "USD",
    clientId: s.clientId,
    clientName: s.clientName,
    projectTitle: s.projectTitle,
    amountPerInvoice: scheduleAmount(s),
    lastError: s.lastError,
    appUrl: appUrl(`/recurring/${s.id}`),
  };
}

export async function listRecurringInvoices(filter: { status?: ("ACTIVE" | "PAUSED" | "ENDED")[] } = {}) {
  const rows = await findSchedules(filter.status?.length ? { status: { in: filter.status } } : undefined);
  return rows.map(summarizeSchedule);
}

export async function getRecurringInvoice(id: string) {
  const s = await prisma.recurringInvoice.findUnique({
    where: { id },
    include: {
      company: { select: { name: true, currency: true } },
      documents: {
        orderBy: { issueDate: "desc" },
        select: { id: true, number: true, status: true, issueDate: true, total: true, recurringRunDate: true },
      },
    },
  });
  if (!s) throw new InvoicingError("not_found", `No recurring schedule "${id}"`);
  const upcoming =
    s.status === "ACTIVE" && s.nextRunDate
      ? previewOccurrences(shapeOf(s), s.nextRunDate, s.occurrencesGenerated, 6).map(formatDateOnly)
      : [];
  return {
    ...summarizeSchedule(s),
    clientAddress: s.clientAddress,
    clientEmail: s.clientEmail,
    clientPhone: s.clientPhone,
    shipToAttn: s.shipToAttn,
    shipToAddress: s.shipToAddress,
    poNumber: s.poNumber,
    projectDescription: s.projectDescription,
    items: s.items as unknown as LineItem[],
    taxRate: s.taxRate,
    discountType: s.discountType,
    discountValue: s.discountValue,
    paymentTerms: s.paymentTerms,
    notes: s.notes,
    terms: s.terms,
    sourceDocumentId: s.sourceDocumentId,
    upcoming,
    invoices: s.documents.map((d) => ({
      id: d.id,
      number: d.number,
      status: d.status,
      issueDate: formatDateOnly(d.issueDate),
      runDate: d.recurringRunDate ? formatDateOnly(d.recurringRunDate) : null,
      total: Math.round(d.total * 100) / 100,
      appUrl: appUrl(`/documents/${d.id}`),
    })),
  };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export type GeneratedInvoice = {
  scheduleId: string;
  scheduleName: string;
  documentId: string;
  number: string;
  runDate: string;
  status: string;
  total: number;
};

function buildInvoiceData(s: RecurringInvoice, runDate: Date, n: number) {
  const ctx = { frequency: s.frequency, interval: s.interval, date: runDate, n, of: s.maxOccurrences };
  const fill = (t: string | null) => (t == null ? null : renderTemplate(t, ctx));
  const items = ((s.items as unknown as LineItem[]) ?? []).map((i) => ({
    description: renderTemplate(String(i.description ?? ""), ctx),
    quantity: Number(i.quantity) || 0,
    unitPrice: Number(i.unitPrice) || 0,
  }));
  const discountType: DiscountType = s.discountType === "AMOUNT" ? "AMOUNT" : "PERCENT";
  const t = calcTotals(items, s.taxRate, discountType, s.discountValue);
  const dueDays = s.dueInDays ?? netDaysFromTerms(s.paymentTerms);
  return {
    type: "INVOICE" as const,
    status: s.autoIssue ? ("ISSUED" as const) : ("DRAFT" as const),
    issueDate: runDate,
    dueDate: dueDays != null ? addDays(runDate, dueDays) : null,
    companyId: s.companyId,
    clientId: s.clientId,
    clientName: s.clientName,
    clientAddress: s.clientAddress,
    clientEmail: s.clientEmail,
    clientPhone: s.clientPhone,
    shipToAttn: s.shipToAttn,
    shipToAddress: s.shipToAddress,
    poNumber: s.poNumber,
    projectTitle: fill(s.projectTitle),
    projectDescription: fill(s.projectDescription),
    items: items as unknown as Prisma.InputJsonValue,
    subtotal: t.subtotal,
    discountType,
    discountValue: s.discountValue,
    discountAmount: t.discountAmount,
    taxRate: s.taxRate,
    taxAmount: t.taxAmount,
    total: t.total,
    paymentTerms: s.paymentTerms,
    notes: fill(s.notes),
    terms: s.terms,
    recurringInvoiceId: s.id,
    recurringRunDate: runDate,
    // Only issued invoices are emailed; a DRAFT waits for review.
    emailPending: s.autoEmail && s.autoIssue,
  };
}

/** Generate every invoice due for one schedule up to `today` (inclusive). */
export async function generateForSchedule(
  scheduleId: string,
  today: Date = todayInTimeZone(),
): Promise<{
  generated: GeneratedInvoice[];
  ended: boolean;
  error?: string;
  emails?: Awaited<ReturnType<typeof sendPendingInvoiceEmails>>;
}> {
  const generated: GeneratedInvoice[] = [];
  let ended = false;
  try {
    for (let i = 0; i < MAX_CATCH_UP_PER_RUN; i++) {
      const step = await withFreshNumber(() => prisma.$transaction(async (tx) => {
        // Row lock: a concurrent run (cron + "Run now") waits, then sees the advanced state.
        await tx.$queryRaw`SELECT id FROM "RecurringInvoice" WHERE id = ${scheduleId} FOR UPDATE`;
        const s = await tx.recurringInvoice.findUnique({ where: { id: scheduleId } });
        if (!s || s.status !== "ACTIVE" || !s.nextRunDate || toDateOnly(s.nextRunDate) > today) return null;

        const shape = shapeOf(s);
        const runDate = toDateOnly(s.nextRunDate);
        if (isBeyondEnd(shape, runDate, s.occurrencesGenerated)) {
          await tx.recurringInvoice.update({ where: { id: s.id }, data: { status: "ENDED", nextRunDate: null } });
          return { ended: true, doc: null };
        }

        const existing = await tx.document.findUnique({
          where: { recurringInvoiceId_recurringRunDate: { recurringInvoiceId: s.id, recurringRunDate: runDate } },
        });
        const count = s.occurrencesGenerated + (existing ? 0 : 1);
        const doc =
          existing ??
          (await tx.document.create({
            data: {
              ...buildInvoiceData(s, runDate, count),
              number: await nextDocumentNumber("INVOICE", { db: tx, date: runDate }),
            },
          }));

        const next = nextOccurrenceAfter(shape, runDate);
        const done = isBeyondEnd(shape, next, count);
        await tx.recurringInvoice.update({
          where: { id: s.id },
          data: {
            occurrencesGenerated: count,
            lastRunDate: runDate,
            nextRunDate: done ? null : next,
            status: done ? "ENDED" : "ACTIVE",
            lastError: null,
          },
        });
        return {
          ended: done,
          doc: existing
            ? null
            : {
                scheduleId: s.id,
                scheduleName: s.name,
                documentId: doc.id,
                number: doc.number,
                runDate: formatDateOnly(runDate),
                status: doc.status,
                total: Math.round(doc.total * 100) / 100,
              },
        };
      }));
      if (!step) break;
      if (step.doc) generated.push(step.doc);
      if (step.ended) {
        ended = true;
        break;
      }
    }
    return { generated, ended, emails: await emailGenerated(generated) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.recurringInvoice
      .update({ where: { id: scheduleId }, data: { lastError: message.slice(0, 1000) } })
      .catch(() => undefined);
    return { generated, ended, error: message, emails: await emailGenerated(generated) };
  }
}

/** Email what a run just generated (only invoices marked emailPending). Never throws. */
async function emailGenerated(generated: GeneratedInvoice[]) {
  if (generated.length === 0) return undefined;
  try {
    return await sendPendingInvoiceEmails({ documentIds: generated.map((g) => g.documentId) });
  } catch (e) {
    console.error("[recurring] emailing generated invoices failed", e);
    return undefined;
  }
}

/** Run every ACTIVE schedule whose next date is on or before today (business timezone). */
export async function runDueRecurringInvoices(opts: { today?: Date; scheduleId?: string } = {}) {
  const today = opts.today ?? todayInTimeZone();
  const due = await prisma.recurringInvoice.findMany({
    where: {
      status: "ACTIVE",
      nextRunDate: { lte: today },
      ...(opts.scheduleId ? { id: opts.scheduleId } : {}),
    },
    select: { id: true, name: true },
    orderBy: { nextRunDate: "asc" },
  });
  const generated: GeneratedInvoice[] = [];
  const ended: string[] = [];
  const errors: { scheduleId: string; name: string; error: string }[] = [];
  for (const s of due) {
    const r = await generateForSchedule(s.id, today);
    generated.push(...r.generated);
    if (r.ended) ended.push(s.id);
    if (r.error) errors.push({ scheduleId: s.id, name: s.name, error: r.error });
  }
  // Retry auto-emails that failed on an earlier run (generation above already sent its own).
  const emails = await sendPendingInvoiceEmails({ today });
  return { today: formatDateOnly(today), schedulesDue: due.length, generated, ended, errors, emails };
}
