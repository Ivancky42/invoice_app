"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { manualSyncNotion, manualSyncPrices } from "@/lib/stocks/actions";
import type { PriceSyncResult } from "@/lib/stocks/priceSync";
import type { SyncResult } from "@/lib/notion/sync";

function formatPriceSyncMessage(result: PriceSyncResult): string {
  if (result.ok) {
    return `Prices: ${result.updated} updated, ${result.skipped} skipped (${Math.round(result.durationMs / 1000)}s).`;
  }
  const fromDetails = result.details
    .filter((d) => !d.ok)
    .slice(0, 2)
    .map((d) => `${d.table}: ${(d.tickerHint?.trim() || "row").slice(0, 48)} — ${d.error ?? "error"}`)
    .join(" · ");
  const tail = result.failed > 2 ? ` (+${result.failed - 2} more)` : "";
  return `Failed: ${result.errors.join(" · ") || fromDetails || `${result.failed} failed`}${tail}`;
}

function formatSyncMessage(result: SyncResult): string {
  if (result.ok) {
    return `Synced ${Object.entries(result.results)
      .map(([k, v]) => `${k}: ${v ?? "—"}`)
      .join(", ")}`;
  }
  return `Failed: ${result.errors?.join(" | ") ?? "unknown error"}`;
}

export function NotionSyncButtons({
  size = "sm",
  notionSyncEnabled = false,
}: {
  size?: "sm" | "md";
  /** When true (NOTION_SYNC_ENABLED=true), show legacy Notion→Neon button. */
  notionSyncEnabled?: boolean;
}) {
  const router = useRouter();
  const [pricePending, startPrice] = useTransition();
  const [syncPending, startSync] = useTransition();
  const [priceResult, setPriceResult] = useState<PriceSyncResult | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const pushCls =
    size === "md"
      ? "btn border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
      : "btn text-xs px-2 py-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50";
  const syncCls = size === "md" ? "btn btn-primary" : "btn text-xs px-2 py-1";

  const onSyncPrices = () => {
    setPriceResult(null);
    startPrice(async () => {
      try {
        const r = await manualSyncPrices();
        setPriceResult(r);
        if (r.ok) router.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setPriceResult({
          ok: false,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          errors: [msg],
          details: [],
        });
      }
    });
  };

  const onSync = () => {
    setSyncResult(null);
    startSync(async () => {
      try {
        const r = await manualSyncNotion();
        setSyncResult(r);
        router.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setSyncResult({
          ok: false,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          results: {},
          errors: [msg],
        });
      }
    });
  };

  const showPriceMsg = Boolean(priceResult && !pricePending);
  const showSyncMsg = Boolean(syncResult && !syncPending);

  return (
    <div className="flex flex-col items-stretch gap-2 min-w-0 w-full sm:w-auto sm:items-end">
      <div className="flex flex-wrap justify-end gap-2 shrink-0">
        <button
          type="button"
          onClick={onSyncPrices}
          disabled={pricePending}
          className={pushCls}
          title="Writes Finnhub/EODHD last prices to Neon and records today's portfolio snapshot."
        >
          {pricePending ? "Updating prices…" : "Update prices"}
        </button>
        {notionSyncEnabled ? (
          <button
            type="button"
            onClick={onSync}
            disabled={syncPending}
            className={syncCls}
            title="Legacy Notion→Neon pull. Emergency go-back only."
          >
            {syncPending ? "Syncing…" : "Sync from Notion (legacy)"}
          </button>
        ) : null}
      </div>
      {(showPriceMsg || showSyncMsg) && (
        <div className="w-full min-w-0 text-xs text-right space-y-1 leading-snug break-words">
          {showPriceMsg && priceResult ? (
            <p className={`m-0 ${priceResult.ok ? "text-emerald-700" : "text-red-700"}`}>
              {formatPriceSyncMessage(priceResult)}
            </p>
          ) : null}
          {showSyncMsg && syncResult ? (
            <p className={`m-0 ${syncResult.ok ? "text-emerald-700" : "text-red-700"}`}>
              {formatSyncMessage(syncResult)}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
