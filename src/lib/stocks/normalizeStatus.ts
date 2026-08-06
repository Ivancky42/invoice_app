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

/**
 * Lowercase, strip emoji / non-alphanumeric (keep spaces and hyphens), collapse whitespace.
 */
export function normalizeKey(raw: string | null | undefined): string {
  if (raw == null) return "";
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_/+$%<>.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lookup<T extends string>(
  aliases: Record<string, T>,
  raw: string | null | undefined,
): T | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  return aliases[key] ?? null;
}

export const ACTION_ALIASES: Record<string, PositionAction> = {
  hold: "HOLD",
  "add on dip": "ADD_ON_DIP",
  "addon dip": "ADD_ON_DIP",
  "add-on dip": "ADD_ON_DIP",
  reduce: "REDUCE",
  trim: "REDUCE",
  exit: "EXIT",
  watch: "WATCH",
};

export const RISK_ALIASES: Record<string, RiskLevel> = {
  low: "LOW",
  "low-medium": "LOW_MEDIUM",
  "low medium": "LOW_MEDIUM",
  medium: "MEDIUM",
  "medium-high": "MEDIUM_HIGH",
  "medium high": "MEDIUM_HIGH",
  high: "HIGH",
  "very high": "VERY_HIGH",
};

export const PRIORITY_ALIASES: Record<string, WatchlistPriority> = {
  "buy now": "BUY_NOW",
  "wait for entry": "WAIT_FOR_ENTRY",
  watch: "WATCH",
  "skip for now": "SKIP_FOR_NOW",
  skip: "SKIP_FOR_NOW",
};

export const WATCHLIST_ACTION_ALIASES: Record<string, WatchlistAction> = {
  "buy suggested": "BUY_SUGGESTED",
  "buy - suggested": "BUY_SUGGESTED",
  "buy-suggested": "BUY_SUGGESTED",
  "buy suggested awaiting ivan execution": "BUY_SUGGESTED",
  "early entry": "EARLY_ENTRY",
  "early entry speculative": "EARLY_ENTRY",
  demoted: "DEMOTED",
  dropped: "DROPPED",
};

export const DECISION_TYPE_ALIASES: Record<string, DecisionType> = {
  buy: "BUY",
  add: "ADD",
  "average down": "AVERAGE_DOWN",
  averagedown: "AVERAGE_DOWN",
  hold: "HOLD",
  reduce: "REDUCE",
  exit: "EXIT",
  wait: "WAIT",
  avoid: "AVOID",
  "do not average down": "DO_NOT_AVERAGE_DOWN",
  "do-not-average-down": "DO_NOT_AVERAGE_DOWN",
};

export const DECISION_REVIEW_STATUS_ALIASES: Record<string, DecisionReviewStatus> = {
  pending: "PENDING",
  "1w reviewed": "REVIEWED_1W",
  "4w reviewed": "REVIEWED_4W",
  "3m reviewed": "REVIEWED_3M",
  closed: "CLOSED",
};

export const DECISION_VERDICT_ALIASES: Record<string, DecisionVerdict> = {
  win: "WIN",
  loss: "LOSS",
  "avoided loss": "AVOIDED_LOSS",
  "too early": "TOO_EARLY",
  neutral: "NEUTRAL",
};

export const DECISION_SIGNAL_QUALITY_ALIASES: Record<string, DecisionSignalQuality> = {
  good: "GOOD",
  mixed: "MIXED",
  poor: "POOR",
  "too early": "TOO_EARLY",
};

export const DECISION_POSITION_CONTEXT_ALIASES: Record<string, DecisionPositionContext> = {
  portfolio: "PORTFOLIO",
  watchlist: "WATCHLIST",
  "new idea": "NEW_IDEA",
  trend: "TREND",
  earnings: "EARNINGS",
};

export const ANALYST_RATING_ALIASES: Record<string, AnalystRating> = {
  "strong buy": "STRONG_BUY",
  buy: "BUY",
  hold: "HOLD",
  sell: "SELL",
  "no coverage": "NO_COVERAGE",
};

export const MARKET_CAP_ALIASES: Record<string, MarketCapBucket> = {
  mega: "MEGA",
  "mega cap": "MEGA",
  "mega cap >$100b": "MEGA",
  "mega cap >100b": "MEGA",
  large: "LARGE",
  "large cap": "LARGE",
  "large cap $10-100b": "LARGE",
  "large cap 10-100b": "LARGE",
  mid: "MID",
  "mid cap": "MID",
  "mid cap $1-10b": "MID",
  "mid cap 1-10b": "MID",
  small: "SMALL",
  "small cap": "SMALL",
  "small cap <$1b": "SMALL",
  "small cap <1b": "SMALL",
};

export const SLEEVE_ALIASES: Record<string, Sleeve> = {
  "quality core": "QUALITY_CORE",
  "momentum-catalyst": "MOMENTUM_CATALYST",
  "momentum catalyst": "MOMENTUM_CATALYST",
  speculative: "SPECULATIVE",
};

export const TREND_STAGE_ALIASES: Record<string, TrendStage> = {
  emerging: "EMERGING",
  building: "BUILDING",
  hot: "HOT",
  peaked: "PEAKED",
  faded: "FADED",
  paused: "PAUSED",
};

export const TREND_VERDICT_ALIASES: Record<string, TrendVerdict> = {
  win: "WIN",
  loss: "LOSS",
  ongoing: "ONGOING",
  "too early": "TOO_EARLY",
};

export const WEEK_MOMENTUM_ALIASES: Record<string, WeekMomentum> = {
  accelerating: "ACCELERATING",
  stable: "STABLE",
  decelerating: "DECELERATING",
  reversed: "REVERSED",
};

export const DISCOVERED_VIA_ALIASES: Record<string, DiscoveredVia> = {
  "daily scan": "DAILY_SCAN",
  "weekly scan": "WEEKLY_SCAN",
  "monthly survey": "MONTHLY_SURVEY",
  manual: "MANUAL",
};

/** Notion: BUY / SELL / ADD / TRIM / STOP LOSS. STOP OUT kept as alias for legacy rows. */
export const TRADE_TYPE_ALIASES: Record<string, TradeType> = {
  buy: "BUY",
  add: "ADD",
  trim: "TRIM",
  sell: "SELL",
  "stop loss": "STOP_LOSS",
  stop: "STOP_LOSS",
  "stop out": "STOP_LOSS",
  stop_out: "STOP_LOSS",
  stop_loss: "STOP_LOSS",
  // EXIT was in the MD draft but is not a Notion Trade Type; map if seen in free text
  exit: "SELL",
  close: "SELL",
};

export const TRADE_STATUS_ALIASES: Record<string, TradeStatus> = {
  open: "OPEN",
  partial: "PARTIAL",
  closed: "CLOSED",
};

/**
 * Notion Ideas Status: Researching / Add to Watchlist / Hold Off / Pass / Graduated.
 * Legacy "Ready for Watchlist" / "Conviction Building" aliases kept for Neon rows.
 */
export const IDEA_STATUS_ALIASES: Record<string, IdeaStatus> = {
  researching: "RESEARCHING",
  "add to watchlist": "READY_FOR_WATCHLIST",
  "ready for watchlist": "READY_FOR_WATCHLIST",
  "conviction building": "RESEARCHING",
  "hold off": "HOLD_OFF",
  pass: "PASS",
  graduated: "GRADUATED",
};

/** Notion Ideas Stage: Radar / Pre-buzz / Emerging / Institutionalizing / Mainstream. */
export const IDEA_STAGE_ALIASES: Record<string, IdeaStage> = {
  radar: "RADAR",
  "pre-buzz": "PRE_BUZZ",
  "pre buzz": "PRE_BUZZ",
  prebuzz: "PRE_BUZZ",
  emerging: "EMERGING",
  institutionalizing: "INSTITUTIONALIZING",
  mainstream: "MAINSTREAM",
};

/**
 * Signed THEME_ALIASES (Ivan/orchestrator §3.2) + obvious extensions from Neon/Notion
 * compound labels that clearly mean one of the ten. Unmapped → null (do not invent).
 */
export const THEME_ALIASES: Record<string, Theme> = {
  // --- signed ---
  "nuclear/power": "NUCLEAR_POWER",
  "nuclear + power": "NUCLEAR_POWER",
  "nuclear power": "NUCLEAR_POWER",
  nuclear: "NUCLEAR_POWER",
  "crypto/digital assets": "CRYPTO",
  crypto: "CRYPTO",
  "digital assets": "CRYPTO",
  "meme/special sit": "MEME_SPECIAL_SIT",
  meme: "MEME_SPECIAL_SIT",
  "meme special sit": "MEME_SPECIAL_SIT",
  "special sit": "MEME_SPECIAL_SIT",
  "social platforms": "SOCIAL_PLATFORMS",
  "social platform": "SOCIAL_PLATFORMS",
  "consumer internet": "SOCIAL_PLATFORMS",
  "social media": "SOCIAL_PLATFORMS",
  reddit: "SOCIAL_PLATFORMS",
  "ai infrastructure": "AI_INFRASTRUCTURE",
  "ai / infrastructure": "AI_INFRASTRUCTURE",
  ai: "AI_INFRASTRUCTURE",
  "humanoid robots": "HUMANOID_ROBOTS",
  humanoids: "HUMANOID_ROBOTS",
  robots: "HUMANOID_ROBOTS",
  space: "SPACE",
  "retail tech": "RETAIL_TECH",
  "retail/tech": "RETAIL_TECH",
  retail: "RETAIL_TECH",
  healthcare: "HEALTHCARE",
  "health care": "HEALTHCARE",
  "fintech / payments": "FINTECH_PAYMENTS",
  "fintech/payments": "FINTECH_PAYMENTS",
  fintech: "FINTECH_PAYMENTS",
  payments: "FINTECH_PAYMENTS",
  "defense / drones": "DEFENSE_DRONES",
  "defense/drones": "DEFENSE_DRONES",
  defense: "DEFENSE_DRONES",
  drones: "DEFENSE_DRONES",
  // --- obvious extensions (compound Notion/Neon labels) ---
  "space / spacex ipo": "SPACE",
  "space / commercial launch / satellite": "SPACE",
  "defense + drones": "DEFENSE_DRONES",
  "defense tech / ai warfare / drone autonomy": "DEFENSE_DRONES",
  "healthcare / insurance / managed care": "HEALTHCARE",
  "humanoid robotics / physical ai": "HUMANOID_ROBOTS",
  "nuclear / power / energy": "NUCLEAR_POWER",
  "nuclear / power / energy fuel supply chain": "NUCLEAR_POWER",
  "ai infrastructure / cybersecurity software": "AI_INFRASTRUCTURE",
  "ai infrastructure / semiconductors custom asic switching optical interconnect":
    "AI_INFRASTRUCTURE",
  "ai infrastructure / semiconductors storage layer": "AI_INFRASTRUCTURE",
  "ai infrastructure / semiconductors memory layer": "AI_INFRASTRUCTURE",
  "fintech / payments / digital assets": "FINTECH_PAYMENTS",
  "fintech / brokerage / regulated event contracts": "PREDICTION_MARKETS",
  // --- option A: new Theme values ---
  "biotech / glp-1": "BIOTECH_GLP1",
  "biotech/glp-1": "BIOTECH_GLP1",
  biotech: "BIOTECH_GLP1",
  "glp-1": "BIOTECH_GLP1",
  glp1: "BIOTECH_GLP1",
  "biotech / pharma / cardiometabolic": "BIOTECH_GLP1",
  "biotech / cns / psychedelics": "BIOTECH_GLP1",
  psychedelics: "BIOTECH_GLP1",
  "energy / commodities": "ENERGY_COMMODITIES",
  "energy/commodities": "ENERGY_COMMODITIES",
  energy: "ENERGY_COMMODITIES",
  commodities: "ENERGY_COMMODITIES",
  "energy / power infrastructure grid equipment transmission electrification":
    "ENERGY_COMMODITIES",
  "grid equipment": "ENERGY_COMMODITIES",
  electrification: "ENERGY_COMMODITIES",
  "maritime / shipbuilding": "MARITIME_SHIPBUILDING",
  "maritime/shipbuilding": "MARITIME_SHIPBUILDING",
  maritime: "MARITIME_SHIPBUILDING",
  shipbuilding: "MARITIME_SHIPBUILDING",
  "defense / maritime industrial base": "MARITIME_SHIPBUILDING",
  "us naval / maritime shipbuilding revival ships act": "MARITIME_SHIPBUILDING",
  quantum: "QUANTUM",
  "quantum computing": "QUANTUM",
  "quantum computing / deep tech": "QUANTUM",
  "prediction markets": "PREDICTION_MARKETS",
  "event contracts": "PREDICTION_MARKETS",
  "prediction markets / event-contract trading": "PREDICTION_MARKETS",
  macro: "MACRO",
  "macro / trade policy": "MACRO",
  "macro / trade policy / auto / consumer electronics": "MACRO",
  "value/defensive sector rotation": "MACRO",
  "critical minerals": "CRITICAL_MINERALS",
  "rare earths": "CRITICAL_MINERALS",
  "critical minerals / defense supply chain": "CRITICAL_MINERALS",
  "critical minerals / energy commodities": "CRITICAL_MINERALS",
  "mp / rexc rare earths ex-china supply chain": "CRITICAL_MINERALS",
};

export function normalizePositionAction(raw: string | null | undefined): PositionAction | null {
  return lookup(ACTION_ALIASES, raw);
}

export function normalizeRiskLevel(raw: string | null | undefined): RiskLevel | null {
  return lookup(RISK_ALIASES, raw);
}

export function normalizeWatchlistPriority(raw: string | null | undefined): WatchlistPriority | null {
  return lookup(PRIORITY_ALIASES, raw);
}

export function normalizeWatchlistAction(raw: string | null | undefined): WatchlistAction | null {
  const direct = lookup(WATCHLIST_ACTION_ALIASES, raw);
  if (direct) return direct;
  const key = normalizeKey(raw);
  if (!key) return null;
  if (/\bbuy\b.*\bsuggest/.test(key)) return "BUY_SUGGESTED";
  if (/\bearly entry\b/.test(key)) return "EARLY_ENTRY";
  if (/\bdemot/.test(key)) return "DEMOTED";
  if (/\bdrop/.test(key)) return "DROPPED";
  return null;
}

export function normalizeDecisionType(raw: string | null | undefined): DecisionType | null {
  return lookup(DECISION_TYPE_ALIASES, raw);
}

export function normalizeDecisionReviewStatus(
  raw: string | null | undefined,
): DecisionReviewStatus | null {
  return lookup(DECISION_REVIEW_STATUS_ALIASES, raw);
}

export function normalizeDecisionVerdict(raw: string | null | undefined): DecisionVerdict | null {
  return lookup(DECISION_VERDICT_ALIASES, raw);
}

export function normalizeDecisionSignalQuality(
  raw: string | null | undefined,
): DecisionSignalQuality | null {
  return lookup(DECISION_SIGNAL_QUALITY_ALIASES, raw);
}

export function normalizeDecisionPositionContext(
  raw: string | null | undefined,
): DecisionPositionContext | null {
  return lookup(DECISION_POSITION_CONTEXT_ALIASES, raw);
}

export function normalizeAnalystRating(raw: string | null | undefined): AnalystRating | null {
  return lookup(ANALYST_RATING_ALIASES, raw);
}

export function normalizeMarketCapBucket(raw: string | null | undefined): MarketCapBucket | null {
  return lookup(MARKET_CAP_ALIASES, raw);
}

export function normalizeSleeve(raw: string | null | undefined): Sleeve | null {
  return lookup(SLEEVE_ALIASES, raw);
}

export function normalizeTrendStage(raw: string | null | undefined): TrendStage | null {
  return lookup(TREND_STAGE_ALIASES, raw);
}

export function normalizeTrendVerdict(raw: string | null | undefined): TrendVerdict | null {
  return lookup(TREND_VERDICT_ALIASES, raw);
}

export function normalizeWeekMomentum(raw: string | null | undefined): WeekMomentum | null {
  return lookup(WEEK_MOMENTUM_ALIASES, raw);
}

export function normalizeDiscoveredVia(raw: string | null | undefined): DiscoveredVia | null {
  return lookup(DISCOVERED_VIA_ALIASES, raw);
}

export function normalizeTradeType(raw: string | null | undefined): TradeType | null {
  return lookup(TRADE_TYPE_ALIASES, raw);
}

export function normalizeTradeStatus(raw: string | null | undefined): TradeStatus | null {
  return lookup(TRADE_STATUS_ALIASES, raw);
}

export function normalizeIdeaStatus(raw: string | null | undefined): IdeaStatus | null {
  return lookup(IDEA_STATUS_ALIASES, raw);
}

export function normalizeIdeaStage(raw: string | null | undefined): IdeaStage | null {
  return lookup(IDEA_STAGE_ALIASES, raw);
}

export function normalizeTheme(raw: string | null | undefined): Theme | null {
  const direct = lookup(THEME_ALIASES, raw);
  if (direct) return direct;

  // Keyword fallback for long Idea/Trend titles that never matched an exact alias.
  const key = normalizeKey(raw);
  if (!key) return null;
  if (/\bnuclear\b|\bhaleu\b|\benrichment\b/.test(key)) return "NUCLEAR_POWER";
  if (/\bquantum\b/.test(key)) return "QUANTUM";
  if (/\bmaritime\b|\bshipbuilding\b|\bnaval\b|\bships act\b/.test(key)) {
    return "MARITIME_SHIPBUILDING";
  }
  if (/\bprediction market|\bevent.?contract\b/.test(key)) return "PREDICTION_MARKETS";
  if (/\brare earth|\bcritical mineral|\bantimony|\btungsten|\bmetallization\b|\brealloys\b/.test(key)) {
    return "CRITICAL_MINERALS";
  }
  if (/\bpsychedelic|\bglp-?\s*1\b|\bbiotech|\bcardiometabolic|\bpcsk9\b/.test(key)) {
    return "BIOTECH_GLP1";
  }
  if (
    !/\bnuclear\b/.test(key) &&
    /\bgrid equipment|\belectrification|\bcommodit|\benergy \/ power infrastructure|\benergy \/ commodities\b/.test(
      key,
    )
  ) {
    return "ENERGY_COMMODITIES";
  }
  if (/\bmacro\b|\bsector rotation\b|\btrade policy\b/.test(key)) return "MACRO";
  if (/\bhumanoid\b/.test(key)) return "HUMANOID_ROBOTS";
  if (/\bspacex\b|\bsatellite\b|\bcommercial launch\b/.test(key)) return "SPACE";
  if (/\bdron\b|\bdefense\b|\blaser air defense\b/.test(key)) return "DEFENSE_DRONES";
  if (/\bstablecoin\b|\bfintech\b|\bbrokerage\b/.test(key)) return "FINTECH_PAYMENTS";
  if (/\bcrypto\b|\bdigital asset\b/.test(key)) return "CRYPTO";
  if (/\bai infrastructure\b|\bsemiconductor\b|\bneocloud\b|\bcybersecurity\b|\binterconnect\b|\bmass storage\b|\bcustom silicon\b|\binp optical\b|\bhbm\b|\bd ram\b|\bai memory\b/.test(key)) {
    return "AI_INFRASTRUCTURE";
  }
  if (/\bhealthcare\b|\bmanaged care\b/.test(key)) return "HEALTHCARE";
  if (/\btrump accounts\b|\bretail-account\b/.test(key)) return "FINTECH_PAYMENTS";
  // Lone tickers with no sector prose — leave null (agent sets theme on write).
  return null;
}
