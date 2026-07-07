"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { graduateAsset } from "@/lib/crypto/actions";
import { changeColor, fmtPctSigned } from "@/lib/crypto/format";

export type TrendingItem = {
  id: string;
  symbol: string;
  name: string;
  change24hPct: number | null;
};

export function TrendingList({ items }: { items: TrendingItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onAdd = (id: string) => {
    setError(null);
    setPendingId(id);
    start(async () => {
      try {
        await graduateAsset(id, "WATCHLIST");
        router.refresh();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPendingId(null);
      }
    });
  };

  if (items.length === 0) {
    return <p className="text-sm text-gray-500 px-5 py-4">No trending tokens right now.</p>;
  }

  return (
    <div>
      {error ? <p className="px-5 pt-3 text-xs text-red-700">{error}</p> : null}
      <ul className="divide-y">
        {items.map((t) => (
          <li key={t.id} className="px-5 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="font-medium">{t.symbol}</span>
              <span className="text-gray-500 text-sm ml-2 truncate">{t.name}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className={`text-sm tabular-nums ${changeColor(t.change24hPct)}`}>
                {fmtPctSigned(t.change24hPct)}
              </span>
              <button
                type="button"
                onClick={() => onAdd(t.id)}
                disabled={pendingId === t.id}
                className="btn text-xs px-2 py-1"
              >
                {pendingId === t.id ? "Adding…" : "Add to watchlist"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
