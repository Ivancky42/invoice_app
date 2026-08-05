import {
  AnalystRating,
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
  WatchlistPriority,
  WeekMomentum,
} from "@/generated/prisma/enums";

function valuesOf<T extends Record<string, string>>(obj: T): string[] {
  return Object.values(obj);
}

/** All stock-HQ Prisma enum values as string arrays (for agent context). */
export function listStockEnums(): Record<string, string[]> {
  return {
    PositionAction: valuesOf(PositionAction),
    RiskLevel: valuesOf(RiskLevel),
    WatchlistPriority: valuesOf(WatchlistPriority),
    AnalystRating: valuesOf(AnalystRating),
    MarketCapBucket: valuesOf(MarketCapBucket),
    Sleeve: valuesOf(Sleeve),
    TrendStage: valuesOf(TrendStage),
    TrendVerdict: valuesOf(TrendVerdict),
    WeekMomentum: valuesOf(WeekMomentum),
    DiscoveredVia: valuesOf(DiscoveredVia),
    TradeType: valuesOf(TradeType),
    TradeStatus: valuesOf(TradeStatus),
    IdeaStatus: valuesOf(IdeaStatus),
    IdeaStage: valuesOf(IdeaStage),
    Theme: valuesOf(Theme),
    StockReportType: valuesOf(StockReportType),
  };
}
