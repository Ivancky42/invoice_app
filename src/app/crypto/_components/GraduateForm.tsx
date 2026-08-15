"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { graduateAsset, updateAssetFields } from "@/lib/crypto/actions";

/** Promote a watchlist asset to the portfolio, seeding qty + avg cost. */
export function GraduateForm({ assetId, symbol }: { assetId: string; symbol: string }) {
  const router = useRouter();
  const [qty, setQty] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const quantity = Number(qty);
    const cost = Number(avgCost);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Enter a positive quantity");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError("Enter a valid avg cost");
      return;
    }
    start(async () => {
      try {
        await updateAssetFields(assetId, { quantity, avgCost: cost });
        await graduateAsset(assetId, "PORTFOLIO");
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2 flex-wrap">
      <label className="text-xs text-gray-500">
        Qty
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          inputMode="decimal"
          className="block w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
          placeholder="0"
        />
      </label>
      <label className="text-xs text-gray-500">
        Avg cost
        <input
          value={avgCost}
          onChange={(e) => setAvgCost(e.target.value)}
          inputMode="decimal"
          className="block w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
          placeholder="0.00"
        />
      </label>
      <button type="submit" disabled={pending} className="btn btn-primary text-xs px-2 py-1">
        {pending ? "Adding…" : `Add ${symbol} to portfolio`}
      </button>
      {error ? <p className="w-full text-xs text-red-700 m-0">{error}</p> : null}
    </form>
  );
}
