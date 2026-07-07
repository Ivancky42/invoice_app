/**
 * Crypto display helpers — badge classes + number formatting.
 * Mirrors `src/lib/stocks/format.ts` styling; crypto percentages are stored as
 * raw percent values (e.g. 2.5 = 2.5%), so `fmtPct` does NOT scale by 100.
 */

/** Technical-flag badge classes. Flags come from `signals.computeFlags`. */
export function flagBadgeClass(flag: string): string {
  switch (flag) {
    case "RSI_OVERSOLD":
    case "TVL_SURGE_7D":
      return "bg-emerald-100 text-emerald-800";
    case "GOLDEN_CROSS":
      return "bg-emerald-50 text-emerald-700";
    case "VOLUME_SPIKE":
      return "bg-blue-100 text-blue-700";
    case "RSI_OVERBOUGHT":
      return "bg-amber-100 text-amber-800";
    case "FUNDING_EXTREME":
      return "bg-orange-100 text-orange-800";
    case "DEATH_CROSS":
    case "TVL_DROP_7D":
    case "ATH_DRAWDOWN_DEEP":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

/** Human-friendly flag label, e.g. "RSI_OVERSOLD" → "RSI oversold". */
export function flagLabel(flag: string): string {
  const map: Record<string, string> = {
    RSI_OVERBOUGHT: "RSI overbought",
    RSI_OVERSOLD: "RSI oversold",
    GOLDEN_CROSS: "Golden cross",
    DEATH_CROSS: "Death cross",
    VOLUME_SPIKE: "Volume spike",
    FUNDING_EXTREME: "Funding extreme",
    TVL_DROP_7D: "TVL drop 7d",
    TVL_SURGE_7D: "TVL surge 7d",
    ATH_DRAWDOWN_DEEP: "Deep ATH drawdown",
  };
  return map[flag] ?? flag.replace(/_/g, " ").toLowerCase();
}

/** Brief-call action badge classes (BUY/ADD green, HOLD neutral, TRIM/SELL red). */
export function actionBadgeClass(action: string | null | undefined): string {
  switch ((action ?? "").toUpperCase()) {
    case "BUY":
      return "bg-emerald-100 text-emerald-800";
    case "ADD":
      return "bg-emerald-50 text-emerald-700";
    case "HOLD":
      return "bg-gray-100 text-gray-700";
    case "TRIM":
      return "bg-amber-100 text-amber-800";
    case "SELL":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

/** Full-precision USD price with adaptive decimals for sub-dollar tokens. */
export function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
}

/** Plain USD money (2dp) — for portfolio totals / P&L dollars. */
export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Percentage already stored as a percent value (2.5 → "2.5%"). */
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Signed percentage with explicit "+" for gains. */
export function fmtPctSigned(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

/** Plain number with fixed decimals. */
export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Token quantity — trims trailing zeros, up to 6dp. */
export function fmtQty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** Large USD figure as $1.2B / $340.0M / $12.3K (market cap, volume, TVL). */
export function fmtLargeUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Tailwind text color for a signed value (gain green / loss red / neutral). */
export function changeColor(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return "text-gray-500";
  return n > 0 ? "text-emerald-700" : "text-red-700";
}

/** Fear & Greed label + color from a 0-100 index value. */
export function fearGreedMeta(value: number | null | undefined): { label: string; className: string } {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { label: "—", className: "bg-gray-100 text-gray-600" };
  }
  if (value <= 24) return { label: "Extreme fear", className: "bg-red-100 text-red-700" };
  if (value <= 44) return { label: "Fear", className: "bg-orange-100 text-orange-800" };
  if (value <= 55) return { label: "Neutral", className: "bg-gray-100 text-gray-700" };
  if (value <= 74) return { label: "Greed", className: "bg-emerald-50 text-emerald-700" };
  return { label: "Extreme greed", className: "bg-emerald-100 text-emerald-800" };
}

/** Unrealized P&L for a holding: qty × (price − avgCost). */
export function unrealizedPnl(
  price: number | null,
  avgCost: number | null,
  quantity: number | null,
): { dollar: number | null; pct: number | null; marketValue: number | null; costBasis: number | null } {
  if (price === null || avgCost === null || quantity === null || quantity === 0 || avgCost === 0) {
    return { dollar: null, pct: null, marketValue: null, costBasis: null };
  }
  const marketValue = price * quantity;
  const costBasis = avgCost * quantity;
  return {
    dollar: marketValue - costBasis,
    pct: (price - avgCost) / avgCost * 100,
    marketValue,
    costBasis,
  };
}

const UTC_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** SSR-safe short UTC date, e.g. "May 27". */
export function fmtShortDateUtc(iso: string): string {
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return `${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  return iso.slice(0, 10);
}

/** Whole days between an ISO date and now (for brief staleness). */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}
