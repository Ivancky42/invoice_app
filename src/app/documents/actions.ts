"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { calcTotals, DiscountType } from "@/lib/types";
import { nextDocumentNumber } from "@/lib/numbering";
import {
  convertDocument as convertDocumentService,
  InvoicingError,
  setDocumentStatus,
  withFreshNumber,
} from "@/lib/invoicing/documents";
import { nextPaidAt, todayInTimeZone } from "@/lib/invoicing/schedule";
import { createRecurringFromDocument } from "@/lib/invoicing/recurring";
import { previewInvoiceEmail, sendInvoiceEmail } from "@/lib/invoicing/email";

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

export async function saveDocument(input: SaveInput): Promise<{ id: string; recurringError?: string }> {
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
    // Paid date follows the status: kept while PAID, today when it becomes PAID, else cleared.
    const prev = await prisma.document.findUnique({ where: { id: input.id }, select: { status: true, paidAt: true } });
    const updated = await prisma.document.update({
      where: { id: input.id },
      data: { ...base, paidAt: nextPaidAt(prev, input.status, todayInTimeZone()) },
    });
    revalidatePath(`/documents/${updated.id}`);
    revalidatePath(`/documents`);
    return { id: updated.id };
  }

  const created = await withFreshNumber(async () =>
    prisma.$transaction(async (tx) =>
      tx.document.create({
        data: {
          ...base,
          paidAt: nextPaidAt(null, input.status, todayInTimeZone()),
          number: await nextDocumentNumber(input.type, { db: tx, date: base.issueDate }),
        },
      }),
    ),
  );
  let recurringError: string | undefined;
  if (input.repeat && input.type === "INVOICE") {
    // The invoice is already saved: never let a schedule failure read as a failed save,
    // or a retry would create a second invoice. Report it on the invoice page instead.
    try {
      await createRecurringFromDocument({
        documentId: created.id,
        frequency: input.repeat.frequency,
        interval: Math.max(1, input.repeat.interval || 1),
        maxOccurrences: input.repeat.totalInvoices,
        countTemplateAsFirst: true,
        autoIssue: true,
      });
      revalidatePath("/recurring");
    } catch (e) {
      recurringError = e instanceof Error ? e.message : String(e);
    }
  }
  revalidatePath(`/documents`);
  return { id: created.id, recurringError };
}

export async function deleteDocument(id: string) {
  await prisma.document.delete({ where: { id } });
  revalidatePath("/documents");
}

export async function setStatus(
  id: string,
  status: string,
  paidDate?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  if (!["DRAFT", "ISSUED", "PAID", "CANCELLED"].includes(status)) return { ok: false, message: "Unknown status" };
  try {
    // Shared with the MCP tool: issuing an invoice without a due date derives one from Net-N
    // terms; marking it paid records the paid date (today unless one is given).
    await setDocumentStatus(id, status as "DRAFT" | "ISSUED" | "PAID" | "CANCELLED", {
      paidDate: status === "PAID" ? paidDate || null : null,
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents");
  return { ok: true };
}

export async function convertDocument(id: string): Promise<{ id: string } | null> {
  try {
    const created = await convertDocumentService(id);
    revalidatePath("/documents");
    return { id: created.id };
  } catch (e) {
    if (e instanceof InvoicingError) return null;
    throw e;
  }
}

/** Email a document from its page. Returns a message instead of throwing so the form can show it. */
export type EmailPreview = Awaited<ReturnType<typeof previewInvoiceEmail>>;

/** What "Send" would email — for the confirmation dialog. Sends and records nothing. */
export async function previewDocumentEmail(
  id: string,
  input: { to: string; cc: string; message: string },
): Promise<{ ok: true; preview: EmailPreview } | { ok: false; message: string }> {
  try {
    const preview = await previewInvoiceEmail(id, {
      to: input.to,
      cc: input.cc || null,
      message: input.message || null,
    });
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function emailDocument(
  id: string,
  input: { to: string; cc: string; message: string },
): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await sendInvoiceEmail(id, {
      to: input.to,
      cc: input.cc || null,
      message: input.message || null,
      trigger: "app",
    });
    revalidatePath(`/documents/${id}`);
    revalidatePath("/documents");
    const copies = r.cc.length ? ` (cc ${r.cc.join(", ")})` : "";
    return { ok: true, message: `Sent to ${r.to.join(", ")}${copies}. Status: ${r.status}.` };
  } catch (e) {
    revalidatePath(`/documents/${id}`);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
