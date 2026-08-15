"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTrade } from "@/lib/crypto/actions";

export type TradeAssetOption = { id: string; symbol: string };

/** Record a BUY/SELL trade, optionally updating the asset's holding. */
export function AddTradeForm({ assets }: { assets: TradeAssetOption[] }) {
  const router = useRouter();
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [tradedAt, setTradedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [updateHolding, setUpdateHolding] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      try {
        await addTrade({
          assetId,
          side,
          quantity: Number(quantity),
          price: Number(price),
          fee: fee.trim() ? Number(fee) : null,
          tradedAt,
          notes: notes.trim() || undefined,
          updateHolding,
        });
        setQuantity("");
        setPrice("");
        setFee("");
        setNotes("");
        router.refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  if (assets.length === 0) {
    return <p className="text-sm text-gray-500">Add a portfolio asset first to record trades.</p>;
  }

  const inputCls = "block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";
  const labelCls = "text-xs text-gray-500 block";

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
      <label className={labelCls}>
        Asset
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={inputCls}>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.symbol}
            </option>
          ))}
        </select>
      </label>
      <label className={labelCls}>
        Side
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}
          className={inputCls}
        >
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </label>
      <label className={labelCls}>
        Quantity
        <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" />
      </label>
      <label className={labelCls}>
        Price (USD)
        <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0.00" />
      </label>
      <label className={labelCls}>
        Fee (USD)
        <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" className={inputCls} placeholder="optional" />
      </label>
      <label className={labelCls}>
        Date
        <input type="date" value={tradedAt} onChange={(e) => setTradedAt(e.target.value)} className={inputCls} />
      </label>
      <label className={`${labelCls} col-span-2`}>
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="optional" />
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-600 col-span-2 sm:col-span-1">
        <input type="checkbox" checked={updateHolding} onChange={(e) => setUpdateHolding(e.target.checked)} />
        Update holding
      </label>
      <div className="col-span-2 sm:col-span-3 flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary text-sm">
          {pending ? "Saving…" : "Add trade"}
        </button>
        {error ? <p className="text-xs text-red-700 m-0">{error}</p> : null}
      </div>
    </form>
  );
}
