import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { syncTrackedTickersFromDb } from "@/lib/agent/writes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Rebuild TRACKED_TICKERS from Portfolio + active Watchlist. */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;
  return NextResponse.json(await syncTrackedTickersFromDb());
}
