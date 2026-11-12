import { prisma } from "@/lib/prisma";

/**
 * Render a document's PDF with its own company profile (falling back to the default
 * profile, then any profile) — the same branding the app's PDF route uses.
 *
 * `@/lib/pdf` (and with it @react-pdf/renderer) is imported lazily: this module is
 * reachable from the MCP route and the cron tick, and a static import made every cold
 * start of those functions load the PDF engine even when nothing renders a PDF.
 */
export async function renderDocumentPdf(id: string): Promise<{ number: string; pdf: Buffer } | null> {
  const doc = await prisma.document.findUnique({ where: { id }, include: { company: true } });
  if (!doc) return null;
  const company =
    doc.company ??
    (await prisma.companyProfile.findFirst({ where: { isDefault: true } })) ??
    (await prisma.companyProfile.findFirst());
  const { renderDocPDF } = await import("@/lib/pdf");
  // pdf.tsx's DocLike / Profile types are structural subsets of the Prisma rows.
  const pdf = await renderDocPDF(doc as never, company as never);
  return { number: doc.number, pdf };
}
