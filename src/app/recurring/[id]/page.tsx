import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRecurringInvoice } from "@/lib/invoicing/recurring";
import { InvoicingError } from "@/lib/invoicing/documents";
import { formatMoney, type DiscountType } from "@/lib/types";
import { resendConfigured } from "@/lib/invoicing/email";
import RecurringForm from "../RecurringForm";
import { removeRecurring, runRecurringNow, setRecurringStatus } from "../actions";
import { cadenceLabel, RECURRING_STATUS_COLORS } from "../labels";

export const dynamic = "force-dynamic";

const DOC_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  ISSUED: "bg-blue-100 text-blue-700",
  PAID: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export default async function RecurringDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; error?: string }>;
}) {
  const { id } = await params;
  const { edit, error } = await searchParams;
  let s;
  try {
    s = await getRecurringInvoice(id);
  } catch (e) {
    if (e instanceof InvoicingError && e.code === "not_found") return notFound();
    throw e;
  }

  if (edit) {
    const [companies, clients] = await Promise.all([
      prisma.companyProfile.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
      prisma.clientProfile.findMany({ orderBy: { name: "asc" } }),
    ]);
    return (
      <RecurringForm
        mode="edit"
        companies={companies.map((c) => ({
        id: c.id,
        name: c.name,
        currency: c.currency,
        taxRate: c.taxRate,
        canEmail: Boolean(c.emailFrom && resendConfigured()),
      }))}
        clients={clients.map((c) => ({ id: c.id, name: c.name, address: c.address, email: c.email, phone: c.phone }))}
        initial={{
          id: s.id,
          name: s.name,
          frequency: s.frequency,
          interval: s.interval,
          dayOfMonth: s.dayOfMonth,
          startDate: s.startDate,
          endDate: s.endDate,
          maxOccurrences: s.maxOccurrences,
          autoIssue: s.autoIssue,
          autoEmail: s.autoEmail,
          emailTo: s.emailTo ?? "",
          dueInDays: s.dueInDays,
          companyId: s.companyId,
          clientId: s.clientId,
          clientName: s.clientName,
          clientAddress: s.clientAddress ?? "",
          clientEmail: s.clientEmail ?? "",
          clientPhone: s.clientPhone ?? "",
          shipToAttn: s.shipToAttn ?? "",
          shipToAddress: s.shipToAddress ?? "",
          poNumber: s.poNumber ?? "",
          projectTitle: s.projectTitle ?? "",
          projectDescription: s.projectDescription ?? "",
          items: s.items ?? [],
          taxRate: s.taxRate,
          discountType: (s.discountType as DiscountType) ?? "PERCENT",
          discountValue: s.discountValue,
          paymentTerms: s.paymentTerms ?? "",
          notes: s.notes ?? "",
          terms: s.terms ?? "",
          occurrencesGenerated: s.occurrencesGenerated,
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm text-gray-500"><Link href="/recurring" className="hover:underline">Recurring invoices</Link></div>
          <h1 className="text-2xl font-semibold">{s.name}</h1>
          <div className="mt-1 flex gap-2 items-center flex-wrap text-sm text-gray-500">
            <span className={`badge ${RECURRING_STATUS_COLORS[s.status]}`}>{s.status}</span>
            <span>{cadenceLabel(s.frequency, s.interval, s.dayOfMonth)}</span>
            <span>· {s.autoIssue ? "issued automatically" : "created as draft"}</span>
            {s.autoEmail && <span>· emailed to {s.emailTo || s.clientEmail || "the client"}</span>}
            <span>· {formatMoney(s.amountPerInvoice, s.currency)} each</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn" href={`/recurring/${s.id}?edit=1`}>Edit</Link>
          {s.status === "ACTIVE" && (
            <form action={runRecurringNow}>
              <input type="hidden" name="id" value={s.id} />
              <button className="btn" title="Generate the invoice now if today is a billing date">Run due now</button>
            </form>
          )}
          {s.status !== "ENDED" && (
            <form action={setRecurringStatus}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="status" value={s.status === "ACTIVE" ? "PAUSED" : "ACTIVE"} />
              <button className="btn">{s.status === "ACTIVE" ? "Pause" : "Resume"}</button>
            </form>
          )}
          {s.status !== "ENDED" && (
            <form action={setRecurringStatus}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="status" value="ENDED" />
              <button className="btn">End schedule</button>
            </form>
          )}
          <form action={removeRecurring}>
            <input type="hidden" name="id" value={s.id} />
            <button className="btn btn-danger" title="Generated invoices are kept">Delete</button>
          </form>
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-red-700 bg-red-50">{error}</div>}

      {s.lastError && (
        <div className="card p-3 text-sm text-red-700 bg-red-50">Last run failed: {s.lastError}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4 text-sm space-y-1">
          <div className="text-xs uppercase text-gray-500">Progress</div>
          <div className="text-2xl font-semibold">
            {s.occurrencesGenerated} <span className="text-base text-gray-500 font-normal">of {s.maxOccurrences ?? "∞"}</span>
          </div>
          <div className="text-gray-500">
            Started {s.startDate}
            {s.endDate ? ` · ends ${s.endDate}` : ""}
          </div>
        </div>
        <div className="card p-4 text-sm space-y-1">
          <div className="text-xs uppercase text-gray-500">Bill to</div>
          <div className="font-medium">{s.clientName}</div>
          <div className="text-gray-500">From {s.company ?? "default profile"}</div>
          {s.paymentTerms && <div className="text-gray-500">{s.paymentTerms}</div>}
        </div>
        <div className="card p-4 text-sm">
          <div className="text-xs uppercase text-gray-500 mb-1">Upcoming</div>
          {s.upcoming.length === 0 ? (
            <div className="text-gray-500">{s.status === "PAUSED" ? "Paused." : "Nothing scheduled."}</div>
          ) : (
            <ul className="space-y-0.5">
              {s.upcoming.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 font-medium">Invoices in this series</div>
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {s.invoices.length === 0 && (
              <tr><td className="px-5 py-4 text-gray-500">None yet. The first one is generated on {s.nextRunDate ?? "—"}.</td></tr>
            )}
            {s.invoices.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-5 py-2"><Link href={`/documents/${d.id}`} className="font-medium hover:underline">{d.number}</Link></td>
                <td className="px-5 py-2">{d.issueDate}</td>
                <td className="px-5 py-2"><span className={`badge ${DOC_STATUS_COLORS[d.status]}`}>{d.status}</span></td>
                <td className="px-5 py-2 text-right">{formatMoney(d.total, s.currency)}</td>
                <td className="px-5 py-2 text-right"><a className="text-blue-600 hover:underline" href={`/api/pdf/${d.id}?download=1`}>PDF</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-4 text-sm">
        <div className="text-xs uppercase text-gray-500 mb-2">Template lines</div>
        <ul className="space-y-1">
          {s.items.map((it, i) => (
            <li key={i} className="flex justify-between gap-4">
              <span>{it.description}</span>
              <span className="text-gray-500 whitespace-nowrap">{it.quantity} × {formatMoney(it.unitPrice, s.currency)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
