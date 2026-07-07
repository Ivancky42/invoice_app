"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { CryptoAssetStatus } from "@/generated/prisma/client";
import { runCryptoSync, type CryptoSyncResult } from "@/lib/crypto/sync";

function revalidateCrypto() {
  revalidatePath("/crypto", "layout");
}

/**
 * Trigger a crypto data sync from the UI. Protected by the site PIN gate only
 * (server actions are unreachable to logged-out browsers); no cron secret needed.
 */
export async function manualCryptoSync(): Promise<CryptoSyncResult> {
  const result = await runCryptoSync();
  revalidateCrypto();
  return result;
}

export type AssetFieldUpdates = {
  thesis?: string;
  notes?: string;
  keyCatalyst?: string;
  targetPrice?: number | null;
  stopLoss?: number | null;
  quantity?: number | null;
  avgCost?: number | null;
};

/** Trim a string to null when empty. */
function nullableText(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Validate an optional numeric field (allows explicit null to clear). */
function optionalNumber(v: number | null | undefined, field: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
  return v;
}

/** Edit qualitative + position fields on an asset (in-app, no Notion). */
export async function updateAssetFields(id: string, updates: AssetFieldUpdates): Promise<void> {
  if (!id) throw new Error("Asset id is required");

  const data: Record<string, unknown> = {};
  const thesis = nullableText(updates.thesis);
  if (thesis !== undefined) data.thesis = thesis;
  const notes = nullableText(updates.notes);
  if (notes !== undefined) data.notes = notes;
  const keyCatalyst = nullableText(updates.keyCatalyst);
  if (keyCatalyst !== undefined) data.keyCatalyst = keyCatalyst;

  const targetPrice = optionalNumber(updates.targetPrice, "Target price");
  if (targetPrice !== undefined) data.targetPrice = targetPrice;
  const stopLoss = optionalNumber(updates.stopLoss, "Stop loss");
  if (stopLoss !== undefined) data.stopLoss = stopLoss;
  const quantity = optionalNumber(updates.quantity, "Quantity");
  if (quantity !== undefined) data.quantity = quantity;
  const avgCost = optionalNumber(updates.avgCost, "Avg cost");
  if (avgCost !== undefined) data.avgCost = avgCost;

  if (Object.keys(data).length === 0) return;

  await prisma.cryptoAsset.update({ where: { id }, data });
  revalidateCrypto();
}

/** Move an asset between TRENDING → WATCHLIST → PORTFOLIO (or ARCHIVED). */
export async function graduateAsset(id: string, status: CryptoAssetStatus): Promise<void> {
  if (!id) throw new Error("Asset id is required");
  if (!Object.values(CryptoAssetStatus).includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }
  await prisma.cryptoAsset.update({ where: { id }, data: { status } });
  revalidateCrypto();
}

export type NewAssetInput = {
  symbol: string;
  name: string;
  coingeckoId: string;
  binanceSymbol?: string;
  llamaSlug?: string;
  status: CryptoAssetStatus;
};

/** Add a tracked asset (manual entry; sync fills metrics on next run). */
export async function addAsset(input: NewAssetInput): Promise<void> {
  const symbol = input.symbol?.trim().toUpperCase();
  const name = input.name?.trim();
  const coingeckoId = input.coingeckoId?.trim().toLowerCase();
  if (!symbol) throw new Error("Symbol is required");
  if (!name) throw new Error("Name is required");
  if (!coingeckoId) throw new Error("CoinGecko id is required");
  if (!Object.values(CryptoAssetStatus).includes(input.status)) {
    throw new Error(`Unknown status: ${input.status}`);
  }

  await prisma.cryptoAsset.create({
    data: {
      symbol,
      name,
      coingeckoId,
      binanceSymbol: input.binanceSymbol?.trim().toUpperCase() || null,
      llamaSlug: input.llamaSlug?.trim() || null,
      status: input.status,
    },
  });
  revalidateCrypto();
}

export type NewTradeInput = {
  assetId: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee?: number | null;
  tradedAt: string; // ISO or yyyy-mm-dd
  notes?: string;
  /** When true, recompute the asset's holding (qty/avgCost) from this trade. */
  updateHolding?: boolean;
};

/**
 * Record a trade. When `updateHolding` is set, a BUY recomputes the weighted
 * average cost and increases quantity; a SELL reduces quantity (avg cost kept).
 */
export async function addTrade(input: NewTradeInput): Promise<void> {
  const { assetId } = input;
  if (!assetId) throw new Error("Asset is required");
  const side = input.side;
  if (side !== "BUY" && side !== "SELL") throw new Error("Side must be BUY or SELL");
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be a positive number");
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new Error("Price must be a non-negative number");
  }
  const tradedAt = new Date(input.tradedAt);
  if (Number.isNaN(tradedAt.getTime())) throw new Error("Traded date is invalid");
  const fee = input.fee != null && Number.isFinite(input.fee) ? input.fee : null;

  const asset = await prisma.cryptoAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("Asset not found");

  await prisma.$transaction(async (tx) => {
    await tx.cryptoTrade.create({
      data: {
        assetId,
        side,
        quantity: input.quantity,
        price: input.price,
        fee,
        tradedAt,
        notes: input.notes?.trim() || null,
      },
    });

    if (!input.updateHolding) return;

    const prevQty = asset.quantity != null ? Number(asset.quantity) : 0;
    const prevAvg = asset.avgCost != null ? Number(asset.avgCost) : 0;

    if (side === "BUY") {
      const newQty = prevQty + input.quantity;
      const newAvg =
        newQty > 0 ? (prevQty * prevAvg + input.quantity * input.price) / newQty : input.price;
      await tx.cryptoAsset.update({
        where: { id: assetId },
        data: { quantity: newQty, avgCost: newAvg },
      });
    } else {
      const newQty = Math.max(0, prevQty - input.quantity);
      await tx.cryptoAsset.update({
        where: { id: assetId },
        data: { quantity: newQty, avgCost: newQty > 0 ? prevAvg : null },
      });
    }
  });

  revalidateCrypto();
}
