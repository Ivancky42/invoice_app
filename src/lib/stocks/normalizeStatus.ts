import type {
  AnalystRating,
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
  return lookup(THEME_ALIASES, raw);
}
