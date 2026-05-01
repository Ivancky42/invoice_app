import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { DOC_LABELS, formatMoney } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  ISSUED: "bg-blue-100 text-blue-700",
  PAID: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const where = type && DOC_LABELS[type] ? { type: type as any } : {};
  const [docs, defaultProfile] = await Promise.all([
    prisma.document.findMany({ where, orderBy: { createdAt: "desc" }, include: { company: true } }),
    prisma.companyProfile.findFirst({ where: { isDefault: true } }),
  ]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <div className="flex gap-2">
          <Link href="/documents/new?type=QUOTATION" className="btn">New Quotation</Link>
          <Link href="/documents/new?type=INVOICE" className="btn">New Invoice</Link>
          <Link href="/documents/new?type=DELIVERY_ORDER" className="btn">New DO</Link>
        </div>
      </div>

      <div className="flex gap-2 text-sm">
        <Link href="/documents" className={`btn ${!type ? "btn-primary" : ""}`}>All</Link>
        {(["QUOTATION", "INVOICE", "DELIVERY_ORDER"] as const).map((t) => (
          <Link key={t} href={`/documents?type=${t}`} className={`btn ${type === t ? "btn-primary" : ""}`}>{DOC_LABELS[t]}</Link>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2 font-medium">Number</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {docs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No documents.</td></tr>
            )}
            {docs.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-2"><Link className="font-medium hover:underline" href={`/documents/${d.id}`}>{d.number}</Link></td>
                <td className="px-4 py-2">{DOC_LABELS[d.type]}</td>
                <td className="px-4 py-2">{d.clientName}{d.company ? <span className="text-xs text-gray-400"> · {d.company.name}</span> : null}</td>
                <td className="px-4 py-2">{new Date(d.issueDate).toLocaleDateString()}</td>
                <td className="px-4 py-2"><span className={`badge ${STATUS_COLORS[d.status]}`}>{d.status}</span></td>
                <td className="px-4 py-2 text-right">{formatMoney(d.total, d.company?.currency || defaultProfile?.currency || "USD")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
