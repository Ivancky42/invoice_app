"use client";

import { useState } from "react";
import type { DecisionReviewDTO } from "@/lib/stocks/db";
import { fmtMoney, fmtPctPoints, fmtTicker } from "@/lib/stocks/format";
import {
  DECISION_REVIEW_STATUS_CLASS,
  DECISION_TYPE_CLASS,
  DECISION_VERDICT_CLASS,
  decisionPositionContextLabel,
  decisionReviewStatusLabel,
  decisionSignalQualityLabel,
  decisionTypeLabel,
  decisionVerdictLabel,
} from "@/lib/stocks/labels";

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "—";
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "" || children === "—") return null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">
        {label}
      </div>
      <div className="text-sm text-gray-800 whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function DecisionRow({ row }: { row: DecisionReviewDTO }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{ymd(row.decisionDate)}</td>
        <td className="px-4 py-3 font-medium tracking-wide tabular-nums">
          {fmtTicker(row.ticker)}
        </td>
        <td className="px-4 py-3">
          {row.decisionType ? (
            <span className={`badge ${DECISION_TYPE_CLASS[row.decisionType]}`}>
              {decisionTypeLabel(row.decisionType)}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3 max-w-[18rem]">
          <div className="truncate font-medium text-gray-900" title={row.title}>
            {row.title}
          </div>
        </td>
        <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(row.priceAtDecision)}</td>
        <td className="px-4 py-3 text-center">
          {row.convictionScore != null ? row.convictionScore : "—"}
        </td>
        <td className="px-4 py-3">
          {row.reviewStatus ? (
            <span className={`badge ${DECISION_REVIEW_STATUS_CLASS[row.reviewStatus]}`}>
              {decisionReviewStatusLabel(row.reviewStatus)}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3">
          {row.finalVerdict ? (
            <span className={`badge ${DECISION_VERDICT_CLASS[row.finalVerdict]}`}>
              {decisionVerdictLabel(row.finalVerdict)}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500">{open ? "Hide" : "Details"}</td>
      </tr>
      {open && (
        <tr className="bg-gray-50/80">
          <td colSpan={9} className="px-4 py-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <DetailField label="Context">
                {decisionPositionContextLabel(row.positionContext)}
              </DetailField>
              <DetailField label="Entry zone">{row.entryZone}</DetailField>
              <DetailField label="Stop">{fmtMoney(row.stopLoss)}</DetailField>
              <DetailField label="Target">{fmtMoney(row.target)}</DetailField>
              <DetailField label="Catalyst">{row.catalyst}</DetailField>
              <DetailField label="Catalyst date">{ymd(row.catalystDate)}</DetailField>
              <DetailField label="Signal quality">
                {decisionSignalQualityLabel(row.signalQuality)}
              </DetailField>
              <DetailField label="Execution quality">
                {decisionSignalQualityLabel(row.executionQuality)}
              </DetailField>
              <DetailField label="Returns">
                {[
                  row.return1wPct != null ? `1W ${fmtPctPoints(row.return1wPct)}` : null,
                  row.return4wPct != null ? `4W ${fmtPctPoints(row.return4wPct)}` : null,
                  row.return3mPct != null ? `3M ${fmtPctPoints(row.return3mPct)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || null}
              </DetailField>
              <div className="sm:col-span-2 lg:col-span-3 grid gap-3">
                <DetailField label="Original thesis">{row.originalThesis}</DetailField>
                <DetailField label="Reason for decision">{row.reasonForDecision}</DetailField>
                <DetailField label="Expected outcome">{row.expectedOutcome}</DetailField>
                <DetailField label="Risk / invalidation">{row.riskInvalidation}</DetailField>
                <DetailField label="Key metric">{row.keyMetricToWatch}</DetailField>
                <DetailField label="Lesson learned">{row.lessonLearned}</DetailField>
                {row.sourceSignal.length > 0 && (
                  <DetailField label="Source signal">{row.sourceSignal.join(", ")}</DetailField>
                )}
                {row.antiPatternTags.length > 0 && (
                  <DetailField label="Anti-patterns">{row.antiPatternTags.join(", ")}</DetailField>
                )}
                {row.criteriaThatWorked.length > 0 && (
                  <DetailField label="Criteria worked">
                    {row.criteriaThatWorked.join(", ")}
                  </DetailField>
                )}
                {row.criteriaThatFailed.length > 0 && (
                  <DetailField label="Criteria failed">
                    {row.criteriaThatFailed.join(", ")}
                  </DetailField>
                )}
                {(row.outcome1w || row.outcome4w || row.outcome3m) && (
                  <div className="grid sm:grid-cols-3 gap-3">
                    <DetailField label="1W outcome">{row.outcome1w}</DetailField>
                    <DetailField label="4W outcome">{row.outcome4w}</DetailField>
                    <DetailField label="3M outcome">{row.outcome3m}</DetailField>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function DecisionReviewsTable({ rows }: { rows: DecisionReviewDTO[] }) {
  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-gray-500">
        No decision reviews yet.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2">Date</th>
            <th className="text-left px-4 py-2">Ticker</th>
            <th className="text-left px-4 py-2">Type</th>
            <th className="text-left px-4 py-2">Decision</th>
            <th className="text-right px-4 py-2">Price</th>
            <th className="text-center px-4 py-2">Conv.</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="text-left px-4 py-2">Verdict</th>
            <th className="text-left px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <DecisionRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
