"use client";

import { useState } from "react";
import type { PromptName } from "@/lib/agent/context";

export type PromptDoc = {
  name: PromptName;
  markdown: string | null;
  error?: string;
};

const TAB_META: Record<
  PromptName,
  { label: string; blurb: string; file: string }
> = {
  _shared: {
    label: "Shared",
    blurb: "Write contract, Adaptive Decision Layer, sizing, sleeves, DR, notes — included by every routine.",
    file: "prompts/_shared.md",
  },
  daily: {
    label: "Daily",
    blurb: "US close review — pending actions, portfolio/watchlist, daily log.",
    file: "prompts/daily.md",
  },
  weekly: {
    label: "Weekly",
    blurb: "Weekly deep review and report.",
    file: "prompts/weekly.md",
  },
  earnings: {
    label: "Earnings",
    blurb: "Earnings-window routine for names with upcoming or just-reported prints.",
    file: "prompts/earnings.md",
  },
  monthly: {
    label: "Monthly",
    blurb: "Monthly retrospection, strategy lessons, style updates.",
    file: "prompts/monthly.md",
  },
};

const TAB_ORDER: PromptName[] = ["_shared", "daily", "weekly", "earnings", "monthly"];

export function PromptsReader({ prompts }: { prompts: PromptDoc[] }) {
  const byName = new Map(prompts.map((p) => [p.name, p]));
  const firstAvailable =
    TAB_ORDER.find((n) => byName.get(n)?.markdown) ?? TAB_ORDER[0]!;
  const [tab, setTab] = useState<PromptName>(firstAvailable);
  const active = byName.get(tab);
  const meta = TAB_META[tab];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        {TAB_ORDER.map((name) => {
          const doc = byName.get(name);
          const available = Boolean(doc?.markdown);
          const selected = tab === name;
          return (
            <button
              key={name}
              type="button"
              disabled={!available && !doc}
              onClick={() => setTab(name)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                selected
                  ? "bg-gray-900 text-white"
                  : available
                    ? "text-gray-600 hover:bg-gray-100"
                    : "text-gray-400 hover:bg-gray-50"
              }`}
            >
              {TAB_META[name].label}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-gray-500">{meta.blurb}</p>

      {!active?.markdown ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          {active?.error ?? `Could not load ${meta.file}.`}
        </div>
      ) : (
        <section className="card overflow-hidden">
          <header className="flex flex-wrap items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-gray-100 bg-gray-50/80">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 font-mono tracking-tight">
                {meta.file}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Same file agents load via <code className="bg-gray-100 px-1 rounded">get_prompt</code>
              </p>
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-white border border-gray-200 rounded px-2 py-1">
              Read-only
            </span>
          </header>
          <pre className="px-5 sm:px-6 py-5 text-[13px] leading-relaxed text-gray-800 whitespace-pre-wrap break-words font-mono overflow-x-auto max-h-[min(75vh,900px)] overflow-y-auto">
            {active.markdown}
          </pre>
        </section>
      )}
    </div>
  );
}
