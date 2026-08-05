import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { runPriceSyncToNeon } from "@/lib/stocks/priceSync";
import { recordPortfolioSnapshot } from "@/lib/stocks/recordPortfolioSnapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYNC_SOURCE = "prices";

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

  const startedAt = new Date();
  await prisma.syncStatus.upsert({
    where: { source: SYNC_SOURCE },
    create: { source: SYNC_SOURCE, lastRunAt: startedAt },
    update: { lastRunAt: startedAt, lastError: null },
  });

  const result = await runPriceSyncToNeon();
  let snapshotOk: boolean | null = null;
  const errors = [...result.errors];
  let snapshotThrew = false;

  if (result.updated > 0 || result.failed === 0) {
    if (result.updated > 0 && result.failed > 0) {
      errors.push(
        `portfolioSnapshot: recording after partial price sync (updated=${result.updated}, failed=${result.failed})`,
      );
      console.warn(
        `[sync/prices] partial success: updated=${result.updated} failed=${result.failed}; recording portfolio snapshot`,
      );
    }
    try {
      const snap = await recordPortfolioSnapshot();
      snapshotOk = snap.ok;
      if (!snap.ok) {
        // Prices succeeded; empty/zero portfolio just means no snapshot row.
        errors.push("portfolioSnapshot: skipped (totalValue <= 0)");
      }
    } catch (e) {
      snapshotThrew = true;
      snapshotOk = false;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`portfolioSnapshot: ${msg}`);
    }
  }

  const allOk = result.ok && !snapshotThrew;
  const completedAt = new Date();

  await prisma.syncStatus.update({
    where: { source: SYNC_SOURCE },
    data: {
      lastSuccessAt: allOk ? completedAt : undefined,
      lastError: allOk ? null : errors.length ? errors.join(" | ") : null,
      rowCounts: {
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        portfolioSnapshot: snapshotOk === null ? null : snapshotOk ? 1 : 0,
      },
    },
  });

  const { details, ...summary } = result;
  const limitedDetails = details.length > 80 ? details.slice(0, 80) : details;
  return NextResponse.json(
    {
      ...summary,
      ok: allOk,
      errors: allOk ? [] : errors,
      snapshotOk,
      details: limitedDetails,
      detailsTruncated: details.length > 80,
    },
    { status: 200 },
  );
}
