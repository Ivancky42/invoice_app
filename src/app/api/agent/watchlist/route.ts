import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
import { upsertWatchlistInputSchema } from "@/lib/agent/schemas";
import { upsertWatchlist } from "@/lib/agent/writes";
import { listWatchlistItems } from "@/lib/agent/context";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;
  return NextResponse.json(await listWatchlistItems());
}

export async function PUT(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseOr400(upsertWatchlistInputSchema, body);
  if (!parsed.ok) return parsed.response;

  const row = await upsertWatchlist(parsed.data);
  return NextResponse.json({ ok: true, watchlist: row });
}
