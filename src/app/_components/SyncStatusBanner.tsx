import type { SyncStatusRow } from "@/lib/stocks/db";
import { isStale } from "@/lib/stocks/db";
import { NotionSyncButtons } from "@/app/_components/NotionSyncButtons";

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
      <div className="rounded-md bg-amber-50 border border-amber-100 text-amber-900 text-sm px-3 py-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <span className="min-w-0 flex-1">
          No Notion sync has run yet. Trigger one now or wait for the hourly cron (Notion→Neon :05 each hour GMT+8).
        </span>
        {showButton ? <NotionSyncButtons /> : null}
      </div>
    );
  }

  const stale = isStale(status);
  const last = status.lastSuccessAt ?? status.lastRunAt;
  const lastLabel = last ? timeAgo(last) : "never";

  if (stale) {
    return (
      <div className="rounded-md bg-amber-50 border border-amber-100 text-amber-900 text-sm px-3 py-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <span className="min-w-0 flex-1">
          Showing cached data. Last successful sync: <strong>{lastLabel}</strong>
          {status.lastError ? (
            <span className="text-amber-700"> · last error: {status.lastError}</span>
          ) : null}
        </span>
        {showButton ? <NotionSyncButtons /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <span className="text-xs text-gray-500 min-w-0 flex-1">
        Synced {lastLabel} from Notion. Each hour: Finnhub→Notion :00 GMT+8, then Notion→Neon :05 GMT+8 (UTC :00 / :05).
      </span>
      {showButton ? <NotionSyncButtons /> : null}
    </div>
  );
}
