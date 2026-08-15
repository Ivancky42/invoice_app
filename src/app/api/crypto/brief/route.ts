import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { authorized } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { snapshotDateGMT8 } from "@/lib/stocks/portfolioTotals";
import { CryptoBriefAction, type Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const BRIEF_SYNC_SOURCE = "crypto-brief";
const VALID_ACTIONS = new Set<string>(Object.values(CryptoBriefAction));

type CallInput = {
  symbol?: unknown;
  action?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

type BriefBody = {
  date?: unknown;
  marketSummary?: unknown;
  fearGreed?: unknown;
  calls?: unknown;
  watchlistNotes?: unknown;
};

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: BriefBody;
  try {
    body = (await req.json()) as BriefBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const marketSummary = body.marketSummary;
  if (typeof marketSummary !== "string" || marketSummary.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "marketSummary is required and must be a non-empty string" },
      { status: 400 },
    );
  }

  const callsRaw = body.calls;
  if (!Array.isArray(callsRaw) || callsRaw.length === 0) {
    return NextResponse.json(
      { ok: false, error: "calls must be a non-empty array" },
      { status: 400 },
    );
  }

  const knownAssets = await prisma.cryptoAsset.findMany({ select: { symbol: true } });
  const knownSymbols = new Set(knownAssets.map((a) => a.symbol));

  const unknownSymbols = new Set<string>();
  for (const c of callsRaw as CallInput[]) {
    const symbol = typeof c.symbol === "string" ? c.symbol.toUpperCase() : "";
    if (!symbol || !knownSymbols.has(symbol)) {
      unknownSymbols.add(typeof c.symbol === "string" ? c.symbol : String(c.symbol));
      continue;
    }
    if (typeof c.action !== "string" || !VALID_ACTIONS.has(c.action)) {
      return NextResponse.json(
        {
          ok: false,
          error: `call for ${symbol} has invalid action; must be one of ${[...VALID_ACTIONS].join(", ")}`,
        },
        { status: 400 },
      );
    }
    const confidence = c.confidence;
    if (
      typeof confidence !== "number" ||
      !Number.isInteger(confidence) ||
      confidence < 1 ||
      confidence > 5
    ) {
      return NextResponse.json(
        { ok: false, error: `call for ${symbol} has invalid confidence; must be an integer 1-5` },
        { status: 400 },
      );
    }
  }

  // Store calls with normalized (uppercase) symbols.
  const calls = (callsRaw as CallInput[]).map((c) => ({
    ...c,
    symbol: typeof c.symbol === "string" ? c.symbol.toUpperCase() : c.symbol,
  })) as unknown as Prisma.InputJsonValue;

  if (unknownSymbols.size > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `unknown symbol(s): ${[...unknownSymbols].join(", ")}`,
      },
      { status: 400 },
    );
  }

  const briefDate =
    typeof body.date === "string" && body.date.trim()
      ? snapshotDateGMT8(new Date(body.date))
      : snapshotDateGMT8();

  const fearGreed =
    typeof body.fearGreed === "number" && Number.isFinite(body.fearGreed)
      ? Math.round(body.fearGreed)
      : null;

  const watchlistNotes =
    typeof body.watchlistNotes === "string" && body.watchlistNotes.trim()
      ? body.watchlistNotes
      : null;

  const brief = await prisma.cryptoDailyBrief.upsert({
    where: { briefDate },
    create: {
      briefDate,
      marketSummary,
      fearGreed,
      calls,
      watchlistNotes,
      raw: body as object,
    },
    update: {
      marketSummary,
      fearGreed,
      calls,
      watchlistNotes,
      raw: body as object,
    },
  });

  await prisma.syncStatus.upsert({
    where: { source: BRIEF_SYNC_SOURCE },
    create: { source: BRIEF_SYNC_SOURCE, lastRunAt: new Date(), lastSuccessAt: new Date() },
    update: { lastRunAt: new Date(), lastSuccessAt: new Date(), lastError: null },
  });

  revalidatePath("/crypto", "layout");

  return NextResponse.json(
    { ok: true, briefDate: brief.briefDate.toISOString() },
    { status: 200 },
  );
}
