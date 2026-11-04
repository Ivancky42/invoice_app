"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createRecurringSchema, updateRecurringSchema } from "@/lib/invoicing/inputs";
import {
  createRecurringInvoice,
  deleteRecurringInvoice,
  runDueRecurringInvoices,
  updateRecurringInvoice,
} from "@/lib/invoicing/recurring";

export type SaveRecurringResult = { id?: string; error?: string; generated?: string[] };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function refresh(id?: string) {
  revalidatePath("/recurring");
  revalidatePath("/documents");
  revalidatePath("/invoices");
  if (id) revalidatePath(`/recurring/${id}`);
}

/** Create (optionally adopting an existing invoice as #1) or update a schedule. */
export async function saveRecurring(
  payload: Record<string, unknown> & { id?: string; linkDocumentId?: string },
): Promise<SaveRecurringResult> {
  try {
    if (payload.id) {
      const parsed = updateRecurringSchema.safeParse(payload);
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
      const r = await updateRecurringInvoice(parsed.data);
      refresh(r.schedule.id);
      return { id: r.schedule.id, error: r.error, generated: r.generatedNow.map((g) => g.number) };
    }
    const { linkDocumentId, ...rest } = payload;
    const parsed = createRecurringSchema.safeParse(rest);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { error: issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input" };
    }
    const r = await createRecurringInvoice(parsed.data, { linkDocumentId: linkDocumentId || undefined });
    refresh(r.schedule.id);
    if (linkDocumentId) revalidatePath(`/documents/${linkDocumentId}`);
    return { id: r.schedule.id, error: r.error, generated: r.generatedNow.map((g) => g.number) };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function setRecurringStatus(formData: FormData) {
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "") as "ACTIVE" | "PAUSED" | "ENDED";
  if (!id || !["ACTIVE", "PAUSED", "ENDED"].includes(status)) return;
  await updateRecurringInvoice({ id, status });
  refresh(id);
}

export async function runRecurringNow(formData: FormData) {
  const id = String(formData.get("id") || "") || undefined;
  await runDueRecurringInvoices({ scheduleId: id });
  refresh(id);
}

export async function removeRecurring(formData: FormData) {
  const id = String(formData.get("id") || "");
  if (!id) return;
  await deleteRecurringInvoice(id);
  refresh();
  redirect("/recurring");
}
