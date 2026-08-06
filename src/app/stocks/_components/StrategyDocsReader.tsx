"use client";

import { useState } from "react";
import type { ContentPageDTO } from "@/lib/stocks/db";
import { ReportBlocks } from "@/app/stocks/_components/ReportBlocks";

type TabKey = "STRATEGY_LESSONS" | "INVESTMENT_STYLE";

const TAB_META: Record<TabKey, { label: string; blurb: string }> = {
  STRATEGY_LESSONS: {
    label: "Strategy lessons",
    blurb: "Compressed lessons from the Decision Review learning loop.",
  },
  INVESTMENT_STYLE: {
    label: "Investment style",
    blurb: "Stock criteria, risk rules, and averaging-down framework.",
  },
};

export function StrategyDocsReader({
  lessons,
  style,
}: {
  lessons: ContentPageDTO | null;
  style: ContentPageDTO | null;
}) {
  const initial: TabKey = lessons ? "STRATEGY_LESSONS" : "INVESTMENT_STYLE";
  const [tab, setTab] = useState<TabKey>(initial);
  const active = tab === "STRATEGY_LESSONS" ? lessons : style;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        {(Object.keys(TAB_META) as TabKey[]).map((key) => {
          const available = key === "STRATEGY_LESSONS" ? lessons : style;
          const selected = tab === key;
          return (
            <button
              key={key}
              type="button"
              disabled={!available}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                selected
                  ? "bg-gray-900 text-white"
                  : available
                    ? "text-gray-600 hover:bg-gray-100"
                    : "text-gray-300 cursor-not-allowed"
              }`}
            >
              {TAB_META[key].label}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-gray-500">{TAB_META[tab].blurb}</p>

      {!active ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          This document has not been seeded yet. Run{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">
            npx tsx scripts/backfill-gap-fill.ts
          </code>{" "}
          or upsert via MCP <code className="text-xs bg-gray-100 px-1 rounded">upsert_document</code>.
        </div>
      ) : (
        <section className="card p-5 sm:p-6">
          <header className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-gray-100 mb-4">
            <h2 className="text-xl font-semibold text-gray-900">{active.title}</h2>
            {active.updatedAt && (
              <span className="text-xs text-gray-500">
                Updated {active.updatedAt.slice(0, 10)}
              </span>
            )}
          </header>
          {active.body.length === 0 ? (
            <p className="text-sm text-gray-500">Empty document.</p>
          ) : (
            <ReportBlocks blocks={active.body} />
          )}
        </section>
      )}
    </div>
  );
}
