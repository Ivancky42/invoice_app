import Link from "next/link";
import {
  assetToDTO,
  briefToDTO,
  catalystToDTO,
  getBriefs,
  getCatalysts,
  getCryptoAssets,
  getCryptoSyncStatus,
  getLatestSnapshots,
  snapshotToDTO,
} from "@/lib/crypto/db";
import { CryptoAssetStatus } from "@/generated/prisma/client";
import { CryptoBriefCard } from "@/app/crypto/_components/CryptoBriefCard";
import { TrendingList, type TrendingItem } from "@/app/crypto/_components/TrendingList";
import { ManualSyncButton } from "@/app/crypto/_components/ManualSyncButton";
import {
  changeColor,
  fearGreedMeta,
  flagBadgeClass,
  flagLabel,
  fmtMoney,
  fmtPctSigned,
  fmtShortDateUtc,
  unrealizedPnl,
} from "@/lib/crypto/format";

export const revalidate = 900;

function timeAgo(d: Date | null): string {
  if (!d) return "never";
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default async function CryptoOverview() {
  const [assetsRaw, snapMapRaw, catalystsRaw, briefsRaw, status] = await Promise.all([
    getCryptoAssets(),
    getLatestSnapshots(),
    getCatalysts(7),
    getBriefs(1),
    getCryptoSyncStatus(),
  ]);

  const assets = assetsRaw.map(assetToDTO);
  const snapMap = new Map(
    Array.from(snapMapRaw.entries()).map(([id, s]) => [id, snapshotToDTO(s)]),
  );
  const catalysts = catalystsRaw.slice(0, 8).map(catalystToDTO);
  const brief = briefsRaw[0] ? briefToDTO(briefsRaw[0]) : null;

  const portfolio = assets.filter((a) => a.status === CryptoAssetStatus.PORTFOLIO);
  const watchlist = assets.filter((a) => a.status === CryptoAssetStatus.WATCHLIST);
  const trending = assets.filter((a) => a.status === CryptoAssetStatus.TRENDING);

  let marketValue = 0;
  let costBasis = 0;
  let hasValue = false;
  for (const a of portfolio) {
    const price = snapMap.get(a.id)?.price ?? null;
    const p = unrealizedPnl(price, a.avgCost, a.quantity);
    if (p.marketValue != null) {
      marketValue += p.marketValue;
      costBasis += p.costBasis ?? 0;
      hasValue = true;
    }
  }
  const unrealized = marketValue - costBasis;
  const unrealizedPct = costBasis > 0 ? (unrealized / costBasis) * 100 : null;

  // Active flags across all tracked assets.
  const flagRows = assets
    .map((a) => ({ symbol: a.symbol, flags: snapMap.get(a.id)?.flags ?? [] }))
    .filter((r) => r.flags.length > 0);

  const trendingItems: TrendingItem[] = trending.map((a) => ({
    id: a.id,
    symbol: a.symbol,
    name: a.name,
    change24hPct: snapMap.get(a.id)?.change24hPct ?? null,
  }));

  const fg = fearGreedMeta(brief?.fearGreed);

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Crypto</h1>
          <p className="text-sm text-gray-500">
            Read-only Neon cache. Daily ~05:45 GMT+8 market sync; AI brief ~06:15 GMT+8 (page revalidate 15m).
          </p>
        </div>
        <ManualSyncButton />
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-xs text-gray-500">Portfolio value</div>
          <div className="text-2xl font-semibold mt-1">{hasValue ? fmtMoney(marketValue) : "—"}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Cost basis</div>
          <div className="text-2xl font-semibold mt-1">{hasValue ? fmtMoney(costBasis) : "—"}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Unrealized P&L</div>
          <div className={`text-2xl font-semibold mt-1 ${changeColor(hasValue ? unrealized : null)}`}>
            {hasValue ? fmtMoney(unrealized) : "—"}
          </div>
          {hasValue && unrealizedPct != null && (
            <div className={`text-xs mt-1 ${changeColor(unrealizedPct)}`}>{fmtPctSigned(unrealizedPct)}</div>
          )}
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Fear &amp; Greed</div>
          <div className="text-2xl font-semibold mt-1">{brief?.fearGreed ?? "—"}</div>
          {brief?.fearGreed != null && (
            <span className={`badge mt-1 ${fg.className}`}>{fg.label}</span>
          )}
        </div>
      </section>

      <CryptoBriefCard brief={brief} />

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link href="/crypto/portfolio" className="card p-4 hover:shadow-sm transition">
          <div className="text-xs text-gray-500">Holdings</div>
          <div className="text-2xl font-semibold mt-1">{portfolio.length}</div>
        </Link>
        <Link href="/crypto/watchlist" className="card p-4 hover:shadow-sm transition">
          <div className="text-xs text-gray-500">Watching</div>
          <div className="text-2xl font-semibold mt-1">{watchlist.length}</div>
        </Link>
        <Link href="/crypto/trades" className="card p-4 hover:shadow-sm transition">
          <div className="text-xs text-gray-500">Trending</div>
          <div className="text-2xl font-semibold mt-1">{trending.length}</div>
        </Link>
        <Link href="/crypto/catalysts" className="card p-4 hover:shadow-sm transition">
          <div className="text-xs text-gray-500">Catalysts (7d)</div>
          <div className="text-2xl font-semibold mt-1">{catalystsRaw.length}</div>
        </Link>
      </section>

      {flagRows.length > 0 && (
        <section className="card p-5">
          <h2 className="font-medium mb-3">Active signals</h2>
          <div className="space-y-2">
            {flagRows.map((r) => (
              <div key={r.symbol} className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm w-12">{r.symbol}</span>
                {r.flags.map((f) => (
                  <span key={f} className={`badge ${flagBadgeClass(f)}`}>
                    {flagLabel(f)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h2 className="font-medium">Trending</h2>
          <Link href="/crypto/watchlist" className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline">
            Watchlist →
          </Link>
        </div>
        <TrendingList items={trendingItems} />
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h2 className="font-medium">Recent catalysts</h2>
          <Link href="/crypto/catalysts" className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline">
            All catalysts →
          </Link>
        </div>
        {catalysts.length === 0 ? (
          <p className="text-sm text-gray-500 px-5 py-4">No recent catalysts.</p>
        ) : (
          <ul className="divide-y">
            {catalysts.map((c) => (
              <li key={c.id} className="px-5 py-3">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-900 hover:underline"
                >
                  {c.title}
                </a>
                <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>{c.source}</span>
                  {c.publishedAt && <span>· {fmtShortDateUtc(c.publishedAt)}</span>}
                  {c.symbols.map((s) => (
                    <span key={s} className="badge bg-gray-100 text-gray-600">
                      {s}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="text-xs text-gray-500 flex items-center justify-between gap-3 flex-wrap">
        <span>
          Last sync {timeAgo(status?.lastSuccessAt ?? status?.lastRunAt ?? null)}
          {status?.lastError ? ` · last error: ${status.lastError}` : ""}
        </span>
        <ManualSyncButton />
      </footer>
    </div>
  );
}
