import {
  assetToDTO,
  briefToDTO,
  getBriefs,
  getCryptoAssets,
  getLatestSnapshots,
  snapshotToDTO,
} from "@/lib/crypto/db";
import { CryptoAssetStatus } from "@/generated/prisma/client";
import { CryptoAssetTable, type CryptoAssetRow } from "@/app/crypto/_components/CryptoAssetTable";
import { CryptoNotesModalField } from "@/app/crypto/_components/CryptoNotesModalField";
import { GraduateForm } from "@/app/crypto/_components/GraduateForm";
import { parseCalls, type BriefCall } from "@/app/crypto/_components/CryptoBriefReader";

export const revalidate = 900;

export default async function CryptoWatchlistPage() {
  const [assetsRaw, snapMapRaw, briefsRaw] = await Promise.all([
    getCryptoAssets(CryptoAssetStatus.WATCHLIST),
    getLatestSnapshots(),
    getBriefs(1),
  ]);

  const assets = assetsRaw.map(assetToDTO);
  const callMap = new Map<string, BriefCall>();
  if (briefsRaw[0]) {
    for (const c of parseCalls(briefToDTO(briefsRaw[0]).calls)) callMap.set(c.symbol.toUpperCase(), c);
  }

  const rows: CryptoAssetRow[] = assets.map((asset) => {
    const snap = snapMapRaw.get(asset.id);
    return {
      asset,
      snapshot: snap ? snapshotToDTO(snap) : null,
      call: callMap.get(asset.symbol.toUpperCase()) ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Watchlist</h1>
        <p className="text-sm text-gray-500">Tokens under consideration — promote to the portfolio when ready.</p>
      </section>

      <CryptoAssetTable rows={rows} showHoldings={false} emptyMessage="Watchlist is empty." />

      {assets.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Notes &amp; graduation</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {assets.map((a) => (
              <div key={a.id} className="card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-medium">{a.symbol}</span>
                  {a.keyCatalyst && <span className="text-xs text-gray-500">{a.keyCatalyst}</span>}
                </div>
                {a.thesis && <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.thesis}</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  <CryptoNotesModalField assetId={a.id} field="thesis" label="Thesis" value={a.thesis} context={a.symbol} />
                  <CryptoNotesModalField assetId={a.id} field="notes" label="Notes" value={a.notes} context={a.symbol} />
                </div>
                <div className="pt-2 border-t border-gray-100">
                  <GraduateForm assetId={a.id} symbol={a.symbol} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
