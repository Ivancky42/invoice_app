"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { manualSyncNotion } from "@/lib/stocks/actions";
import type { SyncResult } from "@/lib/notion/sync";

export function SyncNowButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncResult | null>(null);

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      try {
        const r = await manualSyncNotion();
        setResult(r);
        router.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setResult({
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

  const cls = size === "md" ? "btn btn-primary" : "btn text-xs px-2 py-1";

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={onClick} disabled={pending} className={cls}>
        {pending ? "Syncing…" : "Sync now"}
      </button>
      {result && !pending && (
        <span className={`text-xs ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
          {result.ok
            ? `Synced ${Object.entries(result.results)
                .map(([k, v]) => `${k}: ${v ?? "—"}`)
                .join(", ")}`
            : `Failed: ${result.errors?.join(" | ") ?? "unknown error"}`}
        </span>
      )}
    </div>
  );
}
