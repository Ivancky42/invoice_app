import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorized } from "@/lib/cron/auth";
import { runPortfolioSnapshotStep, runPriceSyncStep } from "@/lib/cron/priceSyncJob";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await runPriceSyncStep();
  const outcome = await runPortfolioSnapshotStep(result);

  const { details, ...summary } = result;
  const limitedDetails = details.length > 80 ? details.slice(0, 80) : details;
  return NextResponse.json(
    {
      ...summary,
      ok: outcome.allOk,
      errors: outcome.allOk ? [] : outcome.errors,
      snapshotOk: outcome.snapshotOk,
      failedTickers: outcome.failedTickers,
      failedDetails: outcome.failedDetails.slice(0, 40),
      details: limitedDetails,
      detailsTruncated: details.length > 80,
    },
    { status: 200 },
  );
}
