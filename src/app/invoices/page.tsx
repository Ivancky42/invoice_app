import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { DOC_LABELS, formatMoney } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InvoicesDashboard() {
  const [docs, defaultProfile] = await Promise.all([
    prisma.document.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { company: true } }),
    prisma.companyProfile.findFirst({ where: { isDefault: true } }),
  ]);
  const counts = await prisma.document.groupBy({ by: ["type"], _count: { _all: true } });
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
            <Link key={t} href={`/documents?type=${t}`} className="card p-5 hover:shadow-sm transition">
              <div className="text-sm text-gray-500">{DOC_LABELS[t]}s</div>
              <div className="text-3xl font-semibold mt-2">{c}</div>
            </Link>
          );
        })}
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
