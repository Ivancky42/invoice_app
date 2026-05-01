import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { renderDocPDF } from "@/lib/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const doc = await prisma.document.findUnique({ where: { id }, include: { company: true } });
  if (!doc) return new Response("Not found", { status: 404 });

  const company = doc.company ?? (await prisma.companyProfile.findFirst({ where: { isDefault: true } })) ?? (await prisma.companyProfile.findFirst());

  const pdf = await renderDocPDF(doc as any, company as any);
  const url = new URL(req.url);
  const download = url.searchParams.get("download");
  const disposition = `${download ? "attachment" : "inline"}; filename="${doc.number}.pdf"`;

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
    },
  });
}
