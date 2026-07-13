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
import { parseCalls, type BriefCall } from "@/app/crypto/_components/CryptoBriefReader";

export const revalidate = 900;

export default async function CryptoPortfolioPage() {
  const [assetsRaw, snapMapRaw, briefsRaw] = await Promise.all([
    getCryptoAssets(CryptoAssetStatus.PORTFOLIO),
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
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-sm text-gray-500">Current crypto holdings with live signals.</p>
      </section>

      <CryptoAssetTable rows={rows} showHoldings emptyMessage="No holdings yet." />

      {assets.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Theses &amp; notes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {assets.map((a) => (
              <div key={a.id} className="card p-4">
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <span className="font-medium">{a.symbol}</span>
                  {a.keyCatalyst && <span className="text-xs text-gray-500">{a.keyCatalyst}</span>}
                </div>
                {a.thesis && <p className="text-sm text-gray-700 whitespace-pre-wrap mb-3">{a.thesis}</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  <CryptoNotesModalField assetId={a.id} field="thesis" label="Thesis" value={a.thesis} context={a.symbol} />
                  <CryptoNotesModalField assetId={a.id} field="notes" label="Notes" value={a.notes} context={a.symbol} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
