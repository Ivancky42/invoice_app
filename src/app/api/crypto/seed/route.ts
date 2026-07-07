import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorized } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { CryptoAssetStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

type SeedDef = {
  symbol: string;
  name: string;
  coingeckoId: string;
  binanceSymbol: string | null;
  llamaSlug: string | null;
};

const SEED: SeedDef[] = [
  { symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin", binanceSymbol: "BTCUSDT", llamaSlug: null },
  { symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", binanceSymbol: "ETHUSDT", llamaSlug: "Ethereum" },
  { symbol: "SOL", name: "Solana", coingeckoId: "solana", binanceSymbol: "SOLUSDT", llamaSlug: "Solana" },
  { symbol: "SEI", name: "Sei", coingeckoId: "sei-network", binanceSymbol: "SEIUSDT", llamaSlug: "Sei" },
];

type Override = { quantity?: number | string | null; avgCost?: number | string | null };

/** Parse a numeric override, ignoring invalid values. */
function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Optional body: { "BTC": { "quantity": 0.5, "avgCost": 42000 }, ... }
  let overrides: Record<string, Override> = {};
  try {
    const body = await req.json();
    if (body && typeof body === "object") overrides = body as Record<string, Override>;
  } catch {
    // No/invalid body — seed with null qty/avgCost.
  }

  const seeded: string[] = [];
  for (const def of SEED) {
    const o = overrides[def.symbol] ?? {};
    const quantity = parseNum(o.quantity);
    const avgCost = parseNum(o.avgCost);

    await prisma.cryptoAsset.upsert({
      where: { coingeckoId: def.coingeckoId },
      create: {
        symbol: def.symbol,
        name: def.name,
        coingeckoId: def.coingeckoId,
        binanceSymbol: def.binanceSymbol,
        llamaSlug: def.llamaSlug,
        status: CryptoAssetStatus.PORTFOLIO,
        quantity,
        avgCost,
      },
      update: {
        // Keep taxonomy fresh; only overwrite qty/avgCost when provided.
        name: def.name,
        binanceSymbol: def.binanceSymbol,
        llamaSlug: def.llamaSlug,
        status: CryptoAssetStatus.PORTFOLIO,
        ...(quantity !== null ? { quantity } : {}),
        ...(avgCost !== null ? { avgCost } : {}),
      },
    });
    seeded.push(def.symbol);
  }

  return NextResponse.json({ ok: true, seeded }, { status: 200 });
}
