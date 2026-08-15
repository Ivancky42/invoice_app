import {
  assetToDTO,
  getCryptoAssets,
  getCryptoTrades,
  tradeToDTO,
} from "@/lib/crypto/db";
import { CryptoAssetStatus } from "@/generated/prisma/client";
import { AddTradeForm, type TradeAssetOption } from "@/app/crypto/_components/AddTradeForm";
import { fmtMoney, fmtPrice, fmtQty, fmtShortDateUtc } from "@/lib/crypto/format";

export const revalidate = 900;

function sideBadge(side: string): string {
  return side === "BUY" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700";
}

export default async function CryptoTradesPage() {
  const [assetsRaw, tradesRaw] = await Promise.all([
    getCryptoAssets(),
    getCryptoTrades(200),
  ]);

  const trades = tradesRaw.map(tradeToDTO);
  const assetOptions: TradeAssetOption[] = assetsRaw
    .map(assetToDTO)
    .filter((a) => a.status === CryptoAssetStatus.PORTFOLIO || a.status === CryptoAssetStatus.WATCHLIST)
    .map((a) => ({ id: a.id, symbol: a.symbol }));

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Trades</h1>
        <p className="text-sm text-gray-500">Manual trade log. BUY/SELL can update the asset holding.</p>
      </section>

      <section className="card p-5">
        <h2 className="font-medium mb-3">Add trade</h2>
        <AddTradeForm assets={assetOptions} />
      </section>

      <section className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Symbol</th>
              <th className="text-left px-4 py-2">Side</th>
              <th className="text-right px-4 py-2">Qty</th>
              <th className="text-right px-4 py-2">Price</th>
              <th className="text-right px-4 py-2">Value</th>
              <th className="text-right px-4 py-2">Fee</th>
              <th className="text-left px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {trades.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No trades recorded yet.
                </td>
              </tr>
            )}
            {trades.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 whitespace-nowrap">{fmtShortDateUtc(t.tradedAt)}</td>
                <td className="px-4 py-3 font-medium">{t.symbol || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${sideBadge(t.side)}`}>{t.side}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtQty(t.quantity)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtPrice(t.price)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {t.quantity != null && t.price != null ? fmtMoney(t.quantity * t.price) : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(t.fee)}</td>
                <td className="px-4 py-3 text-gray-700">{t.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
