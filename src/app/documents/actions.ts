"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { calcTotals, NEXT_STAGE, DiscountType } from "@/lib/types";
import { nextDocumentNumber } from "@/lib/numbering";
import { setDocumentStatus } from "@/lib/invoicing/documents";
import { createRecurringFromDocument } from "@/lib/invoicing/recurring";

type SaveInput = {
  id?: string;
  type: string;
  status: string;
  issueDate: string;
  dueDate?: string | null;
  companyId?: string | null;
  clientId?: string | null;
  clientName: string;
  clientAddress?: string;
  clientEmail?: string;
  clientPhone?: string;
  shipToAttn?: string;
  shipToAddress?: string;
  poNumber?: string;
  projectTitle?: string;
  projectDescription?: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  taxRate: number;
  discountType?: DiscountType;
  discountValue?: number;
  paymentTerms?: string;
  notes?: string;
  terms?: string;
  /** New invoices only: bill this invoice again automatically. It counts as #1 of the series. */
  repeat?: {
    frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
    interval: number;
    /** Total invoices including this one; null = indefinite. */
    totalInvoices: number | null;
  } | null;
};

export async function saveDocument(input: SaveInput): Promise<{ id: string }> {
  const discountType = input.discountType ?? "PERCENT";
  const discountValue = Number(input.discountValue) || 0;
  const totals = calcTotals(input.items, input.taxRate, discountType, discountValue);
  const base = {
    type: input.type as any,
    status: input.status as any,
    issueDate: new Date(input.issueDate),
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    companyId: input.companyId || null,
    clientId: input.clientId || null,
    clientName: input.clientName,
    clientAddress: input.clientAddress || null,
    clientEmail: input.clientEmail || null,
    clientPhone: input.clientPhone || null,
    shipToAttn: input.shipToAttn || null,
    shipToAddress: input.shipToAddress || null,
    poNumber: input.poNumber || null,
    projectTitle: input.projectTitle || null,
    projectDescription: input.projectDescription || null,
    items: input.items as any,
    subtotal: totals.subtotal,
    discountType,
    discountValue,
    discountAmount: totals.discountAmount,
    taxRate: input.taxRate,
    taxAmount: totals.taxAmount,
    total: totals.total,
    paymentTerms: input.paymentTerms || null,
    notes: input.notes || null,
    terms: input.terms || null,
  };

  if (input.id) {
    const updated = await prisma.document.update({ where: { id: input.id }, data: base });
    revalidatePath(`/documents/${updated.id}`);
    revalidatePath(`/documents`);
    return { id: updated.id };
  }

  const number = await nextDocumentNumber(input.type, { date: base.issueDate });
  const created = await prisma.document.create({ data: { ...base, number } });
  if (input.repeat && input.type === "INVOICE") {
    await createRecurringFromDocument({
      documentId: created.id,
      frequency: input.repeat.frequency,
      interval: Math.max(1, input.repeat.interval || 1),
      maxOccurrences: input.repeat.totalInvoices,
      countTemplateAsFirst: true,
      autoIssue: true,
    });
    revalidatePath("/recurring");
  }
  revalidatePath(`/documents`);
  return { id: created.id };
}

export async function deleteDocument(id: string) {
  await prisma.document.delete({ where: { id } });
  revalidatePath("/documents");
}

export async function setStatus(id: string, status: string) {
  if (!["DRAFT", "ISSUED", "PAID", "CANCELLED"].includes(status)) return;
  // Shared with the MCP tool: issuing an invoice without a due date derives one from Net-N terms.
  await setDocumentStatus(id, status as "DRAFT" | "ISSUED" | "PAID" | "CANCELLED");
  revalidatePath(`/documents/${id}`);
}

export async function convertDocument(id: string): Promise<{ id: string } | null> {
  const src = await prisma.document.findUnique({ where: { id } });
  if (!src) return null;
  const next = NEXT_STAGE[src.type];
  if (!next) return null;
  const number = await nextDocumentNumber(next);
  const created = await prisma.document.create({
    data: {
      type: next as any,
      number,
      status: "DRAFT",
      issueDate: new Date(),
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
      items: src.items as any,
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
      parentId: src.id,
    },
  });
  revalidatePath("/documents");
  return { id: created.id };
}
