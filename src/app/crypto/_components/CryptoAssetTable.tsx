import type { CryptoAssetDTO, CryptoSnapshotDTO } from "@/lib/crypto/db";
import type { BriefCall } from "@/app/crypto/_components/CryptoBriefReader";
import {
  actionBadgeClass,
  changeColor,
  flagBadgeClass,
  flagLabel,
  fmtMoney,
  fmtNum,
  fmtPctSigned,
  fmtPrice,
  fmtQty,
  unrealizedPnl,
} from "@/lib/crypto/format";

export type CryptoAssetRow = {
  asset: CryptoAssetDTO;
  snapshot: CryptoSnapshotDTO | null;
  call: BriefCall | null;
};

/** Shared table for portfolio (with holdings) and watchlist (without). */
export function CryptoAssetTable({
  rows,
  showHoldings,
  emptyMessage,
}: {
  rows: CryptoAssetRow[];
  showHoldings: boolean;
  emptyMessage: string;
}) {
  const colCount = showHoldings ? 9 : 6;

  return (
    <section className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2">Symbol</th>
            <th className="text-right px-4 py-2">Price</th>
            <th className="text-right px-4 py-2">24h</th>
            <th className="text-right px-4 py-2">7d</th>
            {showHoldings && <th className="text-right px-4 py-2">Qty</th>}
            {showHoldings && <th className="text-right px-4 py-2">Avg / Value</th>}
            {showHoldings && <th className="text-right px-4 py-2">uPnL</th>}
            <th className="text-right px-4 py-2">RSI</th>
            <th className="text-left px-4 py-2">Flags · Call</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 && (
            <tr>
              <td colSpan={colCount} className="px-4 py-8 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map(({ asset, snapshot, call }) => {
            const price = snapshot?.price ?? null;
            const pnl = showHoldings ? unrealizedPnl(price, asset.avgCost, asset.quantity) : null;
            const flags = snapshot?.flags ?? [];
            return (
              <tr key={asset.id} className="hover:bg-gray-50 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium">{asset.symbol}</div>
                  <div className="text-xs text-gray-500">{asset.name}</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtPrice(price)}</td>
                <td className={`px-4 py-3 text-right tabular-nums ${changeColor(snapshot?.change24hPct)}`}>
                  {fmtPctSigned(snapshot?.change24hPct)}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${changeColor(snapshot?.change7dPct)}`}>
                  {fmtPctSigned(snapshot?.change7dPct)}
                </td>
                {showHoldings && (
                  <td className="px-4 py-3 text-right tabular-nums">{fmtQty(asset.quantity)}</td>
                )}
                {showHoldings && (
                  <td className="px-4 py-3 text-right tabular-nums">
                    <div>{fmtPrice(asset.avgCost)}</div>
                    <div className="text-xs text-gray-500">{fmtMoney(pnl?.marketValue ?? null)}</div>
                  </td>
                )}
                {showHoldings && (
                  <td className="px-4 py-3 text-right tabular-nums">
                    <div className={changeColor(pnl?.dollar ?? null)}>
                      {pnl?.dollar != null ? fmtMoney(pnl.dollar) : "—"}
                    </div>
                    <div className="text-xs text-gray-500">{fmtPctSigned(pnl?.pct ?? null)}</div>
                  </td>
                )}
                <td className="px-4 py-3 text-right tabular-nums">{fmtNum(snapshot?.rsi14, 0)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {call && (
                      <span className={`badge ${actionBadgeClass(call.action)}`} title={call.reason ?? undefined}>
                        {call.action}
                      </span>
                    )}
                    {flags.map((f) => (
                      <span key={f} className={`badge ${flagBadgeClass(f)}`}>
                        {flagLabel(f)}
                      </span>
                    ))}
                    {!call && flags.length === 0 && <span className="text-gray-400">—</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
