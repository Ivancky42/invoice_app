import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, rejectBranchOr400 } from "@/lib/agent/http";
import { syncTrackedTickersFromDb } from "@/lib/agent/writes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Rebuild TRACKED_TICKERS from Portfolio + active Watchlist. */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  // Real-book write: LIVE only — a `branch` key in the body is refused, not ignored.
  const branchRejected = rejectBranchOr400(await readJsonBody(req));
  if (branchRejected) return branchRejected;

  return NextResponse.json(await syncTrackedTickersFromDb());
}
