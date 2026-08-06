import type {
  AnalystRating,
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
  Theme,
  TradeStatus,
  TradeType,
  TrendStage,
  TrendVerdict,
  WatchlistAction,
  WatchlistPriority,
  WeekMomentum,
} from "@/generated/prisma/client";
import type { DerivedEarningsRisk, DerivedSentiment } from "@/lib/stocks/derived";
import { normalizeRiskLevel } from "@/lib/stocks/normalizeStatus";

/** Grey badge only for null/undefined — never for unknown enum members. */
export const NULL_BADGE_CLASS = "bg-gray-100 text-gray-600";

export const POSITION_ACTION_LABEL: Record<PositionAction, string> = {
  HOLD: "Hold",
  ADD_ON_DIP: "Add on dip",
  REDUCE: "Reduce",
  EXIT: "Exit",
  WATCH: "Watch",
};

export const POSITION_ACTION_CLASS: Record<PositionAction, string> = {
  HOLD: "bg-gray-100 text-gray-700",
  ADD_ON_DIP: "bg-emerald-100 text-emerald-800",
  REDUCE: "bg-amber-100 text-amber-800",
  EXIT: "bg-red-100 text-red-700",
  WATCH: "bg-blue-100 text-blue-700",
};

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  LOW: "Low",
  LOW_MEDIUM: "Low-Medium",
  MEDIUM: "Medium",
  MEDIUM_HIGH: "Medium-High",
  HIGH: "High",
  VERY_HIGH: "Very High",
};

export const RISK_LEVEL_CLASS: Record<RiskLevel, string> = {
  LOW: "bg-emerald-50 text-emerald-700",
  LOW_MEDIUM: "bg-emerald-50 text-emerald-700",
  MEDIUM: "bg-yellow-50 text-yellow-700",
  MEDIUM_HIGH: "bg-orange-50 text-orange-700",
  HIGH: "bg-red-50 text-red-700",
  VERY_HIGH: "bg-red-100 text-red-800",
};

/** Donut / chart hex colours keyed by RiskLevel. */
export const RISK_LEVEL_COLOR: Record<RiskLevel, string> = {
  LOW: "#10b981",
  LOW_MEDIUM: "#22c55e",
  MEDIUM: "#eab308",
  MEDIUM_HIGH: "#f97316",
  HIGH: "#ef4444",
  VERY_HIGH: "#b91c1c",
};

export const WATCHLIST_PRIORITY_LABEL: Record<WatchlistPriority, string> = {
  BUY_NOW: "Buy now",
  WAIT_FOR_ENTRY: "Wait for entry",
  WATCH: "Watch",
  SKIP_FOR_NOW: "Skip for now",
};

export const WATCHLIST_PRIORITY_CLASS: Record<WatchlistPriority, string> = {
  BUY_NOW: "bg-emerald-100 text-emerald-800",
  WAIT_FOR_ENTRY: "bg-blue-100 text-blue-700",
  WATCH: "bg-gray-100 text-gray-700",
  SKIP_FOR_NOW: "bg-red-50 text-red-700",
};

export const WATCHLIST_ACTION_LABEL: Record<WatchlistAction, string> = {
  BUY_SUGGESTED: "Buy suggested",
  EARLY_ENTRY: "Early entry",
  DEMOTED: "Demoted",
  DROPPED: "Dropped",
};

export const WATCHLIST_ACTION_CLASS: Record<WatchlistAction, string> = {
  BUY_SUGGESTED: "bg-emerald-100 text-emerald-800",
  EARLY_ENTRY: "bg-amber-100 text-amber-800",
  DEMOTED: "bg-gray-200 text-gray-600",
  DROPPED: "bg-red-50 text-red-700",
};

export const DECISION_TYPE_LABEL: Record<DecisionType, string> = {
  BUY: "Buy",
  ADD: "Add",
  AVERAGE_DOWN: "Average down",
  HOLD: "Hold",
  REDUCE: "Reduce",
  EXIT: "Exit",
  WAIT: "Wait",
  AVOID: "Avoid",
  DO_NOT_AVERAGE_DOWN: "Do not average down",
};

export const DECISION_TYPE_CLASS: Record<DecisionType, string> = {
  BUY: "bg-emerald-100 text-emerald-800",
  ADD: "bg-emerald-50 text-emerald-700",
  AVERAGE_DOWN: "bg-amber-100 text-amber-800",
  HOLD: "bg-gray-100 text-gray-700",
  REDUCE: "bg-orange-100 text-orange-800",
  EXIT: "bg-red-100 text-red-800",
  WAIT: "bg-blue-100 text-blue-800",
  AVOID: "bg-red-50 text-red-700",
  DO_NOT_AVERAGE_DOWN: "bg-amber-50 text-amber-700",
};

export const DECISION_REVIEW_STATUS_LABEL: Record<DecisionReviewStatus, string> = {
  PENDING: "Pending",
  REVIEWED_1W: "1W reviewed",
  REVIEWED_4W: "4W reviewed",
  REVIEWED_3M: "3M reviewed",
  CLOSED: "Closed",
};

export const DECISION_REVIEW_STATUS_CLASS: Record<DecisionReviewStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  REVIEWED_1W: "bg-blue-50 text-blue-700",
  REVIEWED_4W: "bg-blue-100 text-blue-800",
  REVIEWED_3M: "bg-indigo-100 text-indigo-800",
  CLOSED: "bg-gray-100 text-gray-600",
};

export const DECISION_VERDICT_LABEL: Record<DecisionVerdict, string> = {
  WIN: "Win",
  LOSS: "Loss",
  AVOIDED_LOSS: "Avoided loss",
  TOO_EARLY: "Too early",
  NEUTRAL: "Neutral",
};

export const DECISION_VERDICT_CLASS: Record<DecisionVerdict, string> = {
  WIN: "bg-emerald-100 text-emerald-800",
  LOSS: "bg-red-100 text-red-800",
  AVOIDED_LOSS: "bg-emerald-50 text-emerald-700",
  TOO_EARLY: "bg-amber-50 text-amber-700",
  NEUTRAL: "bg-gray-100 text-gray-700",
};

export const DECISION_SIGNAL_QUALITY_LABEL: Record<DecisionSignalQuality, string> = {
  GOOD: "Good",
  MIXED: "Mixed",
  POOR: "Poor",
  TOO_EARLY: "Too early",
};

export const DECISION_POSITION_CONTEXT_LABEL: Record<DecisionPositionContext, string> = {
  PORTFOLIO: "Portfolio",
  WATCHLIST: "Watchlist",
  NEW_IDEA: "New idea",
  TREND: "Trend",
  EARNINGS: "Earnings",
};

export const ANALYST_RATING_LABEL: Record<AnalystRating, string> = {
  STRONG_BUY: "Strong Buy",
  BUY: "Buy",
  HOLD: "Hold",
  SELL: "Sell",
  NO_COVERAGE: "No Coverage",
};

export const ANALYST_RATING_CLASS: Record<AnalystRating, string> = {
  STRONG_BUY: "bg-emerald-100 text-emerald-800",
  BUY: "bg-emerald-50 text-emerald-700",
  HOLD: "bg-gray-100 text-gray-700",
  SELL: "bg-red-50 text-red-700",
  NO_COVERAGE: "bg-gray-50 text-gray-600",
};

export const MARKET_CAP_BUCKET_LABEL: Record<MarketCapBucket, string> = {
  MEGA: "Mega Cap >$100B",
  LARGE: "Large Cap $10-100B",
  MID: "Mid Cap $1-10B",
  SMALL: "Small Cap <$1B",
};

export const MARKET_CAP_BUCKET_CLASS: Record<MarketCapBucket, string> = {
  MEGA: "bg-indigo-50 text-indigo-700",
  LARGE: "bg-blue-50 text-blue-700",
  MID: "bg-sky-50 text-sky-700",
  SMALL: "bg-slate-50 text-slate-700",
};

export const SLEEVE_LABEL: Record<Sleeve, string> = {
  QUALITY_CORE: "Quality Core",
  MOMENTUM_CATALYST: "Momentum-Catalyst",
  SPECULATIVE: "Speculative",
};

export const SLEEVE_CLASS: Record<Sleeve, string> = {
  QUALITY_CORE: "bg-emerald-50 text-emerald-800",
  MOMENTUM_CATALYST: "bg-amber-50 text-amber-800",
  SPECULATIVE: "bg-violet-50 text-violet-800",
};

export const TREND_STAGE_LABEL: Record<TrendStage, string> = {
  EMERGING: "Emerging",
  BUILDING: "Building",
  HOT: "Hot",
  PEAKED: "Peaked",
  FADED: "Faded",
  PAUSED: "Paused",
};

export const TREND_STAGE_CLASS: Record<TrendStage, string> = {
  EMERGING: "bg-emerald-50 text-emerald-700",
  BUILDING: "bg-orange-50 text-orange-700",
  HOT: "bg-red-50 text-red-700",
  PEAKED: "bg-amber-50 text-amber-800",
  FADED: "bg-slate-100 text-slate-600",
  PAUSED: "bg-gray-100 text-gray-600",
};

export const TREND_VERDICT_LABEL: Record<TrendVerdict, string> = {
  WIN: "Win",
  LOSS: "Loss",
  ONGOING: "Ongoing",
  TOO_EARLY: "Too Early",
};

export const TREND_VERDICT_CLASS: Record<TrendVerdict, string> = {
  WIN: "bg-emerald-100 text-emerald-800",
  LOSS: "bg-red-50 text-red-700",
  ONGOING: "bg-blue-50 text-blue-700",
  TOO_EARLY: "bg-gray-100 text-gray-600",
};

export const WEEK_MOMENTUM_LABEL: Record<WeekMomentum, string> = {
  ACCELERATING: "Accelerating",
  STABLE: "Stable",
  DECELERATING: "Decelerating",
  REVERSED: "Reversed",
};

export const WEEK_MOMENTUM_CLASS: Record<WeekMomentum, string> = {
  ACCELERATING: "bg-emerald-50 text-emerald-700",
  STABLE: "bg-gray-100 text-gray-700",
  DECELERATING: "bg-amber-50 text-amber-700",
  REVERSED: "bg-red-50 text-red-700",
};

export const DISCOVERED_VIA_LABEL: Record<DiscoveredVia, string> = {
  DAILY_SCAN: "Daily Scan",
  WEEKLY_SCAN: "Weekly Scan",
  MONTHLY_SURVEY: "Monthly Survey",
  MANUAL: "Manual",
};

export const DISCOVERED_VIA_CLASS: Record<DiscoveredVia, string> = {
  DAILY_SCAN: "bg-blue-50 text-blue-700",
  WEEKLY_SCAN: "bg-indigo-50 text-indigo-700",
  MONTHLY_SURVEY: "bg-violet-50 text-violet-700",
  MANUAL: "bg-gray-100 text-gray-700",
};

export const TRADE_TYPE_LABEL: Record<TradeType, string> = {
  BUY: "Buy",
  ADD: "Add",
  TRIM: "Trim",
  SELL: "Sell",
  STOP_LOSS: "Stop Loss",
};

export const TRADE_TYPE_CLASS: Record<TradeType, string> = {
  BUY: "bg-emerald-100 text-emerald-800",
  ADD: "bg-emerald-50 text-emerald-700",
  TRIM: "bg-amber-100 text-amber-800",
  SELL: "bg-red-100 text-red-700",
  STOP_LOSS: "bg-red-50 text-red-700",
};

export const TRADE_STATUS_LABEL: Record<TradeStatus, string> = {
  OPEN: "Open",
  PARTIAL: "Partial",
  CLOSED: "Closed",
};

export const TRADE_STATUS_CLASS: Record<TradeStatus, string> = {
  OPEN: "bg-emerald-50 text-emerald-700",
  PARTIAL: "bg-amber-50 text-amber-700",
  CLOSED: "bg-gray-100 text-gray-700",
};

export const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  RESEARCHING: "Researching",
  READY_FOR_WATCHLIST: "Add to Watchlist",
  HOLD_OFF: "Hold Off",
  PASS: "Pass",
  GRADUATED: "Graduated",
};

export const IDEA_STATUS_CLASS: Record<IdeaStatus, string> = {
  RESEARCHING: "bg-gray-100 text-gray-700",
  READY_FOR_WATCHLIST: "bg-emerald-100 text-emerald-800",
  HOLD_OFF: "bg-amber-100 text-amber-800",
  PASS: "bg-red-50 text-red-700",
  GRADUATED: "bg-blue-100 text-blue-700",
};

export const IDEA_STAGE_LABEL: Record<IdeaStage, string> = {
  RADAR: "Radar",
  PRE_BUZZ: "Pre-buzz",
  EMERGING: "Emerging",
  INSTITUTIONALIZING: "Institutionalizing",
  MAINSTREAM: "Mainstream",
};

export const IDEA_STAGE_CLASS: Record<IdeaStage, string> = {
  RADAR: "bg-slate-100 text-slate-700",
  PRE_BUZZ: "bg-emerald-50 text-emerald-800",
  EMERGING: "bg-sky-50 text-sky-800",
  INSTITUTIONALIZING: "bg-indigo-50 text-indigo-800",
  MAINSTREAM: "bg-amber-50 text-amber-800",
};

export const THEME_LABEL: Record<Theme, string> = {
  AI_INFRASTRUCTURE: "AI Infrastructure",
  NUCLEAR_POWER: "Nuclear / Power",
  HUMANOID_ROBOTS: "Humanoid Robots",
  SPACE: "Space",
  CRYPTO: "Crypto",
  RETAIL_TECH: "Retail Tech",
  HEALTHCARE: "Healthcare",
  FINTECH_PAYMENTS: "FinTech / Payments",
  DEFENSE_DRONES: "Defense / Drones",
  MEME_SPECIAL_SIT: "Meme / Special Sit",
  BIOTECH_GLP1: "Biotech / GLP-1",
  ENERGY_COMMODITIES: "Energy / Commodities",
  MARITIME_SHIPBUILDING: "Maritime / Shipbuilding",
  QUANTUM: "Quantum",
  PREDICTION_MARKETS: "Prediction Markets",
  MACRO: "Macro",
  CRITICAL_MINERALS: "Critical Minerals",
};

export const THEME_CLASS: Record<Theme, string> = {
  AI_INFRASTRUCTURE: "bg-violet-50 text-violet-800",
  NUCLEAR_POWER: "bg-amber-50 text-amber-800",
  HUMANOID_ROBOTS: "bg-sky-50 text-sky-800",
  SPACE: "bg-indigo-50 text-indigo-800",
  CRYPTO: "bg-orange-50 text-orange-800",
  RETAIL_TECH: "bg-pink-50 text-pink-800",
  HEALTHCARE: "bg-teal-50 text-teal-800",
  FINTECH_PAYMENTS: "bg-emerald-50 text-emerald-800",
  DEFENSE_DRONES: "bg-stone-100 text-stone-800",
  MEME_SPECIAL_SIT: "bg-fuchsia-50 text-fuchsia-800",
  BIOTECH_GLP1: "bg-rose-50 text-rose-800",
  ENERGY_COMMODITIES: "bg-lime-50 text-lime-800",
  MARITIME_SHIPBUILDING: "bg-cyan-50 text-cyan-800",
  QUANTUM: "bg-blue-50 text-blue-800",
  PREDICTION_MARKETS: "bg-yellow-50 text-yellow-800",
  MACRO: "bg-slate-100 text-slate-800",
  CRITICAL_MINERALS: "bg-zinc-100 text-zinc-800",
};

/** Donut / chart hex colours keyed by Theme. */
export const THEME_COLOR: Record<Theme, string> = {
  AI_INFRASTRUCTURE: "#7c3aed",
  NUCLEAR_POWER: "#d97706",
  HUMANOID_ROBOTS: "#0284c7",
  SPACE: "#4338ca",
  CRYPTO: "#ea580c",
  RETAIL_TECH: "#db2777",
  HEALTHCARE: "#0d9488",
  FINTECH_PAYMENTS: "#059669",
  DEFENSE_DRONES: "#57534e",
  MEME_SPECIAL_SIT: "#c026d3",
  BIOTECH_GLP1: "#e11d48",
  ENERGY_COMMODITIES: "#65a30d",
  MARITIME_SHIPBUILDING: "#0891b2",
  QUANTUM: "#2563eb",
  PREDICTION_MARKETS: "#ca8a04",
  MACRO: "#475569",
  CRITICAL_MINERALS: "#71717a",
};

export const DERIVED_SENTIMENT_LABEL: Record<DerivedSentiment, string> = {
  VERY_BULLISH: "Extremely Bullish",
  BULLISH: "Bullish",
  NEUTRAL: "Neutral",
  BEARISH: "Bearish",
};

export const DERIVED_SENTIMENT_CLASS: Record<DerivedSentiment, string> = {
  VERY_BULLISH: "bg-emerald-100 text-emerald-900",
  BULLISH: "bg-emerald-50 text-emerald-800",
  NEUTRAL: "bg-gray-100 text-gray-700",
  BEARISH: "bg-red-50 text-red-700",
};

export const DERIVED_EARNINGS_RISK_LABEL: Record<DerivedEarningsRisk, string> = {
  IMMINENT: "Imminent",
  SOON: "Soon",
  CLEAR: "Clear",
};

export const DERIVED_EARNINGS_RISK_CLASS: Record<DerivedEarningsRisk, string> = {
  IMMINENT: "bg-red-50 text-red-700",
  SOON: "bg-amber-50 text-amber-800",
  CLEAR: "bg-emerald-50 text-emerald-700",
};

export function positionActionLabel(v: PositionAction | null | undefined): string {
  if (v == null) return "—";
  return POSITION_ACTION_LABEL[v];
}

export function riskLevelLabel(v: RiskLevel | string | null | undefined): string {
  if (v == null) return "—";
  if (v in RISK_LEVEL_LABEL) return RISK_LEVEL_LABEL[v as RiskLevel];
  const n = normalizeRiskLevel(v);
  return n ? RISK_LEVEL_LABEL[n] : v;
}

export function watchlistPriorityLabel(v: WatchlistPriority | null | undefined): string {
  if (v == null) return "—";
  return WATCHLIST_PRIORITY_LABEL[v];
}

export function tradeTypeLabel(v: TradeType | null | undefined): string {
  if (v == null) return "—";
  return TRADE_TYPE_LABEL[v];
}

export function tradeStatusLabel(v: TradeStatus | null | undefined): string {
  if (v == null) return "—";
  return TRADE_STATUS_LABEL[v];
}

export function ideaStatusLabel(v: IdeaStatus | null | undefined): string {
  if (v == null) return "—";
  return IDEA_STATUS_LABEL[v];
}

export function ideaStageLabel(v: IdeaStage | null | undefined): string {
  if (v == null) return "—";
  return IDEA_STAGE_LABEL[v];
}

export function trendStageLabel(v: TrendStage | null | undefined): string {
  if (v == null) return "—";
  return TREND_STAGE_LABEL[v];
}

export function trendVerdictLabel(v: TrendVerdict | null | undefined): string {
  if (v == null) return "—";
  return TREND_VERDICT_LABEL[v];
}

export function weekMomentumLabel(v: WeekMomentum | null | undefined): string {
  if (v == null) return "—";
  return WEEK_MOMENTUM_LABEL[v];
}

export function themeLabel(v: Theme | null | undefined): string {
  if (v == null) return "—";
  return THEME_LABEL[v];
}

export function sleeveLabel(v: Sleeve | null | undefined): string {
  if (v == null) return "—";
  return SLEEVE_LABEL[v];
}

export function decisionTypeLabel(v: DecisionType | null | undefined): string {
  if (v == null) return "—";
  return DECISION_TYPE_LABEL[v];
}

export function decisionReviewStatusLabel(
  v: DecisionReviewStatus | null | undefined,
): string {
  if (v == null) return "—";
  return DECISION_REVIEW_STATUS_LABEL[v];
}

export function decisionVerdictLabel(v: DecisionVerdict | null | undefined): string {
  if (v == null) return "—";
  return DECISION_VERDICT_LABEL[v];
}

export function decisionSignalQualityLabel(
  v: DecisionSignalQuality | null | undefined,
): string {
  if (v == null) return "—";
  return DECISION_SIGNAL_QUALITY_LABEL[v];
}

export function decisionPositionContextLabel(
  v: DecisionPositionContext | null | undefined,
): string {
  if (v == null) return "—";
  return DECISION_POSITION_CONTEXT_LABEL[v];
}

export function derivedSentimentLabel(v: DerivedSentiment | null | undefined): string {
  if (v == null) return "—";
  return DERIVED_SENTIMENT_LABEL[v];
}

export function derivedEarningsRiskLabel(v: DerivedEarningsRisk | null | undefined): string {
  if (v == null) return "—";
  return DERIVED_EARNINGS_RISK_LABEL[v];
}
