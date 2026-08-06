import { DecisionReviewStatus } from "@/generated/prisma/client";
import { getDecisionReviews, getSyncStatus } from "@/lib/stocks/db";
import { SyncStatusBanner } from "@/app/_components/SyncStatusBanner";
import { DecisionReviewsTable } from "@/app/stocks/_components/DecisionReviewsTable";
import { DECISION_REVIEW_STATUS_LABEL } from "@/lib/stocks/labels";

export const revalidate = 900;

const STATUS_ORDER: Array<DecisionReviewStatus | null> = [
  DecisionReviewStatus.PENDING,
  DecisionReviewStatus.REVIEWED_1W,
  DecisionReviewStatus.REVIEWED_4W,
  DecisionReviewStatus.REVIEWED_3M,
  DecisionReviewStatus.CLOSED,
  null,
];

export default async function DecisionsPage() {
  const [rows, status] = await Promise.all([getDecisionReviews(), getSyncStatus()]);

  const pending = rows.filter((r) => r.reviewStatus === DecisionReviewStatus.PENDING).length;

  const groups: { key: string; items: typeof rows }[] = [];
  for (const s of STATUS_ORDER) {
    const items = rows.filter((r) => (r.reviewStatus ?? null) === s);
    if (items.length === 0) continue;
    groups.push({
      key: s ? DECISION_REVIEW_STATUS_LABEL[s] : "Unsorted",
      items,
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Decision Review Log</h1>
        <p className="text-sm text-gray-500">
          Actionable recommendations and the learning loop — read-only from Neon.
          {rows.length > 0 && (
            <>
              {" "}
              {rows.length} entries
              {pending > 0 ? ` · ${pending} pending` : ""}.
            </>
          )}
        </p>
      </section>

      <SyncStatusBanner status={status} />

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          No decision reviews yet. Agents write via{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">upsert_decision_review</code>, or
          backfill from Notion with{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">
            npx tsx scripts/backfill-gap-fill.ts
          </code>
          .
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="font-medium text-gray-800">{g.key}</h2>
              <span className="text-xs text-gray-500">{g.items.length}</span>
            </div>
            <DecisionReviewsTable rows={g.items} />
          </section>
        ))
      )}
    </div>
  );
}
