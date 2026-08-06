import type { PageObjectResponse } from "@notionhq/client";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  asBoolean,
  asDate,
  asInt,
  asNumber,
  asString,
  readMultiSelect,
  readPrimaryTitle,
  readProp,
} from "@/lib/notion/extract";
import { notionDbId } from "@/lib/notion/client";
import { runInTransactionBatches } from "@/lib/notion/batchTransaction";
import { queryAllPages } from "@/lib/notion/queryAll";
import {
  normalizeDecisionPositionContext,
  normalizeDecisionReviewStatus,
  normalizeDecisionSignalQuality,
  normalizeDecisionType,
  normalizeDecisionVerdict,
} from "@/lib/stocks/normalizeStatus";

function mapPage(page: PageObjectResponse): Prisma.DecisionReviewUncheckedCreateInput | null {
  const title = readPrimaryTitle(page) ?? asString(readProp(page, "Decision"));
  if (!title) return null;

  const decisionTypeRaw = asString(readProp(page, "Decision Type"));
  const reviewStatusRaw = asString(readProp(page, "Review Status"));
  const positionContextRaw = asString(readProp(page, "Position Context"));
  const finalVerdictRaw = asString(readProp(page, "Final Verdict"));
  const signalQualityRaw = asString(readProp(page, "Signal Quality"));
  const executionQualityRaw = asString(readProp(page, "Execution Quality"));

  return {
    notionId: page.id,
    title,
    ticker: asString(readProp(page, "Ticker")),
    decisionDate: asDate(readProp(page, "Decision Date")),
    decisionTypeRaw,
    decisionType: normalizeDecisionType(decisionTypeRaw),
    positionContextRaw,
    positionContext: normalizeDecisionPositionContext(positionContextRaw),
    priceAtDecision: asNumber(readProp(page, "Price at Decision")) ?? null,
    entryZone: asString(readProp(page, "Entry Zone")),
    stopLoss: asNumber(readProp(page, "Stop Loss")) ?? null,
    target: asNumber(readProp(page, "Target")) ?? null,
    convictionScore: asInt(readProp(page, "Conviction Score")),
    catalyst: asString(readProp(page, "Catalyst")),
    catalystDate: asDate(readProp(page, "Catalyst Date")),
    originalThesis: asString(readProp(page, "Original Thesis")),
    expectedOutcome: asString(readProp(page, "Expected Outcome")),
    keyMetricToWatch: asString(readProp(page, "Key Metric to Watch")),
    reasonForDecision: asString(readProp(page, "Reason for Decision")),
    riskInvalidation: asString(readProp(page, "Risk / Invalidation")),
    sourceSignal: readMultiSelect(page, "Source Signal"),
    antiPatternTags: readMultiSelect(page, "Anti-pattern Tags"),
    criteriaThatWorked: readMultiSelect(page, "Criteria That Worked"),
    criteriaThatFailed: readMultiSelect(page, "Criteria That Failed"),
    reviewStatusRaw,
    reviewStatus: normalizeDecisionReviewStatus(reviewStatusRaw),
    outcome1w: asString(readProp(page, "1W Outcome")),
    outcome4w: asString(readProp(page, "4W Outcome")),
    outcome3m: asString(readProp(page, "3M Outcome")),
    return1wPct: asNumber(readProp(page, "Return 1W %")) ?? null,
    return4wPct: asNumber(readProp(page, "Return 4W %")) ?? null,
    return3mPct: asNumber(readProp(page, "Return 3M %")) ?? null,
    finalVerdictRaw,
    finalVerdict: normalizeDecisionVerdict(finalVerdictRaw),
    signalQualityRaw,
    signalQuality: normalizeDecisionSignalQuality(signalQualityRaw),
    executionQualityRaw,
    executionQuality: normalizeDecisionSignalQuality(executionQualityRaw),
    lessonLearned: asString(readProp(page, "Lesson Learned")),
    updateStrategy: asBoolean(readProp(page, "Update Strategy?")),
  };
}

export async function syncDecisionReviews(): Promise<{ count: number }> {
  const dbId = notionDbId("NOTION_DECISION_REVIEW_DB");
  const pages = await queryAllPages(dbId);
  const rows: Prisma.DecisionReviewUncheckedCreateInput[] = [];
  for (const page of pages) {
    const row = mapPage(page);
    if (row) rows.push(row);
  }
  const ids = rows.map((r) => r.notionId).filter((id): id is string => !!id);
  await runInTransactionBatches(
    rows.map((r) => {
      const { notionId, ...update } = r;
      if (!notionId) throw new Error("DecisionReview sync row missing notionId");
      return prisma.decisionReview.upsert({
        where: { notionId },
        create: r,
        update,
      });
    }),
  );
  if (ids.length > 0) {
    await prisma.decisionReview.deleteMany({
      where: { notionId: { not: null, notIn: ids } },
    });
  }
  return { count: rows.length };
}
