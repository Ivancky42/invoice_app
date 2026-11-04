import { prisma } from "@/lib/prisma";
import { renderDocPDF } from "@/lib/pdf";

/**
 * Render a document's PDF with its own company profile (falling back to the default
 * profile, then any profile) — the same branding the app's PDF route uses.
 */
export async function renderDocumentPdf(id: string): Promise<{ number: string; pdf: Buffer } | null> {
  const doc = await prisma.document.findUnique({ where: { id }, include: { company: true } });
  if (!doc) return null;
  const company =
    doc.company ??
    (await prisma.companyProfile.findFirst({ where: { isDefault: true } })) ??
    (await prisma.companyProfile.findFirst());
  // pdf.tsx's DocLike / Profile types are structural subsets of the Prisma rows.
  const pdf = await renderDocPDF(doc as never, company as never);
  return { number: doc.number, pdf };
}
