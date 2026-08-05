import type { TradeType } from "@/generated/prisma/enums";
import { TradeType as TradeTypeEnum } from "@/generated/prisma/enums";
import { normalizeTradeType } from "@/lib/stocks/normalizeStatus";

/** +1 opens/adds; −1 reduces/exits. Exhaustive over TradeType. */
export const TRADE_DIRECTION: Record<TradeType, 1 | -1> = {
  BUY: 1,
  ADD: 1,
  TRIM: -1,
  SELL: -1,
  STOP_LOSS: -1,
};

const TRADE_TYPE_VALUES = new Set<string>(Object.values(TradeTypeEnum));

/**
 * Map a TradeType enum or legacy Notion/raw string to TradeType.
 * Returns null when the value cannot be normalised (caller should skip).
 */
export function parseTradeType(raw: TradeType | string | null | undefined): TradeType | null {
  if (raw == null) return null;
  if (TRADE_TYPE_VALUES.has(raw)) return raw as TradeType;
  return normalizeTradeType(raw);
}
