import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildAgentContext,
  getAllConfig,
  getPromptMarkdown,
  isAgentRoutine,
  isPromptName,
  listDailyLogItems,
  listIdeaItems,
  listPortfolioPositions,
  listStockReportItems,
  listTradeItems,
  listTrendItems,
  listWatchlistItems,
  PROMPT_NAMES,
  AGENT_ROUTINES,
} from "@/lib/agent/context";
import { logTrade } from "@/lib/agent/logTrade";
import {
  dailyLogInputSchema,
  getContentPageInputSchema,
  listDailyLogsQuerySchema,
  listDecisionReviewsQuerySchema,
  listReportsQuerySchema,
  logTradeInputSchema,
  patchPortfolioInputSchema,
  appendPageNotesInputSchema,
  stockReportInputSchema,
  upsertContentPageInputSchema,
  upsertDecisionReviewInputSchema,
  upsertIdeaFieldsSchema,
  upsertIdeaInputSchema,
  upsertTrendInputSchema,
  upsertWatchlistInputSchema,
  validationFailure,
} from "@/lib/agent/schemas";
import {
  appendPageNotes,
  deleteWatchlist,
  getContentPage,
  listDecisionReviews,
  patchPortfolio,
  syncTrackedTickersFromDb,
  upsertContentPage,
  upsertDailyLog,
  upsertDecisionReview,
  upsertIdea,
  upsertStockReport,
  upsertTrend,
  upsertWatchlist,
} from "@/lib/agent/writes";

function textJson(data: unknown) {
  // Compact JSON — pretty-print bloated get_context ~25% and can stall MCP bridges.
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function textError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function parseTool<T>(schema: z.ZodType<T>, args: unknown): T | { __error: string } {
  const parsed = schema.safeParse(args);
  if (parsed.success) return parsed.data;
  const failure = validationFailure(parsed.error);
  return {
    __error: JSON.stringify(failure),
  };
}

/** Register Stock HQ read MCP tools. */
export function registerAgentMcpReadTools(server: McpServer): void {
  server.registerTool(
    "get_context",
    {
      title: "Get agent context",
      description:
        "Bundle portfolio state, watchlist, trends, ideas, limits, enums, and rulesVersion for a routine.",
      inputSchema: {
        routine: z.enum(AGENT_ROUTINES).describe("Which Cowork routine is running"),
      },
    },
    async ({ routine }) => {
      if (!isAgentRoutine(routine)) {
        return textError(`Invalid routine. Allowed: ${AGENT_ROUTINES.join(", ")}`);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const ctx = await Promise.race([
          buildAgentContext(routine),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("context_timeout")), 20_000);
          }),
        ]);
        return textJson(ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : "context_failed";
        if (message === "context_timeout") {
          return textError(
            "get_context exceeded 20s — retry; if persistent, check Neon compute / pool",
          );
        }
        console.error("[mcp get_context]", message);
        return textError("Failed to build agent context");
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  );

  server.registerTool(
    "get_prompt",
    {
      title: "Get prompt markdown",
      description: "Read a committed prompt file from /prompts (read-only).",
      inputSchema: {
        name: z.enum(PROMPT_NAMES).describe("Prompt basename without .md"),
      },
    },
    async ({ name }) => {
      if (!isPromptName(name)) {
        return textError(`Invalid prompt name. Allowed: ${PROMPT_NAMES.join(", ")}`);
      }
      try {
        const markdown = await getPromptMarkdown(name);
        return {
          content: [{ type: "text" as const, text: markdown }],
        };
      } catch {
        return textError(`Prompt not found: ${name}`);
      }
    },
  );


  server.registerTool(
    "list_portfolio",
    {
      title: "List portfolio",
      description: "List current portfolio positions with weightPct and averageDownsUsed.",
      inputSchema: {},
    },
    async () => textJson(await listPortfolioPositions()),
  );

  server.registerTool(
    "list_watchlist",
    {
      title: "List watchlist",
      description:
        "List watchlist rows. Excludes DEMOTED/DROPPED by default; pass includeDemoted=true to include soft-demoted names.",
      inputSchema: {
        includeDemoted: z
          .boolean()
          .optional()
          .describe("Include DEMOTED/DROPPED rows (default false)"),
      },
    },
    async ({ includeDemoted }) =>
      textJson(await listWatchlistItems({ includeDemoted: includeDemoted === true })),
  );

  server.registerTool(
    "list_decision_reviews",
    {
      title: "List decision reviews",
      description:
        "List Decision Review Log rows (filter by ticker, reviewStatus, or pendingDueWithinDays).",
      inputSchema: listDecisionReviewsQuerySchema.shape,
    },
    async (args) => {
      const parsed = parseTool(listDecisionReviewsQuerySchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson(await listDecisionReviews(parsed));
    },
  );

  server.registerTool(
    "list_daily_logs",
    {
      title: "List daily logs",
      description:
        "List DailyLog rows (newest first). Optional since/until YYYY-MM-DD; default limit 14 (max 90).",
      inputSchema: listDailyLogsQuerySchema.shape,
    },
    async (args) => {
      const parsed = parseTool(listDailyLogsQuerySchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson(await listDailyLogItems(parsed));
    },
  );

  server.registerTool(
    "list_reports",
    {
      title: "List stock reports",
      description:
        "List StockReport rows (WEEKLY/MONTHLY). Optional reportType, since/until; default limit 8 (max 36).",
      inputSchema: listReportsQuerySchema.shape,
    },
    async (args) => {
      const parsed = parseTool(listReportsQuerySchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson(await listStockReportItems(parsed));
    },
  );

  server.registerTool(
    "get_document",
    {
      title: "Get content document",
      description:
        "Read Strategy Lessons Summary or Investment Style Profile (Neon ContentPage, ReportBlock[] body).",
      inputSchema: getContentPageInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(getContentPageInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await getContentPage(parsed.key);
      if (!result.ok) return { ...textJson(result), isError: true as const };
      return textJson(result);
    },
  );

  server.registerTool(
    "list_trades",
    {
      title: "List trades",
      description: "List trade log rows.",
      inputSchema: {},
    },
    async () => textJson(await listTradeItems()),
  );

  server.registerTool(
    "list_ideas",
    {
      title: "List ideas",
      description: "List ideas funnel rows including ideaStage, leadTicker, graduation fields.",
      inputSchema: {},
    },
    async () => textJson(await listIdeaItems()),
  );

  server.registerTool(
    "list_trends",
    {
      title: "List trends",
      description: "List trends including score components.",
      inputSchema: {},
    },
    async () => textJson(await listTrendItems(true)),
  );

  server.registerTool(
    "get_config",
    {
      title: "Get config",
      description: "Return all Config key/value pairs (read-only).",
      inputSchema: {},
    },
    async () => textJson(await getAllConfig()),
  );
}

/** Register Stock HQ write MCP tools (Phase 4c). */
export function registerAgentMcpWriteTools(server: McpServer): void {
  server.registerTool(
    "log_trade",
    {
      title: "Log trade",
      description:
        "Log a trade with idempotencyKey; reconciles Portfolio.shares, avg cost, and Config cash in one transaction. Hard caps → conflict (do not retry). Soft tier-band mismatches → warnings[]. Never writes prices.",
      inputSchema: logTradeInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(logTradeInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await logTrade(parsed);
      if (!result.ok) {
        return {
          ...textJson(result),
          isError: true as const,
        };
      }
      return textJson(result);
    },
  );

  server.registerTool(
    "upsert_daily_log",
    {
      title: "Upsert daily log",
      description: "Upsert DailyLog on logDate (YYYY-MM-DD). Narrative fields are ReportBlock[].",
      inputSchema: dailyLogInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(dailyLogInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson({ ok: true, dailyLog: await upsertDailyLog(parsed) });
    },
  );

  server.registerTool(
    "upsert_report",
    {
      title: "Upsert stock report",
      description: "Upsert StockReport on (reportType, reportDate). content is ReportBlock[].",
      inputSchema: stockReportInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(stockReportInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson({ ok: true, report: await upsertStockReport(parsed) });
    },
  );

  server.registerTool(
    "patch_portfolio",
    {
      title: "Patch portfolio",
      description:
        "Patch portfolio metadata (action, stopLoss, sleeve, conviction, thesis/pageNotes, entryZone, addZone, nextAddTrigger, keyRisk, theme, riskLevel, marketCapBucket, analystRating, analystTarget, beatRate, impliedMove, earningsDate). Writing analystTarget recomputes upsidePct from stored currentPrice. Does NOT write currentPrice/shares/avg/upsidePct/socialScore. For append-only daily notes use append_page_notes.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker symbol"),
        ...patchPortfolioInputSchema.shape,
      },
    },
    async (args) => {
      const { ticker, ...rest } = args as { ticker: string } & Record<string, unknown>;
      const parsed = parseTool(patchPortfolioInputSchema, rest);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await patchPortfolio(ticker, parsed);
      if (!result.ok) {
        return { ...textJson(result), isError: true as const };
      }
      return textJson(result);
    },
  );

  server.registerTool(
    "upsert_watchlist",
    {
      title: "Upsert watchlist",
      description:
        "Upsert a watchlist row by ticker. May set analystTarget/bullTarget/stopLoss/entryZone/earningsDate; writing analystTarget recomputes upsidePct. Does not write currentPrice or upsidePct directly.",
      inputSchema: upsertWatchlistInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(upsertWatchlistInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson({ ok: true, watchlist: await upsertWatchlist(parsed) });
    },
  );

  server.registerTool(
    "append_page_notes",
    {
      title: "Append page notes",
      description:
        "Append ReportBlock[] to portfolio or watchlist pageNotes (append-only ticker-note rule). Prefer this over patch_portfolio pageNotes replace.",
      inputSchema: appendPageNotesInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(appendPageNotesInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await appendPageNotes(parsed);
      if (!result.ok) return { ...textJson(result), isError: true as const };
      return textJson(result);
    },
  );

  server.registerTool(
    "upsert_decision_review",
    {
      title: "Upsert decision review",
      description:
        "Create/update a Decision Review Log row. Supply idempotencyKey to safely retry. Defaults reviewStatus to PENDING.",
      inputSchema: upsertDecisionReviewInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(upsertDecisionReviewInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson(await upsertDecisionReview(parsed));
    },
  );

  server.registerTool(
    "upsert_document",
    {
      title: "Upsert content document",
      description:
        "Replace Strategy Lessons Summary or Investment Style Profile body (ReportBlock[]).",
      inputSchema: upsertContentPageInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(upsertContentPageInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson({ ok: true, document: await upsertContentPage(parsed) });
    },
  );

  server.registerTool(
    "delete_watchlist",
    {
      title: "Demote or delete watchlist",
      description:
        "Soft-demote by default (sets action=DEMOTED, keeps the row — Cowork §6). Pass hard=true to permanently delete.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker to demote/remove"),
        hard: z
          .boolean()
          .optional()
          .describe("If true, hard-delete the row (rare; prefer soft demote)"),
        action: z
          .enum(["DEMOTED", "DROPPED"])
          .optional()
          .describe("Soft-demote action (default DEMOTED)"),
      },
    },
    async ({ ticker, hard, action }) => {
      const result = await deleteWatchlist(ticker, {
        hard: hard === true,
        action: action === "DROPPED" ? "DROPPED" : "DEMOTED",
      });
      if (!result.ok) {
        return { ...textJson(result), isError: true as const };
      }
      return textJson(result);
    },
  );

  server.registerTool(
    "sync_tracked_tickers",
    {
      title: "Sync tracked tickers",
      description:
        "Rebuild Config TRACKED_TICKERS from Portfolio + active Watchlist (excludes DEMOTED/DROPPED). Prefer this over patch_config for ticker list hygiene.",
      inputSchema: {},
    },
    async () => textJson(await syncTrackedTickersFromDb()),
  );

  server.registerTool(
    "upsert_trend",
    {
      title: "Upsert trend",
      description: "Upsert a trend by trendName.",
      inputSchema: upsertTrendInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(upsertTrendInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson({ ok: true, trend: await upsertTrend(parsed) });
    },
  );

  server.registerTool(
    "upsert_idea",
    {
      title: "Upsert idea",
      description: "Upsert an idea by stockSector or leadTicker. Does not write prices.",
      inputSchema: upsertIdeaFieldsSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(upsertIdeaInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson({ ok: true, idea: await upsertIdea(parsed) });
    },
  );

  // patch_config intentionally NOT registered on MCP — routines must not rewrite LIMITS.
  // Ivan ops: PATCH /api/agent/config with Bearer AGENT_TOKEN.
}

/** Register all Stock HQ MCP tools (reads + writes). */
export function registerAgentMcpTools(server: McpServer): void {
  registerAgentMcpReadTools(server);
  registerAgentMcpWriteTools(server);
}
