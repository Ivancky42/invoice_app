import { prisma } from "@/lib/prisma";
import { snapshotDateGMT8 } from "@/lib/stocks/portfolioTotals";
import { CryptoAssetStatus } from "@/generated/prisma/client";
import type { CryptoAsset, Prisma } from "@/generated/prisma/client";
import { cgMarkets, cgTrending, cgOhlcDaily, type CgMarket } from "@/lib/crypto/coingecko";
import { binanceKlines, binanceFundingRate, binanceOpenInterest } from "@/lib/crypto/binance";
import { llamaChainTvl } from "@/lib/crypto/defillama";
import { fetchCatalysts } from "@/lib/crypto/rss";
import {
  rsi14,
  sma,
  detectMaCross,
  isVolumeSpike,
  beta30d,
  computeFlags,
} from "@/lib/crypto/signals";
import { CRYPTO_SYNC_SOURCE } from "@/lib/crypto/db";

const BTC_COINGECKO_ID = "bitcoin";
const OHLC_FALLBACK_SPACING_MS = 1500;
const TRENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type SyncStep = { name: string; count?: number; ok: boolean; error?: string };

export type CryptoSyncResult = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  results: Record<string, number | null>;
  errors?: string[];
};

/** Mutable per-asset accumulator for the day's snapshot. */
type Accumulator = {
  price: number | null;
  marketCap: number | null;
  volume24h: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  athPrice: number | null;
  athDrawdownPct: number | null;
  circulatingPct: number | null;
  rsi14: number | null;
  ma20: number | null;
  ma50: number | null;
  maCross: "GOLDEN" | "DEATH" | null;
  volumeSpike: boolean;
  beta30dBtc: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  tvl: number | null;
  tvlChange7dPct: number | null;
};

function emptyAcc(): Accumulator {
  return {
    price: null,
    marketCap: null,
    volume24h: null,
    change24hPct: null,
    change7dPct: null,
    athPrice: null,
    athDrawdownPct: null,
    circulatingPct: null,
    rsi14: null,
    ma20: null,
    ma50: null,
    maCross: null,
    volumeSpike: false,
    beta30dBtc: null,
    fundingRate: null,
    openInterest: null,
    tvl: null,
    tvlChange7dPct: null,
  };
}

async function runStep(name: string, fn: () => Promise<number>): Promise<SyncStep> {
  try {
    const count = await fn();
    return { name, count, ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[crypto-sync] ${name} failed:`, msg);
    return { name, ok: false, error: msg };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Collect daily closes for an asset: Binance klines, else CoinGecko OHLC fallback. */
async function collectCloses(
  asset: CryptoAsset,
  usedFallback: { value: boolean },
): Promise<{ closes: number[]; volumes: number[]; fromBinance: boolean }> {
  if (asset.binanceSymbol) {
    const klines = await binanceKlines(asset.binanceSymbol, 60);
    if (klines.length > 0) {
      return {
        closes: klines.map((k) => k.close),
        volumes: klines.map((k) => k.volume),
        fromBinance: true,
      };
    }
  }
  // Fallback: space out CoinGecko OHLC calls to respect Demo rate limits.
  if (usedFallback.value) await sleep(OHLC_FALLBACK_SPACING_MS);
  usedFallback.value = true;
  const closes = await cgOhlcDaily(asset.coingeckoId, 91);
  return { closes, volumes: [], fromBinance: false };
}

/**
 * Run the full crypto sync (markets → signals → derivatives → tvl → trending →
 * catalysts), upserting one CryptoMetricSnapshot per tracked asset per GMT+8 day.
 * Always resolves — per-step failures are collected, never thrown.
 */
export async function runCryptoSync(): Promise<CryptoSyncResult> {
  const startedAt = new Date();
  await prisma.syncStatus.upsert({
    where: { source: CRYPTO_SYNC_SOURCE },
    create: { source: CRYPTO_SYNC_SOURCE, lastRunAt: startedAt },
    update: { lastRunAt: startedAt, lastError: null },
  });

  const snapshotDate = snapshotDateGMT8();
  const steps: SyncStep[] = [];

  // Tracked = everything except ARCHIVED.
  const assets = await prisma.cryptoAsset.findMany({
    where: { status: { not: CryptoAssetStatus.ARCHIVED } },
  });
  const acc = new Map<string, Accumulator>();
  for (const a of assets) acc.set(a.id, emptyAcc());

  // BTC closes are needed for beta; keep them across the klines step.
  let btcCloses: number[] = [];

  // --- markets ---
  steps.push(
    await runStep("markets", async () => {
      const ids = assets.map((a) => a.coingeckoId);
      const markets = await cgMarkets(ids);
      const byId = new Map<string, CgMarket>(markets.map((m) => [m.id, m]));
      let n = 0;
      for (const a of assets) {
        const m = byId.get(a.coingeckoId);
        if (!m) continue;
        const d = acc.get(a.id)!;
        d.price = m.current_price ?? null;
        d.marketCap = m.market_cap ?? null;
        d.volume24h = m.total_volume ?? null;
        d.change24hPct = m.price_change_percentage_24h ?? null;
        d.change7dPct = m.price_change_percentage_7d_in_currency ?? null;
        d.athPrice = m.ath ?? null;
        d.athDrawdownPct = m.ath_change_percentage ?? null;
        const supply = m.circulating_supply;
        const max = m.max_supply ?? m.total_supply;
        d.circulatingPct =
          supply != null && max && max > 0 ? (supply / max) * 100 : null;
        n++;
      }
      return n;
    }),
  );

  // --- klines / signals ---
  steps.push(
    await runStep("signals", async () => {
      const usedFallback = { value: false };
      // Compute BTC first so beta has a reference series.
      const closesByAsset = new Map<string, number[]>();
      const btcAsset = assets.find((a) => a.coingeckoId === BTC_COINGECKO_ID);
      if (btcAsset) {
        const { closes, volumes, fromBinance } = await collectCloses(btcAsset, usedFallback);
        btcCloses = closes;
        closesByAsset.set(btcAsset.id, closes);
        applySignals(acc.get(btcAsset.id)!, closes, volumes, fromBinance, btcCloses);
      }
      let n = 0;
      for (const a of assets) {
        if (a.coingeckoId === BTC_COINGECKO_ID) {
          n++;
          continue;
        }
        const { closes, volumes, fromBinance } = await collectCloses(a, usedFallback);
        closesByAsset.set(a.id, closes);
        if (closes.length > 0) {
          applySignals(acc.get(a.id)!, closes, volumes, fromBinance, btcCloses);
          n++;
        }
      }
      return n;
    }),
  );

  // --- derivatives (optional: futures may be geo-blocked) ---
  steps.push(
    await runStep("derivatives", async () => {
      let n = 0;
      for (const a of assets) {
        if (!a.binanceSymbol) continue;
        const [funding, oi] = await Promise.all([
          binanceFundingRate(a.binanceSymbol),
          binanceOpenInterest(a.binanceSymbol),
        ]);
        const d = acc.get(a.id)!;
        d.fundingRate = funding;
        d.openInterest = oi;
        if (funding !== null || oi !== null) n++;
      }
      return n;
    }),
  );

  // --- tvl ---
  steps.push(
    await runStep("tvl", async () => {
      let n = 0;
      for (const a of assets) {
        if (!a.llamaSlug) continue;
        const tvl = await llamaChainTvl(a.llamaSlug);
        if (!tvl) continue;
        const d = acc.get(a.id)!;
        d.tvl = tvl.tvl;
        d.tvlChange7dPct = tvl.change7dPct;
        n++;
      }
      return n;
    }),
  );

  // --- write snapshots (derived from the accumulator) ---
  steps.push(
    await runStep("snapshots", async () => {
      let n = 0;
      for (const a of assets) {
        const d = acc.get(a.id)!;
        const flags = computeFlags({
          rsi14: d.rsi14,
          maCross: d.maCross,
          volumeSpike: d.volumeSpike,
          fundingRate: d.fundingRate,
          tvlChange7dPct: d.tvlChange7dPct,
          athDrawdownPct: d.athDrawdownPct,
        });
        const data: Prisma.CryptoMetricSnapshotUncheckedCreateInput = {
          assetId: a.id,
          snapshotDate,
          price: d.price,
          marketCap: d.marketCap,
          volume24h: d.volume24h,
          change24hPct: d.change24hPct,
          change7dPct: d.change7dPct,
          athPrice: d.athPrice,
          athDrawdownPct: d.athDrawdownPct,
          circulatingPct: d.circulatingPct,
          rsi14: d.rsi14,
          ma20: d.ma20,
          ma50: d.ma50,
          maCross: d.maCross,
          volumeSpike: d.volumeSpike,
          beta30dBtc: d.beta30dBtc,
          fundingRate: d.fundingRate,
          openInterest: d.openInterest,
          tvl: d.tvl,
          tvlChange7dPct: d.tvlChange7dPct,
          flags,
        };
        // Exclude assetId/snapshotDate from the update payload.
        const { assetId: _a, snapshotDate: _s, ...update } = data;
        void _a;
        void _s;
        await prisma.cryptoMetricSnapshot.upsert({
          where: { assetId_snapshotDate: { assetId: a.id, snapshotDate } },
          create: data,
          update,
        });
        n++;
      }
      return n;
    }),
  );

  // --- trending (graduate discovery + archive stale) ---
  steps.push(
    await runStep("trending", async () => {
      const trending = await cgTrending();
      const rows = await prisma.cryptoAsset.findMany({
        select: { coingeckoId: true, symbol: true },
      });
      const known = new Set(rows.map((a) => a.coingeckoId));
      const knownSymbols = new Set(rows.map((a) => a.symbol));
      let added = 0;
      const now = new Date();
      for (const c of trending) {
        if (known.has(c.id)) continue;
        // symbol is @unique — a trending coin can collide with a tracked asset
        // that has the same ticker but a different coingeckoId.
        if (knownSymbols.has(c.symbol.toUpperCase())) continue;
        await prisma.cryptoAsset.upsert({
          where: { coingeckoId: c.id },
          create: {
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            coingeckoId: c.id,
            status: CryptoAssetStatus.TRENDING,
            trendingAt: now,
          },
          update: { trendingAt: now, status: CryptoAssetStatus.TRENDING },
        });
        known.add(c.id);
        knownSymbols.add(c.symbol.toUpperCase());
        added++;
      }
      // Archive TRENDING rows not re-seen in 7 days.
      const cutoff = new Date(Date.now() - TRENDING_MAX_AGE_MS);
      await prisma.cryptoAsset.updateMany({
        where: {
          status: CryptoAssetStatus.TRENDING,
          OR: [{ trendingAt: { lt: cutoff } }, { trendingAt: null }],
        },
        data: { status: CryptoAssetStatus.ARCHIVED },
      });
      return added;
    }),
  );

  // --- catalysts (RSS news matched to tracked symbols) ---
  steps.push(
    await runStep("catalysts", async () => {
      const tracked = assets.map((a) => ({ symbol: a.symbol, name: a.name }));
      const catalysts = await fetchCatalysts(tracked);
      if (catalysts.length === 0) return 0;
      const res = await prisma.cryptoCatalyst.createMany({
        data: catalysts.map((c) => ({
          title: c.title,
          url: c.url,
          source: c.source,
          publishedAt: c.publishedAt,
          symbols: c.symbols,
        })),
        skipDuplicates: true,
      });
      return res.count;
    }),
  );

  const allOk = steps.every((s) => s.ok);
  const rowCounts: Record<string, number | null> = {};
  for (const s of steps) rowCounts[s.name] = s.count ?? null;
  const errors = steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.error}`);
  const completedAt = new Date();

  await prisma.syncStatus.update({
    where: { source: CRYPTO_SYNC_SOURCE },
    data: {
      lastSuccessAt: allOk ? completedAt : undefined,
      lastError: errors.length ? errors.join(" | ") : null,
      rowCounts,
    },
  });

  return {
    ok: allOk,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    results: rowCounts,
    errors: errors.length ? errors : undefined,
  };
}

/** Compute technical signals from closes/volumes into the accumulator. */
function applySignals(
  d: Accumulator,
  closes: number[],
  volumes: number[],
  fromBinance: boolean,
  btcCloses: number[],
): void {
  if (closes.length === 0) return;
  d.rsi14 = rsi14(closes);
  d.ma20 = sma(closes, 20);
  d.ma50 = sma(closes, 50);
  d.maCross = detectMaCross(closes, 3);
  // Volume spike requires real volume — skip on CoinGecko closes-only fallback.
  d.volumeSpike = fromBinance ? isVolumeSpike(volumes, 30) : false;
  if (btcCloses.length > 0) d.beta30dBtc = beta30d(closes, btcCloses);
}
