import { prisma } from "@/lib/prisma";
import DocumentForm from "../DocumentForm";
import { saveDocument } from "../actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const companies = await prisma.companyProfile.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  const clients = await prisma.clientProfile.findMany({ orderBy: { name: "asc" } });
  const defaultCo = companies.find((c) => c.isDefault) ?? companies[0];
  const initialType = type && ["QUOTATION", "INVOICE", "DELIVERY_ORDER"].includes(type) ? type : "QUOTATION";

  if (companies.length === 0) {
    return (
      <div className="card p-8 max-w-xl">
        <h1 className="text-xl font-semibold">Create a company profile first</h1>
        <p className="text-sm text-gray-600 mt-2">You need at least one company profile before you can create documents.</p>
        <Link href="/settings/new" className="btn btn-primary mt-4">+ New profile</Link>
      </div>
    );
  }

  return (
    <DocumentForm
      mode="create"
      companies={companies.map((c) => ({ id: c.id, name: c.name, currency: c.currency, taxRate: c.taxRate }))}
      clients={clients.map((c) => ({
        id: c.id,
        name: c.name,
        address: c.address,
        email: c.email,
        phone: c.phone,
        shipToAttn: c.shipToAttn,
        shipToAddress: c.shipToAddress,
      }))}
      saveAction={saveDocument}
      initial={{
        type: initialType,
        companyId: defaultCo?.id,
        items: [{ description: "", quantity: 1, unitPrice: 0 }],
        taxRate: defaultCo?.taxRate ?? 0,
        notes: defaultCo?.notes ?? "",
      }}
    />
  );
}
