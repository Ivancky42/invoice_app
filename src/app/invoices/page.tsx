import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { DOC_LABELS, formatMoney } from "@/lib/types";
import { listDocuments } from "@/lib/invoicing/documents";
import { listRecurringInvoices } from "@/lib/invoicing/recurring";

export const dynamic = "force-dynamic";

export default async function InvoicesDashboard() {
  const [docs, defaultProfile, counts, overdue, recurring] = await Promise.all([
    prisma.document.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { company: true } }),
    prisma.companyProfile.findFirst({ where: { isDefault: true } }),
    prisma.document.groupBy({ by: ["type"], _count: { _all: true } }),
    // Unpaid invoices only (a handful); overdue needs the derived due date, so it filters in memory.
    listDocuments({ overdueOnly: true, limit: 5 }),
    listRecurringInvoices({ status: ["ACTIVE"] }),
  ]);
  return (
    <div className="space-y-8">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-gray-500">{defaultProfile ? `Default profile: ${defaultProfile.name}` : "Create a company profile in Settings to get started."}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/documents/new?type=QUOTATION" className="btn">New Quotation</Link>
          <Link href="/documents/new?type=INVOICE" className="btn btn-primary">New Invoice</Link>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(["QUOTATION", "INVOICE", "DELIVERY_ORDER"] as const).map((t) => {
          const c = counts.find((x) => x.type === t)?._count._all ?? 0;
          return (
            <Link key={t} href={`/documents?type=${t}`} className="card p-5 hover:shadow-xs transition">
              <div className="text-sm text-gray-500">{DOC_LABELS[t]}s</div>
              <div className="text-3xl font-semibold mt-2">{c}</div>
            </Link>
          );
        })}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-medium">Overdue {overdue.total > 0 && <span className="badge bg-red-100 text-red-700 ml-1">{overdue.total}</span>}</h2>
            <Link href="/documents?type=INVOICE&status=ISSUED" className="text-sm hover:underline">Unpaid invoices</Link>
          </div>
          <div className="divide-y">
            {overdue.documents.length === 0 && <div className="px-5 py-4 text-sm text-gray-500">Nothing overdue.</div>}
            {overdue.documents.map((d) => (
              <Link key={d.id} href={`/documents/${d.id}`} className="px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 text-sm">
                <div>
                  <div className="font-medium">{d.number} <span className="text-gray-500 font-normal">· {d.clientName}</span></div>
                  <div className="text-xs text-red-600">{d.daysOverdue} {d.daysOverdue === 1 ? "day" : "days"} overdue (due {d.effectiveDueDate})</div>
                </div>
                <div className="font-medium">{formatMoney(d.total, d.currency)}</div>
              </Link>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-medium">Upcoming recurring invoices</h2>
            <Link href="/recurring" className="text-sm hover:underline">All schedules</Link>
          </div>
          <div className="divide-y">
            {recurring.length === 0 && (
              <div className="px-5 py-4 text-sm text-gray-500">
                No active schedules. Open an invoice and choose <b>Make recurring</b>.
              </div>
            )}
            {recurring.slice(0, 5).map((r) => (
              <Link key={r.id} href={`/recurring/${r.id}`} className="px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 text-sm">
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-gray-500">
                    {r.clientName} · next {r.nextRunDate ?? "—"} · {r.occurrencesGenerated} of {r.maxOccurrences ?? "∞"}
                  </div>
                </div>
                <div className="font-medium">{formatMoney(r.amountPerInvoice, r.currency)}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-medium">Recent documents</h2>
          <Link href="/documents" className="text-sm hover:underline">View all</Link>
        </div>
        <div className="divide-y">
          {docs.length === 0 && <div className="px-5 py-6 text-sm text-gray-500">No documents yet.</div>}
          {docs.map((d) => (
            <Link key={d.id} href={`/documents/${d.id}`} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50">
              <div>
                <div className="font-medium">{d.number} <span className="text-xs text-gray-500">· {DOC_LABELS[d.type]}</span></div>
                <div className="text-sm text-gray-500">{d.clientName}</div>
              </div>
              <div className="text-right">
                <div className="font-medium">{formatMoney(d.total, d.company?.currency || defaultProfile?.currency || "USD")}</div>
                <div className="text-xs text-gray-500">{new Date(d.issueDate).toLocaleDateString()}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
