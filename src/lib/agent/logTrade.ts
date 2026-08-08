import {
  Prisma,
  type Portfolio,
  type Theme,
  type Trade,
  type TradeStatus,
  type TradeType,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CONFIG_KEYS,
  DEFAULT_LIMITS,
  type LimitsConfig,
  type CashConfig,
} from "@/lib/stocks/config";
import { TRADE_DIRECTION } from "@/lib/stocks/tradeMath";
import {
  decToNum,
  holdingsByTicker,
  isCashTicker,
  isCspxTicker,
  notionCashBalanceUsd,
} from "@/lib/stocks/format";
import { resolvePositionShares } from "@/lib/stocks/portfolioTotals";
import type { ReportBlock } from "@/lib/content/blocks";
import type { LogTradeInputParsed } from "@/lib/agent/schemas";
import { syncTrackedTickersFromDb } from "@/lib/agent/writes";
import { getRuleSet } from "@/lib/rules/resolve";

const SHARES_EPS = 1e-6;
const MONEY_EPS = 0.02;
const TX_OPTS = { timeout: 30_000, maxWait: 10_000 } as const;

const CASH_CONFIG_LOCK_KEYS = [
  CONFIG_KEYS.CASH_POSITION_USD,
  CONFIG_KEYS.CASH_POSITION_MYR,
  CONFIG_KEYS.FX_RATE_USD_MYR,
  CONFIG_KEYS.CASH_LAST_UPDATED,
] as const;

export type LogTradeInput = {
  idempotencyKey: string;
  ticker: string;
  type: TradeType;
  date: string;
  shares: number;
  pricePerShare: number;
  thesisAtEntry?: ReportBlock[] | null;
  exitReason?: string | null;
  notes?: ReportBlock[] | null;
  rulesVersion?: string | null;
  status?: TradeStatus;
  /** Optional theme for new BUY — enables theme_cap before insert. */
  theme?: Theme | null;
  reAddToWatchlist?: boolean;
};

export type LogTradePositionSnapshot = {
  ticker: string;
  shares: number;
  myAvgCost: number | null;
  addsUsed: number;
  marketValue: number | null;
  weightPct: number | null;
  deleted: boolean;
};

export type LogTradeResult =
  | {
      ok: true;
      tradeId: string;
      position: LogTradePositionSnapshot;
      cash: CashConfig;
      warnings: string[];
      idempotentReplay: boolean;
    }
  | { ok: false; status: 409; reason: string; details?: unknown };

class InvariantViolation extends Error {
  readonly reason: string;
  readonly details?: unknown;
  constructor(reason: string, details?: unknown) {
    super(reason);
    this.name = "InvariantViolation";
    this.reason = reason;
    this.details = details;
  }
}

type Tx = Prisma.TransactionClient;

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function parseLimits(value: unknown): LimitsConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_LIMITS;
  const o = value as Record<string, unknown>;
  const bands =
    o.tierBands && typeof o.tierBands === "object" && !Array.isArray(o.tierBands)
      ? (o.tierBands as Record<string, unknown>)
      : {};
  const band = (key: string, fb: [number, number]): [number, number] => {
    const v = bands[key];
    if (!Array.isArray(v) || v.length < 2) return fb;
    return [asNumber(v[0], fb[0]), asNumber(v[1], fb[1])];
  };
  return {
    // Keys not enforced here (prose-derived thresholds) fall through from defaults.
    ...DEFAULT_LIMITS,
    singlePositionPct: asNumber(o.singlePositionPct, DEFAULT_LIMITS.singlePositionPct),
    themePct: asNumber(o.themePct, DEFAULT_LIMITS.themePct),
    speculativeSleevePct: asNumber(
      o.speculativeSleevePct,
      DEFAULT_LIMITS.speculativeSleevePct,
    ),
    cashFloorPct: asNumber(o.cashFloorPct, DEFAULT_LIMITS.cashFloorPct),
    maxAverageDowns: asNumber(o.maxAverageDowns, DEFAULT_LIMITS.maxAverageDowns),
    tierBands: {
      TEST_STARTER: band("TEST_STARTER", DEFAULT_LIMITS.tierBands.TEST_STARTER),
      CONFIRMATION: band("CONFIRMATION", DEFAULT_LIMITS.tierBands.CONFIRMATION),
      CONVICTION: band("CONVICTION", DEFAULT_LIMITS.tierBands.CONVICTION),
    },
  };
}

async function loadCashFromTx(
  tx: Tx,
  portfolio?: Portfolio[],
): Promise<CashConfig> {
  const keys = [
    CONFIG_KEYS.CASH_POSITION_USD,
    CONFIG_KEYS.CASH_POSITION_MYR,
    CONFIG_KEYS.FX_RATE_USD_MYR,
    CONFIG_KEYS.CASH_LAST_UPDATED,
  ];
  const rows = await tx.config.findMany({ where: { key: { in: keys } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const fxRate = asNumber(map.get(CONFIG_KEYS.FX_RATE_USD_MYR), 4.2);

  let usd: number | null = null;
  if (map.has(CONFIG_KEYS.CASH_POSITION_USD)) {
    const n = asNumber(map.get(CONFIG_KEYS.CASH_POSITION_USD), Number.NaN);
    usd = Number.isFinite(n) ? n : null;
  }
  // Missing Config only — explicit 0 is a valid cash balance (do not resurrect from CASH_USD).
  if (usd === null) {
    const portfolioRows = portfolio ?? (await tx.portfolio.findMany());
    const cashRow = portfolioRows.find((p) => isCashTicker(p.ticker));
    if (cashRow) {
      usd = notionCashBalanceUsd(cashRow.currentPrice, cashRow.myAvgCost);
    }
  }
  if (usd === null) {
    throw new InvariantViolation("cash_unknown", {
      message: "CASH_POSITION_USD config missing and CASH_USD portfolio row unavailable",
    });
  }

  const myrStored = asNumber(map.get(CONFIG_KEYS.CASH_POSITION_MYR), Number.NaN);
  const updated = map.get(CONFIG_KEYS.CASH_LAST_UPDATED);
  return {
    usd,
    myr: Number.isFinite(myrStored) ? myrStored : usd * fxRate,
    fxRate,
    lastUpdated: typeof updated === "string" ? updated : null,
  };
}

async function upsertConfig(tx: Tx, key: string, value: Prisma.InputJsonValue): Promise<void> {
  await tx.config.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** Uppercased holdings map for {@link resolvePositionShares}. */
function holdingsMapFromTrades(
  trades: Parameters<typeof holdingsByTicker>[0],
): Map<string, number> {
  const raw = holdingsByTicker(trades);
  const map = new Map<string, number>();
  for (const [ticker, shares] of raw) {
    map.set(ticker.trim().toUpperCase(), shares);
  }
  return map;
}

/**
 * Book shares for a ticker: Portfolio.shares, else trade-log net when shares is null
 * (migration-safe — avoids treating null as 0 and wiping an existing position).
 */
function resolveOldShares(
  position: Portfolio | null | undefined,
  holdings: Map<string, number>,
): number {
  if (!position) return 0;
  const resolved = resolvePositionShares(position, holdings);
  if (resolved !== null && Number.isFinite(resolved)) return resolved;
  if (decToNum(position.shares) === null) {
    throw new InvariantViolation("shares_unknown", {
      ticker: position.ticker,
      message: "Portfolio.shares is null and trade-log net is unavailable; set shares first",
    });
  }
  return 0;
}

function markPrice(p: Portfolio, tradeTicker: string, tradePrice: number): number | null {
  const cur = decToNum(p.currentPrice);
  if (cur !== null && cur > 0) return cur;
  if (p.ticker.trim().toUpperCase() === tradeTicker) return tradePrice;
  const avg = decToNum(p.myAvgCost);
  return avg !== null && avg > 0 ? avg : null;
}

type EquitySlice = {
  ticker: string;
  shares: number;
  value: number;
  theme: Portfolio["theme"];
  sleeve: Portfolio["sleeve"];
  isCspx: boolean;
};

function buildEquitySlices(
  portfolio: Portfolio[],
  tradeTicker: string,
  newShares: number,
  tradePrice: number,
  holdings: Map<string, number>,
  opts?: {
    requireMarks?: boolean;
    newTheme?: Theme | null;
    newSleeve?: Portfolio["sleeve"];
  },
): EquitySlice[] {
  const slices: EquitySlice[] = [];
  const missingMark: string[] = [];
  let sawTradeTicker = false;

  for (const p of portfolio) {
    if (isCashTicker(p.ticker)) continue;
    const ticker = p.ticker.trim().toUpperCase();
    const shares =
      ticker === tradeTicker
        ? newShares
        : (resolvePositionShares(p, holdings) ?? 0);
    if (Math.abs(shares) < SHARES_EPS) continue;
    const px = markPrice(p, tradeTicker, tradePrice);
    if (px === null) {
      missingMark.push(ticker);
      continue;
    }
    const isTrade = ticker === tradeTicker;
    slices.push({
      ticker,
      shares,
      value: shares * px,
      theme: isTrade && opts?.newTheme !== undefined ? opts.newTheme : p.theme,
      sleeve: isTrade && opts?.newSleeve !== undefined ? opts.newSleeve : p.sleeve,
      isCspx: isCspxTicker(ticker),
    });
    if (isTrade) sawTradeTicker = true;
  }

  if (!sawTradeTicker && newShares > SHARES_EPS) {
    // New BUY with no existing Portfolio row yet.
    slices.push({
      ticker: tradeTicker,
      shares: newShares,
      value: newShares * tradePrice,
      theme: opts?.newTheme ?? null,
      sleeve: opts?.newSleeve ?? null,
      isCspx: isCspxTicker(tradeTicker),
    });
  }

  if (opts?.requireMarks && missingMark.length > 0) {
    throw new InvariantViolation("missing_mark", { tickers: missingMark });
  }

  return slices;
}

function weightInBands(weight: number, limits: LimitsConfig): boolean {
  const bands = Object.values(limits.tierBands);
  // Loose: within ±0.5pp of any band edge, or inside any band.
  const slack = 0.005;
  for (const [lo, hi] of bands) {
    const low = Math.min(lo, hi);
    const high = Math.max(lo, hi);
    if (weight + slack >= low && weight - slack <= high) return true;
  }
  // CONVICTION band often [0, 0.08] meaning ≤8% — already covered.
  // Also accept very small starter positions below TEST_STARTER low as "pre-band".
  if (weight <= limits.tierBands.TEST_STARTER[0] + slack) return true;
  return false;
}

function parseTradeDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00.000Z`);
}

function defaultStatus(
  type: TradeType,
  newShares: number,
  override?: TradeStatus,
): TradeStatus {
  // Flat position is always CLOSED — ignore status override that would keep OPEN.
  if (newShares <= SHARES_EPS) return "CLOSED";
  if (override) return override;
  if (TRADE_DIRECTION[type] < 0) return "PARTIAL";
  return "OPEN";
}

async function countHistoricalAverageDowns(tx: Tx, ticker: string): Promise<number> {
  const adds = await tx.trade.findMany({
    where: { ticker, type: "ADD" },
    select: { pricePerShare: true, avgCostBasis: true },
  });
  let n = 0;
  for (const t of adds) {
    const price = decToNum(t.pricePerShare);
    const avg = decToNum(t.avgCostBasis);
    if (price !== null && avg !== null && avg > 0 && price < avg) n += 1;
  }
  return n;
}

async function buildSuccessFromState(
  tx: Tx,
  trade: Trade,
  idempotentReplay: boolean,
  warnings: string[] = [],
): Promise<Extract<LogTradeResult, { ok: true }>> {
  const ticker = (trade.ticker ?? "").trim().toUpperCase();
  const all = await tx.portfolio.findMany();
  const cash = await loadCashFromTx(tx, all);
  const position = ticker
    ? all.find((p) => p.ticker.trim().toUpperCase() === ticker) ?? null
    : null;
  const holdings = holdingsMapFromTrades(await tx.trade.findMany());
  const shares = position ? resolveOldShares(position, holdings) : 0;
  const avg = position ? decToNum(position.myAvgCost) : null;
  const px = position ? decToNum(position.currentPrice) : null;
  const mark = px && px > 0 ? px : decToNum(trade.pricePerShare);
  const marketValue =
    shares > SHARES_EPS && mark !== null ? shares * mark : shares <= SHARES_EPS ? 0 : null;

  const slices = buildEquitySlices(
    all,
    ticker,
    shares,
    mark ?? cash.usd,
    holdings,
  );
  const equities = slices.reduce((s, x) => s + x.value, 0);
  const nav = cash.usd + equities;
  const weightPct =
    marketValue !== null && nav > 0 ? (marketValue / nav) * 100 : null;

  return {
    ok: true,
    tradeId: trade.id,
    position: {
      ticker,
      shares,
      myAvgCost: avg,
      addsUsed: position?.addsUsed ?? 0,
      marketValue,
      weightPct,
      deleted: !position || shares <= SHARES_EPS,
    },
    cash,
    warnings,
    idempotentReplay,
  };
}

/**
 * Log a trade and reconcile Portfolio + Config cash in one transaction.
 * Prefer Portfolio.shares; when null, fall back to trade-log net via resolvePositionShares.
 */
export async function logTrade(
  input: LogTradeInput | LogTradeInputParsed,
): Promise<LogTradeResult> {
  const ticker = input.ticker.trim().toUpperCase();
  const absShares = Math.abs(input.shares);
  const price = input.pricePerShare;

  if (isCashTicker(ticker)) {
    return {
      ok: false,
      status: 409,
      reason: "cannot_trade_cash_ticker",
      details: { ticker },
    };
  }

  // Server-derived attribution stamp; resolved outside the transaction (cached 60s).
  // The book is LIVE-only. Null when resolution degraded — unknown, not zero.
  const liveRules = await getRuleSet("LIVE");
  const ruleVersionId =
    liveRules.degraded || liveRules.versionId <= 0 ? null : liveRules.versionId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Idempotent replay
      const existing = await tx.trade.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return buildSuccessFromState(tx, existing, true);
      }

      // Serialize concurrent first trades on the same ticker (advisory + row locks).
      // $executeRaw, not $queryRaw: the adapter cannot deserialize the void return (P2010).
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stock-hq-trade:${ticker}`}))`,
      );
      await tx.$queryRaw`
        SELECT id FROM "Portfolio"
        WHERE upper(ticker) IN (${Prisma.join([ticker, "CASH_USD"])})
        FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT key FROM "Config"
        WHERE key IN (${Prisma.join([...CASH_CONFIG_LOCK_KEYS])})
        FOR UPDATE
      `;

      // 2. Load book of record
      const [position, allPortfolio, limitsRow, allTrades] = await Promise.all([
        tx.portfolio.findFirst({
          where: { ticker: { equals: ticker, mode: "insensitive" } },
        }),
        tx.portfolio.findMany(),
        tx.config.findUnique({ where: { key: CONFIG_KEYS.LIMITS } }),
        tx.trade.findMany(),
      ]);
      const holdings = holdingsMapFromTrades(allTrades);
      const cash = await loadCashFromTx(tx, allPortfolio);
      const limits = parseLimits(limitsRow?.value);

      const direction = TRADE_DIRECTION[input.type];
      const delta = direction * absShares;
      // Prefer Portfolio.shares; if null, fall back to trade-log net (do not treat null as 0).
      const oldShares = resolveOldShares(position, holdings);
      const oldAvg = decToNum(position?.myAvgCost) ?? 0;
      const newSharesRaw = oldShares + delta;

      if (newSharesRaw < -SHARES_EPS) {
        throw new InvariantViolation("insufficient_shares", {
          ticker,
          currentShares: oldShares,
          delta,
          requested: absShares,
        });
      }

      const newShares = Math.abs(newSharesRaw) < SHARES_EPS ? 0 : newSharesRaw;
      const isFullExit = newShares === 0 && direction < 0;
      const isOpenOrAdd = direction > 0;

      // 4. Weighted average cost
      let newAvg = oldAvg;
      if (isOpenOrAdd && newShares > 0) {
        if (oldShares <= SHARES_EPS) {
          newAvg = price;
        } else {
          newAvg = (oldShares * oldAvg + absShares * price) / newShares;
        }
      }
      // Reductions keep avg until flat.

      // 5. Cash
      const tradeValue = absShares * price;
      const cashDelta = isOpenOrAdd ? -tradeValue : tradeValue;
      const newCashUsd = cash.usd + cashDelta;
      const newCashMyr = newCashUsd * cash.fxRate;
      const cashUpdatedAt = new Date().toISOString();

      if (newCashUsd < -MONEY_EPS) {
        throw new InvariantViolation("insufficient_cash", {
          cashBefore: cash.usd,
          cashDelta,
          cashAfter: newCashUsd,
        });
      }

      // 6a. Average-downs (hard)
      const isAverageDown =
        input.type === "ADD" && oldAvg > 0 && price < oldAvg - SHARES_EPS;
      let newAddsUsed = position?.addsUsed ?? null;
      if (isAverageDown) {
        const historical = await countHistoricalAverageDowns(tx, ticker);
        const used = Math.max(newAddsUsed ?? 0, historical);
        if (used >= limits.maxAverageDowns) {
          throw new InvariantViolation("max_average_downs", {
            ticker,
            addsUsed: used,
            maxAverageDowns: limits.maxAverageDowns,
            pricePerShare: price,
            avgCostBasis: oldAvg,
          });
        }
        newAddsUsed = used + 1;
      } else if (newAddsUsed === null) {
        newAddsUsed = 0;
      }

      // Theme / sleeve for the traded name: existing row, else optional input on new BUY.
      const tradeTheme = position?.theme ?? input.theme ?? null;
      const tradeSleeve = position?.sleeve ?? null;
      const increasing =
        input.type === "BUY" || input.type === "ADD";

      // Post-trade equity slices for NAV / caps
      const slices = buildEquitySlices(
        allPortfolio,
        ticker,
        newShares,
        price,
        holdings,
        {
          requireMarks: true,
          newTheme: tradeTheme,
          newSleeve: tradeSleeve,
        },
      );
      const equitiesValue = slices.reduce((sum, s) => sum + s.value, 0);
      const nav = newCashUsd + equitiesValue;
      const positionSlice = slices.find((s) => s.ticker === ticker);
      const positionValue = positionSlice?.value ?? 0;
      const cspxValue = slices.filter((s) => s.isCspx).reduce((sum, s) => sum + s.value, 0);
      const nonCspxNav = nav - cspxValue;

      // 7. Hard invariants
      const minCash = limits.cashFloorPct * nav;
      if (newCashUsd + MONEY_EPS < minCash) {
        throw new InvariantViolation("cash_floor", {
          cash: newCashUsd,
          nav,
          cashFloorPct: limits.cashFloorPct,
          minCash,
        });
      }

      if (
        !isCspxTicker(ticker) &&
        newShares > SHARES_EPS &&
        nonCspxNav > MONEY_EPS
      ) {
        const weight = positionValue / nonCspxNav;
        if (weight > limits.singlePositionPct + 1e-9) {
          throw new InvariantViolation("single_position_cap", {
            ticker,
            weight,
            singlePositionPct: limits.singlePositionPct,
            positionValue,
            nonCspxNav,
          });
        }

        // SPECULATIVE: hard test-starter ceiling on size-increasing fills.
        if (
          increasing &&
          tradeSleeve === "SPECULATIVE" &&
          weight > limits.tierBands.TEST_STARTER[1] + 1e-9
        ) {
          throw new InvariantViolation("speculative_position_cap", {
            ticker,
            weight,
            maxWeight: limits.tierBands.TEST_STARTER[1],
            sleeve: tradeSleeve,
            message:
              "SPECULATIVE names are capped at test-starter band; trim before adding",
          });
        }
      }

      if (tradeTheme && newShares > SHARES_EPS && nav > MONEY_EPS) {
        const themeValue = slices
          .filter((s) => s.theme === tradeTheme)
          .reduce((sum, s) => sum + s.value, 0);
        const themeWeight = themeValue / nav;
        if (themeWeight > limits.themePct + 1e-9) {
          throw new InvariantViolation("theme_cap", {
            theme: tradeTheme,
            themeWeight,
            themePct: limits.themePct,
            themeValue,
            nav,
          });
        }
      }

      // SPECULATIVE sleeve aggregate vs ex-CSPX NAV (size-increasing fills only).
      if (
        increasing &&
        tradeSleeve === "SPECULATIVE" &&
        nonCspxNav > MONEY_EPS
      ) {
        const specValue = slices
          .filter((s) => s.sleeve === "SPECULATIVE")
          .reduce((sum, s) => sum + s.value, 0);
        const specWeight = specValue / nonCspxNav;
        if (specWeight > limits.speculativeSleevePct + 1e-9) {
          throw new InvariantViolation("speculative_sleeve_cap", {
            sleeveWeight: specWeight,
            speculativeSleevePct: limits.speculativeSleevePct,
            specValue,
            nonCspxNav,
            message:
              "SPECULATIVE sleeve aggregate exceeds limit; recycle before adding",
          });
        }
      }

      // 8. Soft tier-band / conviction warnings (same ex-CSPX denominator as hard caps)
      const warnings: string[] = [];
      if (
        !isCspxTicker(ticker) &&
        newShares > SHARES_EPS &&
        nonCspxNav > MONEY_EPS
      ) {
        const weight = positionValue / nonCspxNav;
        if (!weightInBands(weight, limits)) {
          warnings.push(
            `position_weight_outside_tier_bands: ${(weight * 100).toFixed(2)}% not in TEST_STARTER/CONFIRMATION/CONVICTION bands`,
          );
        }
        const conv = position?.conviction;
        if (
          increasing &&
          conv != null &&
          conv <= 2 &&
          weight > limits.tierBands.TEST_STARTER[1] + 1e-9
        ) {
          warnings.push(
            `conviction_size_mismatch: conviction ${conv} but weight ${(weight * 100).toFixed(2)}% exceeds test-starter band`,
          );
        }
        if (increasing && !tradeTheme) {
          warnings.push(
            `uncapped_theme: ${ticker} has null theme — position escapes the 30% theme cluster cap; assign a Theme or accept UNCAPPED_THEME reporting`,
          );
        }
      }

      // PnL on reductions — pnlPct as fraction (0.15 = 15%) to match Notion sync / fmtPct.
      let pnlDollar: number | null = null;
      let pnlPct: number | null = null;
      if (!isOpenOrAdd && oldAvg > 0) {
        pnlDollar = (price - oldAvg) * absShares;
        pnlPct = (price - oldAvg) / oldAvg;
      }

      const status = defaultStatus(input.type, newShares, input.status);
      const tradeDate = parseTradeDate(input.date);
      const title = `${input.type} ${ticker} ${absShares}@${price}`;

      // 9. Insert Trade
      const trade = await tx.trade.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          title,
          ticker,
          type: input.type,
          date: tradeDate,
          pricePerShare: price,
          shares: absShares,
          totalValue: tradeValue,
          pnlDollar,
          pnlPct,
          status,
          // Pre-trade avg so historical average-down counts work (price < avgCostBasis).
          avgCostBasis: oldShares > SHARES_EPS ? oldAvg : newAvg || null,
          ruleVersionId,
          exitReason: input.exitReason ?? null,
          thesisAtEntry: (input.thesisAtEntry ?? undefined) as Prisma.InputJsonValue | undefined,
          notes: (input.notes ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });

      // 10. Portfolio upsert / delete
      let deleted = false;
      if (isFullExit || newShares === 0) {
        if (position) {
          await tx.portfolio.delete({ where: { id: position.id } });
          deleted = true;
        }
        if (input.reAddToWatchlist) {
          await tx.watchlist.upsert({
            where: { ticker },
            create: { ticker },
            update: {},
          });
        }
      } else if (position) {
        await tx.portfolio.update({
          where: { id: position.id },
          data: {
            shares: newShares,
            myAvgCost: newAvg,
            addsUsed: newAddsUsed,
          },
        });
      } else {
        // New position (BUY). Do not write currentPrice — price sync owns marks;
        // in-transaction cap math uses the fill via markPrice() fallback.
        await tx.portfolio.create({
          data: {
            ticker,
            shares: newShares,
            myAvgCost: newAvg,
            addsUsed: newAddsUsed,
            ...(tradeTheme ? { theme: tradeTheme } : {}),
          },
        });
      }

      // BUY → remove from Watchlist
      if (input.type === "BUY") {
        await tx.watchlist.deleteMany({
          where: { ticker: { equals: ticker, mode: "insensitive" } },
        });
      }

      // Cash Config
      await upsertConfig(tx, CONFIG_KEYS.CASH_POSITION_USD, newCashUsd);
      await upsertConfig(tx, CONFIG_KEYS.CASH_POSITION_MYR, newCashMyr);
      await upsertConfig(tx, CONFIG_KEYS.CASH_LAST_UPDATED, cashUpdatedAt);

      // Always sync CASH_USD portfolio row (create if missing) so UI/snapshots stay aligned.
      const cashRow = allPortfolio.find((p) => isCashTicker(p.ticker));
      if (cashRow) {
        await tx.portfolio.update({
          where: { id: cashRow.id },
          data: {
            currentPrice: newCashUsd,
            myAvgCost: newCashUsd,
            lastPriceUpdate: new Date(),
          },
        });
      } else {
        await tx.portfolio.create({
          data: {
            ticker: "CASH_USD",
            currentPrice: newCashUsd,
            myAvgCost: newCashUsd,
            lastPriceUpdate: new Date(),
          },
        });
      }

      // 11. Cash reconciliation: Config cash vs independent Portfolio CASH_USD book check
      const portfolioAfter = await tx.portfolio.findMany();
      const configCash = newCashUsd;
      const cashRowAfter = portfolioAfter.find((p) => isCashTicker(p.ticker));
      if (cashRowAfter) {
        const portfolioCash = notionCashBalanceUsd(
          cashRowAfter.currentPrice,
          cashRowAfter.myAvgCost,
        );
        if (Math.abs(configCash - portfolioCash) > MONEY_EPS) {
          throw new InvariantViolation("cash_reconciliation", {
            configCash,
            portfolioCash,
            drift: Math.abs(configCash - portfolioCash),
          });
        }
      }
      if (newShares < -SHARES_EPS) {
        throw new InvariantViolation("cash_reconciliation", {
          reason: "negative_shares",
          shares: newShares,
        });
      }

      const finalSlices = buildEquitySlices(
        portfolioAfter,
        ticker,
        deleted ? 0 : newShares,
        price,
        holdings,
        { requireMarks: true, newTheme: tradeTheme },
      );
      const finalEquities = finalSlices.reduce((s, x) => s + x.value, 0);
      const recomputedNav = configCash + finalEquities;
      if (
        !Number.isFinite(recomputedNav) ||
        !Number.isFinite(finalEquities) ||
        recomputedNav < -MONEY_EPS ||
        finalEquities < -MONEY_EPS
      ) {
        throw new InvariantViolation("cash_reconciliation", {
          reason: "nav_not_finite_or_negative",
          cash: configCash,
          equities: finalEquities,
          nav: recomputedNav,
        });
      }

      const marketValue = deleted ? 0 : newShares * (decToNum(position?.currentPrice) ?? price);
      const weightPct = recomputedNav > 0 ? (marketValue / recomputedNav) * 100 : null;

      return {
        ok: true,
        tradeId: trade.id,
        position: {
          ticker,
          shares: deleted ? 0 : newShares,
          myAvgCost: deleted ? null : newAvg,
          addsUsed: deleted ? 0 : (newAddsUsed ?? 0),
          marketValue: deleted ? 0 : marketValue,
          weightPct: deleted ? null : weightPct,
          deleted,
        },
        cash: {
          usd: newCashUsd,
          myr: newCashMyr,
          fxRate: cash.fxRate,
          lastUpdated: cashUpdatedAt,
        },
        warnings,
        idempotentReplay: false,
      };
    }, TX_OPTS);

    if (result.ok) {
      try {
        await syncTrackedTickersFromDb();
      } catch (err) {
        console.error("[logTrade] syncTrackedTickersFromDb failed", err);
      }
    }
    return result as LogTradeResult;
  } catch (err) {
    if (err instanceof InvariantViolation) {
      return {
        ok: false,
        status: 409,
        reason: err.reason,
        details: err.details,
      };
    }
    throw err;
  }
}
