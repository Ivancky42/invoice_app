import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import DocumentForm from "../../DocumentForm";
import { saveDocument } from "../../actions";
import { LineItem, DiscountType } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, companies] = await Promise.all([
    prisma.document.findUnique({ where: { id } }),
    prisma.companyProfile.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
  ]);
  if (!doc) return notFound();
  const items = (doc.items as unknown as LineItem[]) ?? [];
  return (
    <DocumentForm
      mode="edit"
      companies={companies.map((c) => ({ id: c.id, name: c.name, currency: c.currency, taxRate: c.taxRate }))}
      saveAction={saveDocument}
      initial={{
        id: doc.id,
        type: doc.type,
        status: doc.status,
        issueDate: doc.issueDate.toISOString().slice(0, 10),
        dueDate: doc.dueDate ? doc.dueDate.toISOString().slice(0, 10) : "",
        companyId: doc.companyId,
        clientName: doc.clientName,
        clientAddress: doc.clientAddress ?? "",
        clientEmail: doc.clientEmail ?? "",
        clientPhone: doc.clientPhone ?? "",
        shipToAttn: doc.shipToAttn ?? "",
        shipToAddress: doc.shipToAddress ?? "",
        poNumber: doc.poNumber ?? "",
        projectTitle: doc.projectTitle ?? "",
        projectDescription: doc.projectDescription ?? "",
        items,
        taxRate: doc.taxRate,
        discountType: doc.discountType as DiscountType,
        discountValue: doc.discountValue,
        paymentTerms: doc.paymentTerms ?? "",
        notes: doc.notes ?? "",
        terms: doc.terms ?? "",
      }}
    />
  );
}
