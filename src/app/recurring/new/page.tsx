import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateOnly, nextOccurrenceAfter, templatizePeriod, todayInTimeZone } from "@/lib/invoicing/schedule";
import type { DiscountType, LineItem } from "@/lib/types";
import RecurringForm, { type RecurringFormInitial } from "../RecurringForm";

export const dynamic = "force-dynamic";

export default async function NewRecurringPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const [companies, clients, source] = await Promise.all([
    prisma.companyProfile.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    prisma.clientProfile.findMany({ orderBy: { name: "asc" } }),
    from ? prisma.document.findUnique({ where: { id: from } }) : Promise.resolve(null),
  ]);

  if (companies.length === 0) {
    return (
      <div className="card p-8 max-w-xl">
        <h1 className="text-xl font-semibold">Create a company profile first</h1>
        <Link href="/settings/new" className="btn btn-primary mt-4">+ New profile</Link>
      </div>
    );
  }
  if (source?.recurringInvoiceId) {
    return (
      <div className="card p-8 max-w-xl space-y-3">
        <h1 className="text-xl font-semibold">{source.number} is already recurring</h1>
        <Link href={`/recurring/${source.recurringInvoiceId}`} className="btn btn-primary">Open its schedule</Link>
      </div>
    );
  }

  const defaultCo = companies.find((c) => c.isDefault) ?? companies[0];
  const today = todayInTimeZone();
  let initial: RecurringFormInitial;

  if (source) {
    const issue = source.issueDate;
    const day = issue.getUTCDate();
    // Default: the next invoice one month after the source, on the same day.
    const next = nextOccurrenceAfter({ frequency: "MONTHLY", interval: 1, dayOfMonth: day, startDate: issue }, issue);
    initial = {
      name: source.projectTitle || `${source.clientName} — monthly`,
      frequency: "MONTHLY",
      interval: 1,
      dayOfMonth: day,
      startDate: formatDateOnly(next < today ? today : next),
      endDate: null,
      maxOccurrences: null,
      autoIssue: true,
      dueInDays: null,
      companyId: source.companyId ?? defaultCo.id,
      clientId: source.clientId,
      clientName: source.clientName,
      clientAddress: source.clientAddress ?? "",
      clientEmail: source.clientEmail ?? "",
      clientPhone: source.clientPhone ?? "",
      shipToAttn: source.shipToAttn ?? "",
      shipToAddress: source.shipToAddress ?? "",
      poNumber: source.poNumber ?? "",
      projectTitle: templatizePeriod(source.projectTitle ?? "", issue),
      projectDescription: templatizePeriod(source.projectDescription ?? "", issue),
      items: ((source.items as unknown as LineItem[]) ?? []).map((i) => ({
        ...i,
        description: templatizePeriod(i.description, issue),
      })),
      taxRate: source.taxRate,
      discountType: (source.discountType as DiscountType) ?? "PERCENT",
      discountValue: source.discountValue,
      paymentTerms: source.paymentTerms ?? "",
      notes: source.notes ?? "",
      terms: source.terms ?? "",
    };
  } else {
    initial = {
      name: "",
      frequency: "MONTHLY",
      interval: 1,
      dayOfMonth: null,
      startDate: formatDateOnly(today),
      endDate: null,
      maxOccurrences: null,
      autoIssue: true,
      dueInDays: null,
      companyId: defaultCo.id,
      clientId: null,
      clientName: "",
      clientAddress: "",
      clientEmail: "",
      clientPhone: "",
      shipToAttn: "",
      shipToAddress: "",
      poNumber: "",
      projectTitle: "",
      projectDescription: "",
      items: [{ description: "Services — {{period}}", quantity: 1, unitPrice: 0 }],
      taxRate: defaultCo.taxRate,
      discountType: "PERCENT",
      discountValue: 0,
      paymentTerms: "Net 30",
      notes: defaultCo.notes ?? "",
      terms: "",
    };
  }

  return (
    <RecurringForm
      mode="create"
      initial={initial}
      companies={companies.map((c) => ({ id: c.id, name: c.name, currency: c.currency, taxRate: c.taxRate }))}
      clients={clients.map((c) => ({ id: c.id, name: c.name, address: c.address, email: c.email, phone: c.phone }))}
      linkDocument={
        source && source.type === "INVOICE"
          ? { id: source.id, number: source.number, issueDate: formatDateOnly(source.issueDate) }
          : undefined
      }
    />
  );
}
