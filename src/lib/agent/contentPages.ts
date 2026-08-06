import type { ContentPageKey, Prisma as PrismaTypes } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReportBlock } from "@/lib/content/blocks";

const TITLES: Record<ContentPageKey, string> = {
  STRATEGY_LESSONS: "Strategy Lessons Summary",
  INVESTMENT_STYLE: "Investment Style Profile",
};

/** Seed bodies used only when a ContentPage row is missing — never overwrite living docs. */
const SEED_BODIES: Record<ContentPageKey, ReportBlock[]> = {
  STRATEGY_LESSONS: [
    {
      type: "heading_2",
      text: "Strategy Lessons Summary",
    },
    {
      type: "paragraph",
      text: "Living document. Monthly routines append lessons only on repeated patterns (≥3 cases) via upsert_document. Do not invent lessons from a single anecdote.",
    },
    {
      type: "heading_3",
      text: "Binding lessons",
    },
    {
      type: "numbered_list_item",
      text: "Lesson #1 — No meaningful averaging down within 7–10 days pre-earnings (small Test add exception only when explicitly labelled).",
    },
    {
      type: "numbered_list_item",
      text: "Lesson #7 (adaptive) — Do not escalate REDUCE/EXIT on negative upside alone when notes show a newer PT cluster; refresh analystTarget first, then reassess.",
    },
    {
      type: "heading_3",
      text: "Working rules (promote to numbered lessons when evidence ≥3)",
    },
    {
      type: "bulleted_list_item",
      text: "QUALITY REBOUND below cost consumes averageDownsUsed (max 2); never schedule a third below-cost ADD. ENGINE_ABSENT → halve tranche 1.",
    },
    {
      type: "bulleted_list_item",
      text: "SPECULATIVE sleeve aggregate capped (limits.speculativeSleevePct); individual Spec names stay in test-starter band.",
    },
    {
      type: "bulleted_list_item",
      text: "Breached stops on Momentum/Spec must resolve same Daily (execute or RESET STOP) — STOP_IN_LIMBO is a hygiene failure.",
    },
    {
      type: "bulleted_list_item",
      text: "Unknown/stale earningsDate blocks adds — absence of a date is not safe for Lesson #1.",
    },
  ],
  INVESTMENT_STYLE: [
    {
      type: "heading_2",
      text: "Investment Style Profile",
    },
    {
      type: "paragraph",
      text: "USD-denominated book. Neon is book of record. Agents recommend; Ivan executes. Decision-support monitor, not an execution engine.",
    },
    {
      type: "heading_3",
      text: "Sleeves",
    },
    {
      type: "bulleted_list_item",
      text: "QUALITY_CORE — fundamentals + valuation vs own history; stops are advisory; holding through earnings is default; QUALITY REBOUND is the natural add path.",
    },
    {
      type: "bulleted_list_item",
      text: "MOMENTUM_CATALYST — full stop/zone/7-criteria framework; trail winners; prefer pyramiding into strength over averaging down.",
    },
    {
      type: "bulleted_list_item",
      text: "SPECULATIVE — test-starter size that survives being wrong; hard stops; first capital-recycling candidates; aggregate sleeve cap applies.",
    },
    {
      type: "heading_3",
      text: "Process priorities",
    },
    {
      type: "bulleted_list_item",
      text: "Decision quality: adaptive reassessment, pre-registered criteria, anti-stale-alert discipline.",
    },
    {
      type: "bulleted_list_item",
      text: "Book shape: sleeve exposure, conviction↔size alignment, honest themes (null → UNCAPPED_THEME), meaningful stops.",
    },
  ],
};

/**
 * Ensure STRATEGY_LESSONS + INVESTMENT_STYLE rows exist.
 * Creates seed stubs only when missing — never clobbers agent/Monthly updates.
 */
export async function ensureContentPages(): Promise<void> {
  const keys = Object.keys(TITLES) as ContentPageKey[];
  await Promise.all(
    keys.map((key) =>
      prisma.contentPage.upsert({
        where: { key },
        create: {
          key,
          title: TITLES[key],
          body: SEED_BODIES[key] as PrismaTypes.InputJsonValue,
        },
        update: {},
      }),
    ),
  );
}

export function contentPageTitle(key: ContentPageKey): string {
  return TITLES[key];
}
