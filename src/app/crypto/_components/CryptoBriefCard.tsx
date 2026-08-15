import Link from "next/link";
import type { CryptoBriefDTO } from "@/lib/crypto/db";
import { CryptoBriefReader } from "@/app/crypto/_components/CryptoBriefReader";
import { daysSince, fearGreedMeta, fmtShortDateUtc } from "@/lib/crypto/format";

/** Overview card for the latest daily brief, with a staleness warning. */
export function CryptoBriefCard({ brief }: { brief: CryptoBriefDTO | null }) {
  if (!brief) {
    return (
      <section className="card p-5">
        <h2 className="font-medium">Latest brief</h2>
        <p className="text-sm text-gray-500 mt-1">
          No daily brief yet — the claude.ai task posts one each morning.
        </p>
      </section>
    );
  }

  const stale = (daysSince(brief.briefDate) ?? 0) > 2;
  const fg = fearGreedMeta(brief.fearGreed);

  return (
    <section className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-medium">Latest brief · {fmtShortDateUtc(brief.briefDate)}</h2>
          <p className="text-xs text-gray-500 mt-0.5">Daily crypto scan.</p>
        </div>
        <div className="flex items-center gap-2">
          {brief.fearGreed != null && (
            <span className={`badge ${fg.className}`}>
              F&amp;G {brief.fearGreed} · {fg.label}
            </span>
          )}
          <Link href="/crypto/briefs" className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline">
            All briefs →
          </Link>
        </div>
      </div>
      {stale && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-amber-900 text-xs">
          Latest brief is {daysSince(brief.briefDate)} days old — the daily task may have missed a run.
        </div>
      )}
      <div className="px-5 py-4">
        <CryptoBriefReader brief={brief} />
      </div>
    </section>
  );
}
