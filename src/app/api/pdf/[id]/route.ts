import { NextRequest } from "next/server";
import { renderDocumentPdf } from "@/lib/invoicing/pdfRender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inline view, or `?download=1` for an attachment. Reached either behind the PIN gate
 * (cookie) or with a signed `exp`/`sig` link that src/proxy.ts has already verified.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rendered = await renderDocumentPdf(id);
  if (!rendered) return new Response("Not found", { status: 404 });

  const download = req.nextUrl.searchParams.get("download");
  const disposition = `${download ? "attachment" : "inline"}; filename="${rendered.number}.pdf"`;

  return new Response(new Uint8Array(rendered.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
