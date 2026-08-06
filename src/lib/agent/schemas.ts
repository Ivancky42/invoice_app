import { z } from "zod";
import {
  AnalystRating,
  ContentPageKey,
  DailyLogRoutine,
  DecisionPositionContext,
  DecisionReviewStatus,
  DecisionSignalQuality,
  DecisionType,
  DecisionVerdict,
  DiscoveredVia,
  IdeaStage,
  IdeaStatus,
  MarketCapBucket,
  PositionAction,
  RiskLevel,
  Sleeve,
  StockReportType,
  Theme,
  TradeStatus,
  TradeType,
  TrendStage,
  TrendVerdict,
  WatchlistAction,
  WatchlistPriority,
  WeekMomentum,
} from "@/generated/prisma/enums";

function enumValues<T extends Record<string, string>>(obj: T): [T[keyof T], ...T[keyof T][]] {
  const vals = Object.values(obj) as T[keyof T][];
  return vals as [T[keyof T], ...T[keyof T][]];
}

/** Recursive ReportBlock zod union matching `src/lib/content/blocks.ts`. */
export const reportBlockSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("paragraph"), text: z.string() }),
    z.object({ type: z.literal("heading_1"), text: z.string() }),
    z.object({ type: z.literal("heading_2"), text: z.string() }),
    z.object({ type: z.literal("heading_3"), text: z.string() }),
    z.object({
      type: z.literal("bulleted_list_item"),
      text: z.string(),
      children: z.array(reportBlockSchema).optional(),
    }),
    z.object({
      type: z.literal("numbered_list_item"),
      text: z.string(),
      children: z.array(reportBlockSchema).optional(),
    }),
    z.object({ type: z.literal("quote"), text: z.string() }),
    z.object({ type: z.literal("callout"), text: z.string() }),
    z.object({ type: z.literal("divider") }),
    z.object({
      type: z.literal("table"),
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    }),
  ]),
);

export const reportBlocksSchema = z.array(reportBlockSchema);

const dateYmd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const logTradeInputSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  ticker: z.string().min(1).max(32),
  type: z.enum(enumValues(TradeType)),
  date: dateYmd,
  shares: z.number().positive(),
  pricePerShare: z.number().positive(),
  thesisAtEntry: reportBlocksSchema.nullable().optional(),
  exitReason: z.string().max(2000).nullable().optional(),
  notes: reportBlocksSchema.nullable().optional(),
  rulesVersion: z.string().max(64).nullable().optional(),
  status: z.enum(enumValues(TradeStatus)).optional(),
  /** Optional theme for new BUY positions (enables theme_cap before insert). */
  theme: z.enum(enumValues(Theme)).nullable().optional(),
  /** When true on a full exit, upsert a minimal Watchlist row for the ticker. */
  reAddToWatchlist: z.boolean().optional(),
});

export type LogTradeInputParsed = z.infer<typeof logTradeInputSchema>;

export const dailyLogInputSchema = z.object({
  logDate: dateYmd,
  /** Separates Daily vs Earnings writes on the same calendar day. Default DAILY. */
  routineType: z.enum(enumValues(DailyLogRoutine)).optional(),
  title: z.string().min(1).max(200).optional(),
  marketContext: reportBlocksSchema.nullable().optional(),
  topNews: reportBlocksSchema.nullable().optional(),
  portfolioMove: reportBlocksSchema.nullable().optional(),
  watchlistMove: reportBlocksSchema.nullable().optional(),
  actionTaken: reportBlocksSchema.nullable().optional(),
  notes: reportBlocksSchema.nullable().optional(),
  flaggedTickers: z.array(z.string().min(1).max(32)).optional(),
  alertEmailSent: z.boolean().optional(),
  rulesVersion: z.string().max(64).nullable().optional(),
});

export const stockReportInputSchema = z.object({
  reportType: z.enum(enumValues(StockReportType)),
  reportDate: dateYmd,
  title: z.string().min(1).max(300).optional(),
  content: reportBlocksSchema,
  rulesVersion: z.string().max(64).nullable().optional(),
});

export const patchPortfolioInputSchema = z.object({
  action: z.enum(enumValues(PositionAction)).nullable().optional(),
  stopLoss: z.number().positive().nullable().optional(),
  sleeve: z.enum(enumValues(Sleeve)).nullable().optional(),
  conviction: z.number().int().min(1).max(5).nullable().optional(),
  thesis: reportBlocksSchema.nullable().optional(),
  pageNotes: reportBlocksSchema.nullable().optional(),
  notes: reportBlocksSchema.nullable().optional(),
  entryZone: z.string().max(500).nullable().optional(),
  addZone: z.string().max(500).nullable().optional(),
  nextAddTrigger: z.string().max(2000).nullable().optional(),
  keyRisk: z.string().max(2000).nullable().optional(),
  theme: z.enum(enumValues(Theme)).nullable().optional(),
  riskLevel: z.enum(enumValues(RiskLevel)).nullable().optional(),
  marketCapBucket: z.enum(enumValues(MarketCapBucket)).nullable().optional(),
  analystRating: z.enum(enumValues(AnalystRating)).nullable().optional(),
  /**
   * Consensus (or refreshed) analyst price target in USD. Server recomputes `upsidePct`
   * from this + stored `currentPrice`. Do not write `upsidePct` directly.
   */
  analystTarget: z.number().positive().nullable().optional(),
  /** Earnings beat history summary, e.g. "4/4" or "Rev+EPS beat Q2'26". */
  beatRate: z.string().max(200).nullable().optional(),
  /** Expected move into earnings, e.g. "±5%" — informational. */
  impliedMove: z.string().max(100).nullable().optional(),
  /** YYYY-MM-DD; recomputes daysToEarnings. Null clears both. */
  earningsDate: dateYmd.nullable().optional(),
  // Explicitly omit currentPrice / shares / myAvgCost / upsidePct — marks + derived %.
});

export const appendPageNotesInputSchema = z.object({
  target: z.enum(["portfolio", "watchlist"]),
  ticker: z.string().min(1).max(32),
  blocks: reportBlocksSchema.min(1),
  rulesVersion: z.string().max(64).nullable().optional(),
});

export const upsertWatchlistInputSchema = z.object({
  ticker: z.string().min(1).max(32),
  company: z.string().max(200).nullable().optional(),
  theme: z.enum(enumValues(Theme)).nullable().optional(),
  priority: z.enum(enumValues(WatchlistPriority)).nullable().optional(),
  action: z.enum(enumValues(WatchlistAction)).nullable().optional(),
  riskLevel: z.enum(enumValues(RiskLevel)).nullable().optional(),
  analystRating: z.enum(enumValues(AnalystRating)).nullable().optional(),
  marketCapBucket: z.enum(enumValues(MarketCapBucket)).nullable().optional(),
  entryZone: z.string().max(500).nullable().optional(),
  stopLoss: z.number().positive().nullable().optional(),
  /** Consensus analyst price target USD; server recomputes `upsidePct`. */
  analystTarget: z.number().positive().nullable().optional(),
  /** Optional bull-case target USD (watchlist only). */
  bullTarget: z.number().positive().nullable().optional(),
  keyCatalyst: z.string().max(2000).nullable().optional(),
  keyRisk: z.string().max(2000).nullable().optional(),
  thesis: reportBlocksSchema.nullable().optional(),
  actionNotes: reportBlocksSchema.nullable().optional(),
  pageNotes: reportBlocksSchema.nullable().optional(),
  /** YYYY-MM-DD; recomputes daysToEarnings. Null clears both. */
  earningsDate: dateYmd.nullable().optional(),
  // No currentPrice / upsidePct — price sync owns marks; upside is derived.
});

export const listDailyLogsQuerySchema = z.object({
  since: dateYmd.optional(),
  until: dateYmd.optional(),
  limit: z.coerce.number().int().min(1).max(90).optional(),
  routineType: z.enum(enumValues(DailyLogRoutine)).optional(),
});

export const getPageNotesInputSchema = z.object({
  target: z.enum(["portfolio", "watchlist"]),
  ticker: z.string().min(1).max(32),
  /** Newest-first page size (default 20, max 100). */
  limit: z.number().int().min(1).max(100).optional(),
  /** Skip newest N blocks (for pagination). */
  offset: z.number().int().min(0).max(10_000).optional(),
});

export const listReportsQuerySchema = z.object({
  reportType: z.enum(enumValues(StockReportType)).optional(),
  since: dateYmd.optional(),
  until: dateYmd.optional(),
  limit: z.coerce.number().int().min(1).max(36).optional(),
});

export const upsertDecisionReviewInputSchema = z.object({
  idempotencyKey: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(500),
  ticker: z.string().min(1).max(32).nullable().optional(),
  decisionDate: dateYmd.nullable().optional(),
  decisionType: z.enum(enumValues(DecisionType)).nullable().optional(),
  positionContext: z.enum(enumValues(DecisionPositionContext)).nullable().optional(),
  priceAtDecision: z.number().positive().nullable().optional(),
  entryZone: z.string().max(500).nullable().optional(),
  stopLoss: z.number().positive().nullable().optional(),
  target: z.number().positive().nullable().optional(),
  convictionScore: z.number().int().min(1).max(5).nullable().optional(),
  catalyst: z.string().max(2000).nullable().optional(),
  catalystDate: dateYmd.nullable().optional(),
  originalThesis: z.string().max(8000).nullable().optional(),
  expectedOutcome: z.string().max(4000).nullable().optional(),
  keyMetricToWatch: z.string().max(2000).nullable().optional(),
  reasonForDecision: z.string().max(16000).nullable().optional(),
  riskInvalidation: z.string().max(4000).nullable().optional(),
  sourceSignal: z.array(z.string().max(200)).optional(),
  antiPatternTags: z.array(z.string().max(200)).optional(),
  criteriaThatWorked: z.array(z.string().max(200)).optional(),
  criteriaThatFailed: z.array(z.string().max(200)).optional(),
  reviewStatus: z.enum(enumValues(DecisionReviewStatus)).nullable().optional(),
  outcome1w: z.string().max(4000).nullable().optional(),
  outcome4w: z.string().max(4000).nullable().optional(),
  outcome3m: z.string().max(4000).nullable().optional(),
  return1wPct: z.number().nullable().optional(), // percentage points (−2.5 = −2.5%), not fraction
  return4wPct: z.number().nullable().optional(),
  return3mPct: z.number().nullable().optional(),
  finalVerdict: z.enum(enumValues(DecisionVerdict)).nullable().optional(),
  signalQuality: z.enum(enumValues(DecisionSignalQuality)).nullable().optional(),
  executionQuality: z.enum(enumValues(DecisionSignalQuality)).nullable().optional(),
  lessonLearned: z.string().max(8000).nullable().optional(),
  updateStrategy: z.boolean().nullable().optional(),
  rulesVersion: z.string().max(64).nullable().optional(),
});

export const listDecisionReviewsQuerySchema = z.object({
  ticker: z.string().min(1).max(32).optional(),
  reviewStatus: z.enum(enumValues(DecisionReviewStatus)).optional(),
  /** Include only Pending rows whose decisionDate is within this many days (lookahead). */
  pendingDueWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const upsertContentPageInputSchema = z.object({
  key: z.enum(enumValues(ContentPageKey)),
  title: z.string().min(1).max(300).optional(),
  body: reportBlocksSchema,
  rulesVersion: z.string().max(64).nullable().optional(),
});

export const getContentPageInputSchema = z.object({
  key: z.enum(enumValues(ContentPageKey)),
});

export const upsertTrendInputSchema = z.object({
  trendName: z.string().min(1).max(200),
  dateDiscovered: dateYmd.nullable().optional(),
  representativeTickers: z.string().max(500).nullable().optional(),
  theme: z.enum(enumValues(Theme)).nullable().optional(),
  lifecycleStage: z.enum(enumValues(TrendStage)).nullable().optional(),
  signalScore: z.number().int().min(0).max(100).nullable().optional(),
  socialVelocity: z.number().int().nullable().optional(),
  analystMomentum: z.number().int().nullable().optional(),
  priceClustering: z.number().int().nullable().optional(),
  fundamentalBacking: z.number().int().nullable().optional(),
  discoveredVia: z.enum(enumValues(DiscoveredVia)).nullable().optional(),
  weekMomentum: z.enum(enumValues(WeekMomentum)).nullable().optional(),
  perf1m: z.number().nullable().optional(), // percentage points, not fraction
  perf3m: z.number().nullable().optional(),
  verdict: z.enum(enumValues(TrendVerdict)).nullable().optional(),
  similarToPastTrend: z.string().max(500).nullable().optional(),
  keyCatalyst: z.string().max(2000).nullable().optional(),
  avoidReason: reportBlocksSchema.nullable().optional(),
  notes: reportBlocksSchema.nullable().optional(),
  retrospective: reportBlocksSchema.nullable().optional(),
});

export const upsertIdeaFieldsSchema = z.object({
  stockSector: z.string().min(1).max(200).optional(),
  leadTicker: z.string().min(1).max(32).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  theme: z.enum(enumValues(Theme)).nullable().optional(),
  riskLevel: z.enum(enumValues(RiskLevel)).nullable().optional(),
  status: z.enum(enumValues(IdeaStatus)).nullable().optional(),
  ideaStage: z.enum(enumValues(IdeaStage)).nullable().optional(),
  socialBuzz: z.string().max(500).nullable().optional(),
  foundVia: z.string().max(200).nullable().optional(),
  whyInteresting: reportBlocksSchema.nullable().optional(),
  keyRisk: z.string().max(2000).nullable().optional(),
  notes: reportBlocksSchema.nullable().optional(),
  catalystDate: dateYmd.nullable().optional(),
  dateFound: dateYmd.nullable().optional(),
  lastReviewed: dateYmd.nullable().optional(),
  graduationDate: dateYmd.nullable().optional(),
  graduationPrice: z.number().positive().nullable().optional(),
  // No currentPrice.
});

export const upsertIdeaInputSchema = upsertIdeaFieldsSchema.refine(
  (v) => Boolean(v.stockSector?.trim() || v.leadTicker?.trim()),
  { message: "stockSector or leadTicker is required" },
);

const limitsPatchSchema = z
  .object({
    singlePositionPct: z.number().min(0).max(1).optional(),
    themePct: z.number().min(0).max(1).optional(),
    speculativeSleevePct: z.number().min(0).max(1).optional(),
    cashFloorPct: z.number().min(0).max(1).optional(),
    maxAverageDowns: z.number().int().min(0).max(20).optional(),
    tierBands: z
      .object({
        TEST_STARTER: z.tuple([z.number(), z.number()]).optional(),
        CONFIRMATION: z.tuple([z.number(), z.number()]).optional(),
        CONVICTION: z.tuple([z.number(), z.number()]).optional(),
      })
      .optional(),
  })
  .strict();

const sentimentPatchSchema = z
  .object({
    veryBullish: z.number().optional(),
    bullish: z.number().optional(),
    neutral: z.number().optional(),
  })
  .strict();

const earningsRiskPatchSchema = z
  .object({
    imminentMaxDays: z.number().int().optional(),
    soonMaxDays: z.number().int().optional(),
  })
  .strict();

const trackedTickersPatchSchema = z
  .object({
    portfolio: z.array(z.string()).optional(),
    watchlist: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Safe Config PATCH surface.
 * Allowed: cash, FX, thresholds, tracked tickers, LIMITS (live thresholds — document carefully).
 * Never: prompts / strategy prose.
 */
export const patchConfigFieldsSchema = z
  .object({
    CASH_POSITION_USD: z.number().finite().optional(),
    CASH_POSITION_MYR: z.number().finite().optional(),
    FX_RATE_USD_MYR: z.number().positive().optional(),
    CASH_LAST_UPDATED: z.string().nullable().optional(),
    LIMITS: limitsPatchSchema.optional(),
    SENTIMENT_THRESHOLDS: sentimentPatchSchema.optional(),
    EARNINGS_RISK_THRESHOLDS: earningsRiskPatchSchema.optional(),
    TRACKED_TICKERS: trackedTickersPatchSchema.optional(),
  })
  .strict();

export const patchConfigInputSchema = patchConfigFieldsSchema.refine(
  (o) => Object.keys(o).length > 0,
  { message: "at least one config key required" },
);

/** Legal enum values keyed by Prisma enum name (for 400 responses). */
export const LEGAL_ENUM_VALUES: Record<string, string[]> = {
  TradeType: Object.values(TradeType),
  TradeStatus: Object.values(TradeStatus),
  PositionAction: Object.values(PositionAction),
  Sleeve: Object.values(Sleeve),
  Theme: Object.values(Theme),
  RiskLevel: Object.values(RiskLevel),
  WatchlistPriority: Object.values(WatchlistPriority),
  WatchlistAction: Object.values(WatchlistAction),
  AnalystRating: Object.values(AnalystRating),
  MarketCapBucket: Object.values(MarketCapBucket),
  TrendStage: Object.values(TrendStage),
  TrendVerdict: Object.values(TrendVerdict),
  WeekMomentum: Object.values(WeekMomentum),
  DiscoveredVia: Object.values(DiscoveredVia),
  IdeaStatus: Object.values(IdeaStatus),
  IdeaStage: Object.values(IdeaStage),
  StockReportType: Object.values(StockReportType),
  DecisionType: Object.values(DecisionType),
  DecisionReviewStatus: Object.values(DecisionReviewStatus),
  DecisionVerdict: Object.values(DecisionVerdict),
  DecisionSignalQuality: Object.values(DecisionSignalQuality),
  DecisionPositionContext: Object.values(DecisionPositionContext),
  ContentPageKey: Object.values(ContentPageKey),
  DailyLogRoutine: Object.values(DailyLogRoutine),
};

/** Map zod path leaf → enum name when known. */
const PATH_TO_ENUM: Record<string, string> = {
  type: "TradeType",
  status: "TradeStatus",
  action: "PositionAction",
  sleeve: "Sleeve",
  theme: "Theme",
  riskLevel: "RiskLevel",
  priority: "WatchlistPriority",
  analystRating: "AnalystRating",
  marketCapBucket: "MarketCapBucket",
  lifecycleStage: "TrendStage",
  verdict: "TrendVerdict",
  weekMomentum: "WeekMomentum",
  discoveredVia: "DiscoveredVia",
  ideaStage: "IdeaStage",
  reportType: "StockReportType",
  decisionType: "DecisionType",
  reviewStatus: "DecisionReviewStatus",
  finalVerdict: "DecisionVerdict",
  signalQuality: "DecisionSignalQuality",
  executionQuality: "DecisionSignalQuality",
  positionContext: "DecisionPositionContext",
  key: "ContentPageKey",
  routineType: "DailyLogRoutine",
};

/** Disambiguate `status` / `action` when multiple enums share the field name. */
function resolveEnumName(field: string, options?: string[]): string | undefined {
  if (field === "status" && options?.length) {
    const idea = new Set(LEGAL_ENUM_VALUES.IdeaStatus);
    if (options.every((o) => idea.has(o))) return "IdeaStatus";
    const review = new Set(LEGAL_ENUM_VALUES.DecisionReviewStatus);
    if (options.every((o) => review.has(o))) return "DecisionReviewStatus";
    return "TradeStatus";
  }
  if (field === "action" && options?.length) {
    const wl = new Set(LEGAL_ENUM_VALUES.WatchlistAction);
    if (options.every((o) => wl.has(o))) return "WatchlistAction";
    return "PositionAction";
  }
  return PATH_TO_ENUM[field];
}

export type AgentValidationFailure = {
  error: string;
  issues: z.ZodIssue[];
  legalValues?: string[];
  field?: string;
};

/** Build a structured 400 payload; attach legalValues for invalid enums. */
export function validationFailure(err: z.ZodError): AgentValidationFailure {
  const enumIssue = err.issues.find((i) => String(i.code) === "invalid_enum_value");
  if (enumIssue) {
    const field = String(enumIssue.path[enumIssue.path.length - 1] ?? "");
    const fromIssue =
      "options" in enumIssue && Array.isArray((enumIssue as { options?: unknown }).options)
        ? ((enumIssue as { options: string[] }).options as string[])
        : undefined;
    const enumName = resolveEnumName(field, fromIssue);
    return {
      error: `invalid enum value for ${field || "field"}`,
      issues: err.issues,
      field: field || undefined,
      legalValues: fromIssue ?? (enumName ? LEGAL_ENUM_VALUES[enumName] : undefined),
    };
  }
  return {
    error: err.issues[0]?.message ?? "validation failed",
    issues: err.issues,
  };
}
