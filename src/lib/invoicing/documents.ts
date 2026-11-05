/**
 * Invoicing service: everything an agent (MCP) or the app can do with quotations,
 * invoices and delivery orders. Server actions and MCP tools both call these so the
 * rules (numbering, totals, client autofill, due dates) live in one place.
 */
import type {
  ClientProfile,
  CompanyProfile,
  Document,
  DocumentStatus,
  DocumentType,
  Prisma,
} from "@/generated/prisma/client";
import { getAppOrigin } from "@/lib/agent/mcp-oauth";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import { InvalidAddressError, parseAddressList } from "@/lib/invoicing/emailAddress";
import { calcTotals, NEXT_STAGE, type DiscountType, type LineItem } from "@/lib/types";
import type {
  CreateDocumentInput,
  ListDocumentsInput,
  UpdateDocumentInput,
} from "@/lib/invoicing/inputs";
import {
  addDays,
  daysBetween,
  effectiveDueDate,
  formatDateOnly,
  netDaysFromTerms,
  parseDateOnly,
  todayInTimeZone,
} from "@/lib/invoicing/schedule";

/** parseAddressList, but a bad address is an InvoicingError ("invalid") for callers. */
export function checkedAddresses(raw: string | string[] | null | undefined): string[] {
  try {
    return parseAddressList(raw);
  } catch (e) {
    if (e instanceof InvalidAddressError) throw new InvoicingError("invalid", e.message);
    throw e;
  }
}

/**
 * The profile a document is issued (and emailed) from: its own, else the default, else any.
 * The PDF, the sender and the invoice page all resolve it this way.
 */
export async function companyForDocument(doc: { company?: CompanyProfile | null; companyId?: string | null }) {
  if (doc.company) return doc.company;
  if (doc.companyId) {
    const own = await prisma.companyProfile.findUnique({ where: { id: doc.companyId } });
    if (own) return own;
  }
  return (
    (await prisma.companyProfile.findFirst({ where: { isDefault: true } })) ??
    (await prisma.companyProfile.findFirst())
  );
}

export class InvoicingError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Find by cuid or by human number (INV-2026-0007), case-insensitive on the number. */
export async function findDocumentRow(idOrNumber: string): Promise<Document> {
  const ref = idOrNumber.trim();
  const doc =
    (await prisma.document.findUnique({ where: { id: ref } })) ??
    (await prisma.document.findFirst({ where: { number: { equals: ref, mode: "insensitive" } } }));
  if (!doc) throw new InvoicingError("not_found", `No document with id or number "${ref}"`);
  return doc;
}

export async function resolveCompany(
  ref: { companyId?: string | null; companyName?: string | null },
): Promise<CompanyProfile | null> {
  if (ref.companyId) {
    const c = await prisma.companyProfile.findUnique({ where: { id: ref.companyId } });
    if (!c) throw new InvoicingError("not_found", `No company profile with id "${ref.companyId}"`);
    return c;
  }
  if (ref.companyName?.trim()) {
    const c = await prisma.companyProfile.findFirst({
      where: { name: { equals: ref.companyName.trim(), mode: "insensitive" } },
    });
    if (!c) {
      const names = (await prisma.companyProfile.findMany({ select: { name: true } })).map((x) => x.name);
      throw new InvoicingError(
        "not_found",
        `No company profile named "${ref.companyName}". Known: ${names.join(", ") || "none"}`,
      );
    }
    return c;
  }
  return (
    (await prisma.companyProfile.findFirst({ where: { isDefault: true } })) ??
    (await prisma.companyProfile.findFirst({ orderBy: { createdAt: "asc" } }))
  );
}

export async function resolveClient(
  ref: { clientId?: string | null; clientName?: string | null },
): Promise<ClientProfile | null> {
  if (ref.clientId) {
    const c = await prisma.clientProfile.findUnique({ where: { id: ref.clientId } });
    if (!c) throw new InvoicingError("not_found", `No client with id "${ref.clientId}"`);
    return c;
  }
  if (ref.clientName?.trim()) {
    // Saved names sometimes carry dots ("Sdn. Bhd."); compare without them too.
    const wanted = ref.clientName.trim();
    const exact = await prisma.clientProfile.findFirst({
      where: { name: { equals: wanted, mode: "insensitive" } },
    });
    if (exact) return exact;
    const all = await prisma.clientProfile.findMany();
    const norm = (s: string) => s.toLowerCase().replace(/[.\s]+/g, " ").trim();
    return all.find((c) => norm(c.name) === norm(wanted)) ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shapes returned to agents
// ---------------------------------------------------------------------------

type DocWithRefs = Document & { company: CompanyProfile | null };

export function appUrl(path: string): string {
  return `${getAppOrigin()}${path}`;
}

export function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * When an invoice is due and how late it is — the one definition every view uses
 * (lists, summary, the dashboard report). Quotations and DOs have neither.
 */
export function dueInfo(
  d: { type: string; status: string; issueDate: Date; dueDate: Date | null; paymentTerms: string | null },
  today: Date,
): { due: Date | null; daysOverdue: number | null } {
  const due = d.type === "INVOICE" ? effectiveDueDate(d) : null;
  const daysOverdue = due && d.status === "ISSUED" ? Math.max(0, daysBetween(due, today)) : null;
  return { due, daysOverdue };
}

export function summarizeDocument(d: DocWithRefs, today = todayInTimeZone()) {
  const { due, daysOverdue } = dueInfo(d, today);
  return {
    id: d.id,
    number: d.number,
    type: d.type,
    status: d.status,
    issueDate: formatDateOnly(d.issueDate),
    dueDate: d.dueDate ? formatDateOnly(d.dueDate) : null,
    effectiveDueDate: due ? formatDateOnly(due) : null,
    daysOverdue,
    company: d.company ? { id: d.company.id, name: d.company.name } : null,
    currency: d.company?.currency ?? "USD",
    clientId: d.clientId,
    clientName: d.clientName,
    projectTitle: d.projectTitle,
    poNumber: d.poNumber,
    total: money(d.total),
    parentId: d.parentId,
    recurringInvoiceId: d.recurringInvoiceId,
    appUrl: appUrl(`/documents/${d.id}`),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listDocuments(input: ListDocumentsInput) {
  const where: Prisma.DocumentWhereInput = {};
  if (input.type) where.type = input.type;
  if (input.status?.length) where.status = { in: input.status };
  if (input.companyId) where.companyId = input.companyId;
  if (input.clientId) where.clientId = input.clientId;
  if (input.recurringInvoiceId) where.recurringInvoiceId = input.recurringInvoiceId;
  if (input.issuedFrom || input.issuedTo) {
    where.issueDate = {
      ...(input.issuedFrom ? { gte: parseDateOnly(input.issuedFrom) } : {}),
      ...(input.issuedTo ? { lt: addDays(parseDateOnly(input.issuedTo), 1) } : {}),
    };
  }
  if (input.search?.trim()) {
    const q = input.search.trim();
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { clientName: { contains: q, mode: "insensitive" } },
      { projectTitle: { contains: q, mode: "insensitive" } },
      { poNumber: { contains: q, mode: "insensitive" } },
    ];
  }
  if (input.overdueOnly) {
    where.type = "INVOICE";
    where.status = "ISSUED";
  }

  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;
  const today = todayInTimeZone();
  const orderBy: Prisma.DocumentOrderByWithRelationInput[] = [{ issueDate: "desc" }, { number: "desc" }];

  if (input.overdueOnly) {
    // Overdue needs the derived due date, so filter after the fetch.
    const rows = await prisma.document.findMany({ where, orderBy, include: { company: true } });
    const overdue = rows
      .map((r) => summarizeDocument(r, today))
      .filter((s) => (s.daysOverdue ?? 0) > 0)
      .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
    return { total: overdue.length, documents: overdue.slice(offset, offset + limit) };
  }

  const [total, rows] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({ where, orderBy, include: { company: true }, take: limit, skip: offset }),
  ]);
  return { total, documents: rows.map((r) => summarizeDocument(r, today)) };
}

export async function getDocument(idOrNumber: string) {
  const row = await findDocumentRow(idOrNumber);
  const d = await prisma.document.findUniqueOrThrow({
    where: { id: row.id },
    include: {
      company: true,
      client: true,
      parent: { select: { id: true, number: true, type: true, status: true } },
      children: { select: { id: true, number: true, type: true, status: true } },
      recurringInvoice: { select: { id: true, name: true, status: true, nextRunDate: true } },
      emails: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  return {
    ...summarizeDocument(d),
    company: d.company
      ? { id: d.company.id, name: d.company.name, currency: d.company.currency, address: d.company.address }
      : null,
    clientAddress: d.clientAddress,
    clientEmail: d.clientEmail,
    clientPhone: d.clientPhone,
    shipToAttn: d.shipToAttn,
    shipToAddress: d.shipToAddress,
    projectDescription: d.projectDescription,
    items: (d.items as unknown as LineItem[]) ?? [],
    subtotal: money(d.subtotal),
    discountType: d.discountType,
    discountValue: d.discountValue,
    discountAmount: money(d.discountAmount),
    taxRate: d.taxRate,
    taxAmount: money(d.taxAmount),
    paymentTerms: d.paymentTerms,
    notes: d.notes,
    terms: d.terms,
    parent: d.parent,
    children: d.children,
    recurring: d.recurringInvoice
      ? {
          id: d.recurringInvoice.id,
          name: d.recurringInvoice.name,
          status: d.recurringInvoice.status,
          nextRunDate: d.recurringInvoice.nextRunDate ? formatDateOnly(d.recurringInvoice.nextRunDate) : null,
          runDate: d.recurringRunDate ? formatDateOnly(d.recurringRunDate) : null,
        }
      : null,
    nextStage: NEXT_STAGE[d.type] ?? null,
    pdfUrl: appUrl(`/api/pdf/${d.id}`),
    emailPending: d.emailPending,
    emails: d.emails.map((e) => ({
      status: e.status,
      trigger: e.trigger,
      to: e.to,
      cc: e.cc,
      subject: e.subject,
      error: e.error,
      at: e.createdAt.toISOString(),
    })),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** True when an insert lost a race for a document number (unique violation on `number`). */
export function isNumberConflict(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: string; meta?: unknown; message?: string };
  if (err.code !== "P2002") return false;
  // pg adapter: meta.driverAdapterError.cause.constraint.index === "Document_number_key";
  // other engines report meta.target = ["number"].
  const meta = JSON.stringify(err.meta ?? {});
  return /Document_number_key/.test(meta) || /"target":\[?"number"\]?/.test(meta);
}

/**
 * Belt and braces around number allocation. Every create allocates under a per-series
 * advisory lock (nextDocumentNumber with a transaction), so concurrent creates queue rather
 * than collide; this retry only covers a number taken some other way (e.g. a manual edit).
 * `create` must allocate its number inside the closure.
 */
export async function withFreshNumber<T>(create: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await create();
    } catch (e) {
      if (i >= attempts || !isNumberConflict(e)) throw e;
    }
  }
}

function cleanItems(items: LineItem[]): LineItem[] {
  return items.map((i) => ({
    description: String(i.description ?? ""),
    quantity: Number(i.quantity) || 0,
    unitPrice: Number(i.unitPrice) || 0,
  }));
}

function totalsFor(items: LineItem[], taxRate: number, discountType: string, discountValue: number) {
  const dt: DiscountType = discountType === "AMOUNT" ? "AMOUNT" : "PERCENT";
  const t = calcTotals(items, taxRate, dt, discountValue);
  return { subtotal: t.subtotal, discountAmount: t.discountAmount, taxAmount: t.taxAmount, total: t.total };
}

const nullIfBlank = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v);

export async function createDocument(input: CreateDocumentInput) {
  const type: DocumentType = input.type ?? "INVOICE";
  const company = await resolveCompany(input);
  const client = await resolveClient(input);
  // An explicit clientId may carry a custom bill-to name; a name match uses the saved spelling.
  const clientName =
    (input.clientId ? input.clientName?.trim() : undefined) || client?.name || input.clientName?.trim();
  if (!clientName) throw new InvoicingError("invalid", "clientName or clientId is required");

  const issueDate = input.issueDate ? parseDateOnly(input.issueDate) : todayInTimeZone();
  const paymentTerms = nullIfBlank(input.paymentTerms);
  let dueDate: Date | null = null;
  if (input.dueDate) dueDate = parseDateOnly(input.dueDate);
  else if (input.dueDate === undefined && type === "INVOICE") {
    const net = netDaysFromTerms(paymentTerms);
    if (net != null) dueDate = addDays(issueDate, net);
  }

  const items = cleanItems(input.items);
  const taxRate = input.taxRate ?? company?.taxRate ?? 0;
  const discountType = input.discountType ?? "PERCENT";
  const discountValue = input.discountValue ?? 0;

  const created = await withFreshNumber(async () =>
    prisma.$transaction(async (tx) => tx.document.create({
    data: {
      type,
      number: await nextDocumentNumber(type, { db: tx, date: issueDate }),
      status: input.status ?? "DRAFT",
      issueDate,
      dueDate,
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
      items: items as unknown as Prisma.InputJsonValue,
      ...totalsFor(items, taxRate, discountType, discountValue),
      taxRate,
      discountType,
      discountValue,
      paymentTerms,
      notes: input.notes === undefined ? (company?.notes ?? null) : nullIfBlank(input.notes),
      terms: nullIfBlank(input.terms),
    },
    })),
  );
  return getDocument(created.id);
}

export async function updateDocument(input: UpdateDocumentInput) {
  const existing = await findDocumentRow(input.id);
  const data: Prisma.DocumentUncheckedUpdateInput = {};

  if (input.type) data.type = input.type;
  if (input.status) data.status = input.status;
  if (input.issueDate) data.issueDate = parseDateOnly(input.issueDate);
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? parseDateOnly(input.dueDate) : null;
  if (input.companyId) {
    await resolveCompany({ companyId: input.companyId });
    data.companyId = input.companyId;
  }
  if (input.clientId !== undefined) {
    if (input.clientId) {
      const c = await resolveClient({ clientId: input.clientId });
      data.clientId = c!.id;
      // Switching client refreshes the bill-to block unless the caller overrides it.
      data.clientName = input.clientName ?? c!.name;
      data.clientAddress = input.clientAddress !== undefined ? nullIfBlank(input.clientAddress) : c!.address;
      data.clientEmail = input.clientEmail !== undefined ? nullIfBlank(input.clientEmail) : c!.email;
      data.clientPhone = input.clientPhone !== undefined ? nullIfBlank(input.clientPhone) : c!.phone;
    } else {
      data.clientId = null;
    }
  }
  const textFields = [
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
  for (const f of textFields) {
    if (input[f] !== undefined && data[f] === undefined) {
      if (f === "clientName") {
        if (!input.clientName?.trim()) throw new InvoicingError("invalid", "clientName cannot be blank");
        data.clientName = input.clientName.trim();
      } else {
        data[f] = nullIfBlank(input[f]);
      }
    }
  }

  const items = input.items ? cleanItems(input.items) : (existing.items as unknown as LineItem[]);
  const taxRate = input.taxRate ?? existing.taxRate;
  const discountType = input.discountType ?? existing.discountType;
  const discountValue = input.discountValue ?? existing.discountValue;
  if (input.items) data.items = items as unknown as Prisma.InputJsonValue;
  Object.assign(data, totalsFor(items, taxRate, discountType, discountValue), {
    taxRate,
    discountType,
    discountValue,
  });

  await prisma.document.update({ where: { id: existing.id }, data });
  return getDocument(existing.id);
}

export async function setDocumentStatus(idOrNumber: string, status: DocumentStatus) {
  const doc = await findDocumentRow(idOrNumber);
  const data: Prisma.DocumentUpdateInput = { status };
  // Issuing an invoice with no due date fixes one from its terms, so it can go overdue.
  if (status === "ISSUED" && doc.type === "INVOICE" && !doc.dueDate) {
    const net = netDaysFromTerms(doc.paymentTerms);
    if (net != null) data.dueDate = addDays(doc.issueDate, net);
  }
  await prisma.document.update({ where: { id: doc.id }, data });
  return getDocument(doc.id);
}

/** Quotation → Invoice → Delivery Order. Copies everything and links back to the parent. */
export async function convertDocument(idOrNumber: string) {
  const src = await findDocumentRow(idOrNumber);
  const next = NEXT_STAGE[src.type] as DocumentType | null;
  if (!next) throw new InvoicingError("invalid", `${src.type} has no next stage`);
  const created = await withFreshNumber(async () =>
    prisma.$transaction(async (tx) => tx.document.create({
    data: {
      ...copyableFields(src),
      type: next,
      number: await nextDocumentNumber(next, { db: tx, date: todayInTimeZone() }),
      status: "DRAFT",
      issueDate: todayInTimeZone(),
      dueDate: null,
      parentId: src.id,
    },
    })),
  );
  return getDocument(created.id);
}

/** Copy a document as a new one (new number, today's date, DRAFT by default). */
export async function duplicateDocument(
  idOrNumber: string,
  opts: { issueDate?: string; status?: DocumentStatus } = {},
) {
  const src = await findDocumentRow(idOrNumber);
  const issueDate = opts.issueDate ? parseDateOnly(opts.issueDate) : todayInTimeZone();
  const net = src.type === "INVOICE" ? netDaysFromTerms(src.paymentTerms) : null;
  const created = await withFreshNumber(async () =>
    prisma.$transaction(async (tx) => tx.document.create({
    data: {
      ...copyableFields(src),
      type: src.type,
      number: await nextDocumentNumber(src.type, { db: tx, date: issueDate }),
      status: opts.status ?? "DRAFT",
      issueDate,
      dueDate: net != null ? addDays(issueDate, net) : null,
      parentId: src.parentId,
    },
    })),
  );
  return getDocument(created.id);
}

function copyableFields(src: Document) {
  return {
    companyId: src.companyId,
    clientId: src.clientId,
    clientName: src.clientName,
    clientAddress: src.clientAddress,
    clientEmail: src.clientEmail,
    clientPhone: src.clientPhone,
    shipToAttn: src.shipToAttn,
    shipToAddress: src.shipToAddress,
    poNumber: src.poNumber,
    projectTitle: src.projectTitle,
    projectDescription: src.projectDescription,
    items: src.items as Prisma.InputJsonValue,
    subtotal: src.subtotal,
    discountType: src.discountType,
    discountValue: src.discountValue,
    discountAmount: src.discountAmount,
    taxRate: src.taxRate,
    taxAmount: src.taxAmount,
    total: src.total,
    paymentTerms: src.paymentTerms,
    notes: src.notes,
    terms: src.terms,
  };
}

export async function deleteDocument(idOrNumber: string) {
  const doc = await findDocumentRow(idOrNumber);
  // Children keep existing; their parent link is cleared first so the FK can't block.
  await prisma.$transaction([
    prisma.document.updateMany({ where: { parentId: doc.id }, data: { parentId: null } }),
    prisma.document.delete({ where: { id: doc.id } }),
  ]);
  return { deleted: { id: doc.id, number: doc.number } };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export async function billingSummary(input: { companyId?: string; issuedFrom?: string; issuedTo?: string }) {
  const where: Prisma.DocumentWhereInput = { type: { in: ["INVOICE", "QUOTATION"] } };
  if (input.companyId) where.companyId = input.companyId;
  if (input.issuedFrom || input.issuedTo) {
    where.issueDate = {
      ...(input.issuedFrom ? { gte: parseDateOnly(input.issuedFrom) } : {}),
      ...(input.issuedTo ? { lt: addDays(parseDateOnly(input.issuedTo), 1) } : {}),
    };
  }
  const rows = await prisma.document.findMany({ where, include: { company: true } });
  const today = todayInTimeZone();

  type Bucket = {
    company: string;
    currency: string;
    invoiced: number;
    collected: number;
    outstanding: number;
    overdue: number;
    overdueCount: number;
    unpaidCount: number;
    draftInvoices: number;
    openQuotes: number;
    openQuoteCount: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const d of rows) {
    const key = d.company?.id ?? "none";
    const b =
      buckets.get(key) ??
      ({
        company: d.company?.name ?? "(no profile)",
        currency: d.company?.currency ?? "USD",
        invoiced: 0,
        collected: 0,
        outstanding: 0,
        overdue: 0,
        overdueCount: 0,
        unpaidCount: 0,
        draftInvoices: 0,
        openQuotes: 0,
        openQuoteCount: 0,
      } satisfies Bucket);
    if (d.type === "INVOICE") {
      if (d.status === "ISSUED" || d.status === "PAID") b.invoiced += d.total;
      if (d.status === "PAID") b.collected += d.total;
      if (d.status === "DRAFT") b.draftInvoices++;
      if (d.status === "ISSUED") {
        b.outstanding += d.total;
        b.unpaidCount++;
        if (daysBetween(effectiveDueDate(d), today) > 0) {
          b.overdue += d.total;
          b.overdueCount++;
        }
      }
    } else if (d.status === "ISSUED") {
      b.openQuotes += d.total;
      b.openQuoteCount++;
    }
    buckets.set(key, b);
  }
  const byCompany = [...buckets.values()].map((b) => ({
    ...b,
    invoiced: money(b.invoiced),
    collected: money(b.collected),
    outstanding: money(b.outstanding),
    overdue: money(b.overdue),
    openQuotes: money(b.openQuotes),
  }));
  const [activeSchedules, nextScheduled] = await Promise.all([
    prisma.recurringInvoice.count({
      where: { status: "ACTIVE", ...(input.companyId ? { companyId: input.companyId } : {}) },
    }),
    prisma.recurringInvoice.findFirst({
      where: {
        status: "ACTIVE",
        nextRunDate: { not: null },
        ...(input.companyId ? { companyId: input.companyId } : {}),
      },
      orderBy: { nextRunDate: "asc" },
      select: { id: true, name: true, nextRunDate: true },
    }),
  ]);
  return {
    asOf: formatDateOnly(today),
    note: "Invoiced = ISSUED + PAID invoices. Overdue uses the due date, else Net-N terms, else 30 days.",
    byCompany,
    recurring: {
      activeSchedules,
      next: nextScheduled
        ? { id: nextScheduled.id, name: nextScheduled.name, date: formatDateOnly(nextScheduled.nextRunDate!) }
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Clients & company profiles
// ---------------------------------------------------------------------------

export async function listClients(search?: string) {
  const clients = await prisma.clientProfile.findMany({
    where: search?.trim() ? { name: { contains: search.trim(), mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
    include: { _count: { select: { documents: true } } },
  });
  return clients.map(({ _count, ...c }) => ({ ...c, documentCount: _count.documents }));
}

export async function upsertClient(input: {
  id?: string;
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  shipToAttn?: string | null;
  shipToAddress?: string | null;
}) {
  const data = {
    name: input.name.trim(),
    ...(input.address !== undefined ? { address: nullIfBlank(input.address) } : {}),
    ...(input.email !== undefined ? { email: nullIfBlank(input.email) } : {}),
    ...(input.phone !== undefined ? { phone: nullIfBlank(input.phone) } : {}),
    ...(input.shipToAttn !== undefined ? { shipToAttn: nullIfBlank(input.shipToAttn) } : {}),
    ...(input.shipToAddress !== undefined ? { shipToAddress: nullIfBlank(input.shipToAddress) } : {}),
  };
  if (input.id) {
    const exists = await prisma.clientProfile.findUnique({ where: { id: input.id } });
    if (!exists) throw new InvoicingError("not_found", `No client with id "${input.id}"`);
    return prisma.clientProfile.update({ where: { id: input.id }, data });
  }
  return prisma.clientProfile.create({ data });
}

export async function listCompanies() {
  return prisma.companyProfile.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
}

export async function upsertCompany(input: {
  id?: string;
  name?: string;
  address?: string;
  email?: string | null;
  phone?: string | null;
  registration?: string | null;
  taxId?: string | null;
  bankDetails?: string | null;
  currency?: string;
  taxRate?: number;
  notes?: string | null;
  isDefault?: boolean;
  emailFrom?: string | null;
  emailBcc?: string | null;
}) {
  // Validate email settings up front so a typo surfaces here, not at 06:00.
  if (input.emailFrom) {
    const from = checkedAddresses(input.emailFrom);
    if (from.length !== 1) throw new InvoicingError("invalid", "emailFrom must be exactly one address");
  }
  if (input.emailBcc) checkedAddresses(input.emailBcc);
  const { id, isDefault, ...rest } = input;
  const data: Prisma.CompanyProfileUpdateInput = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    (data as Record<string, unknown>)[k] =
      typeof v === "string" && k !== "name" && k !== "address" && k !== "currency" ? nullIfBlank(v) : v;
  }
  if (typeof data.currency === "string") data.currency = data.currency.toUpperCase();
  if (isDefault !== undefined) data.isDefault = isDefault;

  return prisma.$transaction(async (tx) => {
    if (isDefault) await tx.companyProfile.updateMany({ data: { isDefault: false } });
    if (id) {
      const exists = await tx.companyProfile.findUnique({ where: { id } });
      if (!exists) throw new InvoicingError("not_found", `No company profile with id "${id}"`);
      return tx.companyProfile.update({ where: { id }, data });
    }
    if (!input.name?.trim() || !input.address?.trim()) {
      throw new InvoicingError("invalid", "name and address are required to create a company profile");
    }
    return tx.companyProfile.create({
      data: { ...(data as Prisma.CompanyProfileCreateInput), name: input.name.trim(), address: input.address },
    });
  });
}
