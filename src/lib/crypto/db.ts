import { prisma } from "@/lib/prisma";
import type {
  CryptoAsset,
  CryptoTrade,
  CryptoMetricSnapshot,
  CryptoCatalyst,
  CryptoDailyBrief,
  CryptoLearningLog,
  SyncStatus,
  Prisma,
} from "@/generated/prisma/client";
import { CryptoAssetStatus, CryptoLearningKind } from "@/generated/prisma/client";

export const CRYPTO_SYNC_SOURCE = "crypto";

/** Decimal | null → number | null (JSON-serializable). */
function num(v: Prisma.Decimal | null | undefined): number | null {
  return v != null ? Number(v) : null;
}

/** Date | null → ISO string | null. */
function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export type CryptoAssetDTO = {
  id: string;
  symbol: string;
  name: string;
  coingeckoId: string;
  binanceSymbol: string | null;
  llamaSlug: string | null;
  status: CryptoAssetStatus;
  quantity: number | null;
  avgCost: number | null;
  thesis: string | null;
  notes: string | null;
  keyCatalyst: string | null;
  targetPrice: number | null;
  stopLoss: number | null;
  categories: unknown;
  trendingAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function assetToDTO(a: CryptoAsset): CryptoAssetDTO {
  return {
    id: a.id,
    symbol: a.symbol,
    name: a.name,
    coingeckoId: a.coingeckoId,
    binanceSymbol: a.binanceSymbol,
    llamaSlug: a.llamaSlug,
    status: a.status,
    quantity: num(a.quantity),
    avgCost: num(a.avgCost),
    thesis: a.thesis,
    notes: a.notes,
    keyCatalyst: a.keyCatalyst,
    targetPrice: num(a.targetPrice),
    stopLoss: num(a.stopLoss),
    categories: a.categories ?? null,
    trendingAt: iso(a.trendingAt),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export type CryptoSnapshotDTO = {
  assetId: string;
  snapshotDate: string;
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
  maCross: string | null;
  volumeSpike: boolean;
  beta30dBtc: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  tvl: number | null;
  tvlChange7dPct: number | null;
  flags: string[];
};

export function snapshotToDTO(s: CryptoMetricSnapshot): CryptoSnapshotDTO {
  return {
    assetId: s.assetId,
    snapshotDate: s.snapshotDate.toISOString(),
    price: num(s.price),
    marketCap: num(s.marketCap),
    volume24h: num(s.volume24h),
    change24hPct: num(s.change24hPct),
    change7dPct: num(s.change7dPct),
    athPrice: num(s.athPrice),
    athDrawdownPct: num(s.athDrawdownPct),
    circulatingPct: num(s.circulatingPct),
    rsi14: num(s.rsi14),
    ma20: num(s.ma20),
    ma50: num(s.ma50),
    maCross: s.maCross,
    volumeSpike: s.volumeSpike,
    beta30dBtc: num(s.beta30dBtc),
    fundingRate: num(s.fundingRate),
    openInterest: num(s.openInterest),
    tvl: num(s.tvl),
    tvlChange7dPct: num(s.tvlChange7dPct),
    flags: Array.isArray(s.flags) ? (s.flags as string[]) : [],
  };
}

export type CryptoTradeDTO = {
  id: string;
  assetId: string;
  symbol: string;
  side: string;
  quantity: number | null;
  price: number | null;
  fee: number | null;
  tradedAt: string;
  notes: string | null;
};

export function tradeToDTO(t: CryptoTrade & { asset?: { symbol: string } | null }): CryptoTradeDTO {
  return {
    id: t.id,
    assetId: t.assetId,
    symbol: t.asset?.symbol ?? "",
    side: t.side,
    quantity: num(t.quantity),
    price: num(t.price),
    fee: num(t.fee),
    tradedAt: t.tradedAt.toISOString(),
    notes: t.notes,
  };
}

export type CryptoCatalystDTO = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  symbols: string[];
};

export function catalystToDTO(c: CryptoCatalyst): CryptoCatalystDTO {
  return {
    id: c.id,
    title: c.title,
    url: c.url,
    source: c.source,
    publishedAt: iso(c.publishedAt),
    symbols: Array.isArray(c.symbols) ? (c.symbols as string[]) : [],
  };
}

export type CryptoBriefDTO = {
  briefDate: string;
  marketSummary: string;
  fearGreed: number | null;
  calls: unknown;
  watchlistNotes: string | null;
};

export function briefToDTO(b: CryptoDailyBrief): CryptoBriefDTO {
  return {
    briefDate: b.briefDate.toISOString(),
    marketSummary: b.marketSummary,
    fearGreed: b.fearGreed,
    calls: b.calls,
    watchlistNotes: b.watchlistNotes,
  };
}

export type CryptoLearningDTO = {
  kind: CryptoLearningKind;
  logDate: string;
  evaluations: unknown;
  heuristics: string | null;
  summary: string;
};

export function learningToDTO(l: CryptoLearningLog): CryptoLearningDTO {
  return {
    kind: l.kind,
    logDate: l.logDate.toISOString(),
    evaluations: l.evaluations ?? null,
    heuristics: l.heuristics,
    summary: l.summary,
  };
}

// === Read helpers ===

export async function getCryptoAssets(status?: CryptoAssetStatus): Promise<CryptoAsset[]> {
  return prisma.cryptoAsset.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ status: "asc" }, { symbol: "asc" }],
  });
}

/** Latest snapshot per asset, keyed by assetId. */
export async function getLatestSnapshots(): Promise<Map<string, CryptoMetricSnapshot>> {
  const snaps = await prisma.cryptoMetricSnapshot.findMany({
    orderBy: { snapshotDate: "desc" },
    distinct: ["assetId"],
  });
  return new Map(snaps.map((s) => [s.assetId, s]));
}

export async function getCryptoTrades(
  limit = 100,
): Promise<Array<CryptoTrade & { asset: { symbol: string } }>> {
  return prisma.cryptoTrade.findMany({
    include: { asset: { select: { symbol: true } } },
    orderBy: { tradedAt: "desc" },
    take: limit,
  });
}

export async function getCatalysts(days = 7): Promise<CryptoCatalyst[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return prisma.cryptoCatalyst.findMany({
    where: { OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }] },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
}

export async function getBriefs(limit = 30): Promise<CryptoDailyBrief[]> {
  return prisma.cryptoDailyBrief.findMany({
    orderBy: { briefDate: "desc" },
    take: limit,
  });
}

export async function getLearnings(
  kind?: CryptoLearningKind,
  limit = 30,
): Promise<CryptoLearningLog[]> {
  return prisma.cryptoLearningLog.findMany({
    where: kind ? { kind } : undefined,
    orderBy: { logDate: "desc" },
    take: limit,
  });
}

export async function getCryptoSyncStatus(): Promise<SyncStatus | null> {
  return prisma.syncStatus.findUnique({ where: { source: CRYPTO_SYNC_SOURCE } });
}
