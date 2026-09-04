/**
 * Read-only status of the rules-vs-rules paper test for the /stocks/shadow page.
 * Mirrors `runEvolutionEvaluate`'s cutoff, pairing, and counts — never writes,
 * never calls the cron.
 */
import type { EvolutionEventKind, RuleLane } from "@/generated/prisma/client";
import {
  countPaperDecisionsSinceCutoff,
  countResolvedNonZeroCredits,
  countTurnoverSessions,
  evolutionEvidenceCutoff,
  isEvolutionPromotePaused,
  pairFitnessIncrements,
  type PairableSnapshot,
} from "@/lib/evolution/evaluate";
import { countEvolutionEvents, listEvolutionEvents } from "@/lib/evolution/log";
import { evaluateCandidate, sequentialZ, type CandidateVerdict } from "@/lib/fitness/math";
import { prisma } from "@/lib/prisma";
import { challengerLegitimacy } from "@/lib/rules/challenger";
import { SHADOW_INITIAL_NAV } from "@/lib/shadow/branches";
import { listShadowOrders, listShadowPositions, shadowContextBlock } from "@/lib/shadow/read";
import {
  buildPromotionGates,
  buildVerdictSentence,
  firstSentence,
  isHistoryVisible,
  isoDay,
  normalCdfPct,
  projectEarliestDecisionDate,
  rebaseNavSeries,
  translateEvolutionEvent,
  type RebasedPoint,
  type ShadowGate,
  type ShadowTestStatus,
} from "@/lib/shadow/summaryMath";
import { getEvolutionThresholds } from "@/lib/stocks/config";
import { decToNum } from "@/lib/stocks/format";

export type ShadowBookLastTrade = {
  session: string;
  side: string;
  ticker: string;
  sizePct: number;
};

export type ShadowBookCard = {
  label: string;
  nav: number;
  changeSincePct: number | null;
  investedPct: number | null;
  positionsCount: number;
  lastTrade: ShadowBookLastTrade | null;
};

export type ShadowRecentTrade = {
  session: string | null;
  bookLabel: string;
  side: string;
  ticker: string;
  sizePct: number | null;
  decisionType: string | null;
};

export type ShadowRejectedTrade = ShadowRecentTrade & { reason: string | null };

export type ShadowPositionRow = {
  ticker: string;
  weightPct: number | null;
  pnlSinceEntryPct: number | null;
};

export type ShadowHistoryItem = {
  kind: EvolutionEventKind;
  at: string;
  sentence: string;
};

export type ShadowTestSummary = {
  status: ShadowTestStatus;
  promoteSwitchOn: boolean;
  incumbent: { versionId: number; summary: string; activatedAt: string | null };
  challenger: {
    versionId: number;
    summary: string;
    lane: RuleLane;
    proposedAt: string;
  } | null;
  testStart: string | null;
  sessionsDone: number;
  sessionsNeeded: number;
  patientSessionsNeeded: number;
  edge: {
    deltaPct: number;
    z: number | null;
    confidencePct: number | null;
    confidenceNeededStrongPct: number;
    confidenceNeededPatientPct: number;
  };
  gates: ShadowGate[];
  verdictPreview: CandidateVerdict;
  earliestDecisionDate: string | null;
  books: { LIVE: ShadowBookCard; CANDIDATE: ShadowBookCard };
  recentTrades: ShadowRecentTrade[];
  rejectedTrades: ShadowRejectedTrade[];
  positions: { LIVE: ShadowPositionRow[]; CANDIDATE: ShadowPositionRow[] };
  series: { LIVE: RebasedPoint[]; CANDIDATE: RebasedPoint[] };
  history: ShadowHistoryItem[];
  verdictSentence: string;
};

function bookLabel(kind: "current" | "new", versionId: number): string {
  const base = kind === "current" ? "Current rules" : "New rules";
  return versionId > 0 ? `${base} v${versionId}` : base;
}

/** NAV change vs the test-start NAV; null when either side is unknown or zero. */
function changeSince(nav: number, startNav: number): number | null {
  return nav > 0 && startNav > 0 ? nav / startNav - 1 : null;
}

function lastFilledTrade(
  orders: Array<{
    status: string;
    decisionSession: string | null;
    fillSession: string | null;
    side: string;
    ticker: string;
    sizeFraction: number | null;
  }>,
): ShadowBookLastTrade | null {
  const filled = orders.find((o) => o.status === "FILLED");
  if (!filled) return null;
  const session = filled.fillSession ?? filled.decisionSession;
  if (!session) return null;
  return {
    session,
    side: filled.side,
    ticker: filled.ticker,
    sizePct: filled.sizeFraction ?? 0,
  };
}

function positionRows(
  positions: Array<{
    ticker: string;
    closedAt: string | null;
    marketValue: number | null;
    lastMark: number | null;
    avgCost: number | null;
  }>,
  nav: number,
): ShadowPositionRow[] {
  return positions
    .filter((p) => !p.closedAt)
    .map((p) => {
      const weightPct =
        nav > 0 && p.marketValue != null && Number.isFinite(p.marketValue)
          ? p.marketValue / nav
          : null;
      const pnlSinceEntryPct =
        p.lastMark != null && p.avgCost != null && p.avgCost > 0
          ? p.lastMark / p.avgCost - 1
          : null;
      return { ticker: p.ticker, weightPct, pnlSinceEntryPct };
    });
}

/** Status of the rules-vs-rules paper test. Read-only — never writes. */
export async function getShadowTestSummary(): Promise<ShadowTestSummary> {
  const [active, branchRows, paused, thresholds, evolution] = await Promise.all([
    prisma.ruleVersion.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { id: "desc" },
    }),
    prisma.shadowBranch.findMany({
      select: {
        id: true,
        branch: true,
        highWaterNav: true,
        ruleVersionId: true,
        resetAt: true,
        startNav: true,
      },
    }),
    isEvolutionPromotePaused(),
    getEvolutionThresholds(),
    listEvolutionEvents({ limit: 40 }),
  ]);

  const liveBranch = branchRows.find((b) => b.branch === "LIVE");
  const candidateBranch = branchRows.find((b) => b.branch === "CANDIDATE");
  const promoteSwitchOn = !paused;

  const incumbent = {
    versionId: active?.id ?? 0,
    summary: firstSentence(active?.changeSummary),
    activatedAt: active?.activatedAt?.toISOString() ?? null,
  };

  const target = candidateBranch
    ? await prisma.ruleVersion.findUnique({ where: { id: candidateBranch.ruleVersionId } })
    : null;
  const legitimacy = challengerLegitimacy(target, active);
  const hasChallenger = Boolean(legitimacy.ok && target);
  const status: ShadowTestStatus = !hasChallenger ? "IDLE" : paused ? "PAUSED" : "RUNNING";
  const challenger = hasChallenger && target
    ? {
        versionId: target.id,
        summary: firstSentence(target.changeSummary),
        lane: (target.lane ?? "SLOW") as RuleLane,
        proposedAt: target.createdAt.toISOString(),
      }
    : null;

  const lane: RuleLane = challenger?.lane ?? "SLOW";
  const sessionsNeeded = thresholds.promote.strong.minSessions[lane];
  const patientSessionsNeeded = thresholds.promote.patient.minSessions;
  const confidenceNeededStrongPct = normalCdfPct(thresholds.promote.strong.z);
  const confidenceNeededPatientPct = normalCdfPct(thresholds.promote.patient.z);

  const cutoff =
    hasChallenger && target && candidateBranch
      ? evolutionEvidenceCutoff(target, candidateBranch.resetAt)
      : null;
  const testStart = cutoff ? cutoff.toISOString() : null;

  let dailyDeltas: number[] = [];
  let candidateMaxDrawdown = 0;
  let liveMaxDrawdown = 0;
  let latestCandidateNav = 0;
  let latestSessionIso: string | null = null;
  const candNavBySession = new Map<string, number>();
  const liveNavBySession = new Map<string, number>();

  if (cutoff && candidateBranch && liveBranch) {
    const rows = await prisma.fitnessSnapshot.findMany({
      where: {
        branchId: { in: [candidateBranch.id, liveBranch.id] },
        session: { gt: cutoff },
        quality: "OK",
      },
      select: {
        branchId: true,
        session: true,
        nav: true,
        fitnessIncrement: true,
        maxDrawdown: true,
      },
      orderBy: { session: "asc" },
    });

    const candRows = new Map<number, PairableSnapshot>();
    const liveRows = new Map<number, PairableSnapshot>();
    for (const r of rows) {
      const nav = decToNum(r.nav) ?? 0;
      const snap: PairableSnapshot = {
        fitnessIncrement: decToNum(r.fitnessIncrement),
        maxDrawdown: decToNum(r.maxDrawdown) ?? 0,
        nav,
      };
      const ms = r.session.getTime();
      const day = isoDay(r.session);
      if (r.branchId === candidateBranch.id) {
        candRows.set(ms, snap);
        candNavBySession.set(day, nav);
      } else {
        liveRows.set(ms, snap);
        liveNavBySession.set(day, nav);
      }
    }
    const paired = pairFitnessIncrements(candRows, liveRows);
    dailyDeltas = paired.dailyDeltas;
    candidateMaxDrawdown = paired.candidateMaxDrawdown;
    liveMaxDrawdown = paired.liveMaxDrawdown;
    latestCandidateNav = paired.latestCandidateNav;
    if (paired.latestCandidateSessionMs !== undefined) {
      latestSessionIso = isoDay(new Date(paired.latestCandidateSessionMs));
    }
  }

  const { z, n } = sequentialZ(dailyDeltas);
  const deltaPct = dailyDeltas.reduce((sum, d) => sum + d, 0);
  const confidencePct = z === null ? null : normalCdfPct(z);

  const highWater = decToNum(candidateBranch?.highWaterNav ?? null) ?? 0;
  const branchMaxDrawdown =
    highWater > 0 && latestCandidateNav > 0
      ? Math.max(0, (highWater - latestCandidateNav) / highWater)
      : 0;

  const [paperDecisions, promotionsIn90d, resolvedCredits, turnoverSessions] =
    await Promise.all([
      cutoff ? countPaperDecisionsSinceCutoff(cutoff) : Promise.resolve({ candidate: 0, live: 0 }),
      countEvolutionEvents({
        kind: "PROMOTE",
        since: new Date(Date.now() - thresholds.promotionRateWindowDays * 86_400_000),
      }),
      countResolvedNonZeroCredits(),
      countTurnoverSessions(liveBranch?.id),
    ]);

  const verdictPreview: CandidateVerdict = hasChallenger
    ? evaluateCandidate({
        z,
        sessions: n,
        decisions: paperDecisions.candidate,
        liveDecisions: paperDecisions.live,
        lane,
        candidateMaxDrawdown,
        liveMaxDrawdown,
        branchMaxDrawdown,
        promotionsIn90d,
        thresholds,
      })
    : "CONTINUE";

  const earliestDecisionDate =
    status === "IDLE"
      ? null
      : projectEarliestDecisionDate(latestSessionIso, sessionsNeeded - n);

  const gates = buildPromotionGates({
    sessionsDone: n,
    sessionsNeeded,
    patientSessionsNeeded,
    confidencePct,
    confidenceNeededStrongPct,
    confidenceNeededPatientPct,
    candidateDecisions: paperDecisions.candidate,
    liveDecisions: paperDecisions.live,
    minDecisions: thresholds.minDecisions[lane],
    candidateMaxDrawdown,
    liveMaxDrawdown,
    resolvedCredits,
    minResolvedCredits: thresholds.minResolvedNonzeroCredits,
    turnoverSessions,
    minTurnoverSessions: thresholds.minTurnoverSessions,
    promoteSwitchOn,
  });

  const liveVersionId = liveBranch?.ruleVersionId ?? incumbent.versionId;
  const candVersionId = candidateBranch?.ruleVersionId ?? (challenger?.versionId ?? liveVersionId);
  const liveLabel = bookLabel("current", liveVersionId);
  const candLabel = hasChallenger
    ? bookLabel("new", candVersionId)
    : bookLabel("current", candVersionId);

  const [liveCtx, candCtx, livePos, candPos, liveOrders, candOrders] = await Promise.all([
    shadowContextBlock("LIVE"),
    shadowContextBlock("CANDIDATE"),
    listShadowPositions({ branch: "LIVE", includeClosed: false }),
    listShadowPositions({ branch: "CANDIDATE", includeClosed: false }),
    listShadowOrders({ branch: "LIVE", limit: 40 }),
    listShadowOrders({ branch: "CANDIDATE", limit: 40 }),
  ]);

  const liveStartNav = decToNum(liveBranch?.startNav ?? null) ?? SHADOW_INITIAL_NAV;
  const candStartNav = decToNum(candidateBranch?.startNav ?? null) ?? SHADOW_INITIAL_NAV;
  const liveNav = liveCtx?.nav ?? 0;
  const candNav = candCtx?.nav ?? 0;
  const liveTestStartNav = [...liveNavBySession.values()][0] ?? liveStartNav;
  const candTestStartNav = [...candNavBySession.values()][0] ?? candStartNav;
  const liveInvested =
    liveCtx && liveNav > 0 ? Math.max(0, (liveNav - liveCtx.cash) / liveNav) : null;
  const candInvested =
    candCtx && candNav > 0 ? Math.max(0, (candNav - candCtx.cash) / candNav) : null;

  const books = {
    LIVE: {
      label: liveLabel,
      nav: liveNav,
      changeSincePct: changeSince(liveNav, liveTestStartNav),
      investedPct: liveInvested,
      positionsCount: liveCtx?.openPositions ?? livePos.positions.length,
      lastTrade: lastFilledTrade(liveOrders.orders),
    },
    CANDIDATE: {
      label: candLabel,
      nav: candNav,
      changeSincePct: changeSince(candNav, candTestStartNav),
      investedPct: candInvested,
      positionsCount: candCtx?.openPositions ?? candPos.positions.length,
      lastTrade: lastFilledTrade(candOrders.orders),
    },
  };

  const tagged = [
    ...liveOrders.orders.map((o) => ({ ...o, bookLabel: liveLabel })),
    ...candOrders.orders.map((o) => ({ ...o, bookLabel: candLabel })),
  ];
  const byNewest = (
    a: { decisionSession: string | null; createdAt: string | null },
    b: { decisionSession: string | null; createdAt: string | null },
  ) => {
    const as = a.decisionSession ?? a.createdAt ?? "";
    const bs = b.decisionSession ?? b.createdAt ?? "";
    return bs.localeCompare(as);
  };
  tagged.sort(byNewest);

  // Same date the book cards show: when it filled, falling back to when it was decided.
  const toRecent = (o: (typeof tagged)[number]): ShadowRecentTrade => ({
    session: o.fillSession ?? o.decisionSession,
    bookLabel: o.bookLabel,
    side: o.side,
    ticker: o.ticker,
    sizePct: o.sizeFraction,
    decisionType: o.decisionType,
  });

  const recentTrades = tagged.filter((o) => o.status === "FILLED").slice(0, 10).map(toRecent);
  const rejectedTrades: ShadowRejectedTrade[] = tagged
    .filter((o) => o.status === "REJECTED")
    .slice(0, 10)
    .map((o) => ({ ...toRecent(o), reason: o.rejectReason }));

  const allDays = [...new Set([...liveNavBySession.keys(), ...candNavBySession.keys()])].sort();
  const liveSeries = rebaseNavSeries(
    allDays
      .filter((d) => liveNavBySession.has(d))
      .map((session) => ({ session, nav: liveNavBySession.get(session)! })),
  );
  const candSeries = rebaseNavSeries(
    allDays
      .filter((d) => candNavBySession.has(d))
      .map((session) => ({ session, nav: candNavBySession.get(session)! })),
  );

  const history: ShadowHistoryItem[] = evolution.events
    .filter((e) => isHistoryVisible(e.kind))
    .slice(0, 12)
    .map((e) => ({
      kind: e.kind,
      at: e.createdAt,
      sentence: translateEvolutionEvent(e.kind, e.ruleVersionId, e.detail),
    }));

  const verdictSentence = buildVerdictSentence({
    status,
    incumbentVersionId: incumbent.versionId,
    challengerVersionId: challenger?.versionId ?? null,
    testStart,
    sessionsDone: n,
    sessionsNeeded,
    deltaPct,
    z,
    confidencePct,
    confidenceNeededStrongPct,
    earliestDecisionDate,
  });

  return {
    status,
    promoteSwitchOn,
    incumbent,
    challenger,
    testStart,
    sessionsDone: n,
    sessionsNeeded,
    patientSessionsNeeded,
    edge: {
      deltaPct,
      z,
      confidencePct,
      confidenceNeededStrongPct,
      confidenceNeededPatientPct,
    },
    gates,
    verdictPreview,
    earliestDecisionDate,
    books,
    recentTrades,
    rejectedTrades,
    positions: {
      LIVE: positionRows(livePos.positions, liveNav),
      CANDIDATE: positionRows(candPos.positions, candNav),
    },
    series: { LIVE: liveSeries, CANDIDATE: candSeries },
    history,
    verdictSentence,
  };
}
