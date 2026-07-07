"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { manualCryptoSync } from "@/lib/crypto/actions";
import type { CryptoSyncResult } from "@/lib/crypto/sync";

function formatMessage(result: CryptoSyncResult): string {
  if (result.ok) {
    return `Synced ${Object.entries(result.results)
      .map(([k, v]) => `${k}: ${v ?? "—"}`)
      .join(", ")}`;
  }
  return `Failed: ${result.errors?.join(" | ") ?? "unknown error"}`;
}

export function ManualSyncButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CryptoSyncResult | null>(null);

  const cls = size === "md" ? "btn btn-primary" : "btn btn-primary text-xs px-2 py-1";

  const onSync = () => {
    setResult(null);
    start(async () => {
      try {
        const r = await manualCryptoSync();
        setResult(r);
        router.refresh();
      } catch (e: unknown) {
        setResult({
          ok: false,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          results: {},
          errors: [e instanceof Error ? e.message : String(e)],
        });
      }
    });
  };

  return (
    <div className="flex flex-col items-stretch gap-2 min-w-0 w-full sm:w-auto sm:items-end">
      <button type="button" onClick={onSync} disabled={pending} className={cls}>
        {pending ? "Syncing…" : "Sync now"}
      </button>
      {result && !pending && (
        <p
          className={`m-0 text-xs text-right leading-snug break-words ${
            result.ok ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {formatMessage(result)}
        </p>
      )}
    </div>
  );
}
