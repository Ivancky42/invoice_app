import type { SyncStatusRow } from "@/lib/stocks/db";
import { isStale } from "@/lib/stocks/db";
import { SyncNowButton } from "@/app/_components/SyncNowButton";

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function SyncStatusBanner({
  status,
  showButton = true,
}: {
  status: SyncStatusRow | null;
  showButton?: boolean;
}) {
  if (!status) {
    return (
      <div className="rounded-md bg-amber-50 border border-amber-100 text-amber-900 text-sm px-3 py-2 flex items-center justify-between gap-3">
        <span>No Notion sync has run yet. Trigger one now or wait for the daily cron (09:30 GMT+8).</span>
        {showButton && <SyncNowButton />}
      </div>
    );
  }

  const stale = isStale(status);
  const last = status.lastSuccessAt ?? status.lastRunAt;
  const lastLabel = last ? timeAgo(last) : "never";

  if (stale) {
    return (
      <div className="rounded-md bg-amber-50 border border-amber-100 text-amber-900 text-sm px-3 py-2 flex items-center justify-between gap-3">
        <span>
          Showing cached data. Last successful sync: <strong>{lastLabel}</strong>
          {status.lastError ? (
            <span className="text-amber-700"> · last error: {status.lastError}</span>
          ) : null}
        </span>
        {showButton && <SyncNowButton />}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-500">Synced {lastLabel} from Notion. Daily at 09:30 GMT+8.</span>
      {showButton && <SyncNowButton />}
    </div>
  );
}
