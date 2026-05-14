import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPricePushToNotion } from "@/lib/notion/pricePushToNotion";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function authorized(req: NextRequest): boolean {
  const sync = process.env.SYNC_SECRET?.trim();
  const cron = process.env.CRON_SECRET?.trim();

  const provided = req.nextUrl.searchParams.get("secret")?.trim() ?? "";
  if (sync && provided && timingSafeEqual(sync, provided)) return true;

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (cron && bearer && timingSafeEqual(cron, bearer)) return true;
  if (sync && bearer && timingSafeEqual(sync, bearer)) return true;

  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await runPricePushToNotion();
  const { details, ...summary } = result;
  const limitedDetails = details.length > 80 ? details.slice(0, 80) : details;
  return NextResponse.json(
    { ...summary, details: limitedDetails, detailsTruncated: details.length > 80 },
    { status: 200 },
  );
}
