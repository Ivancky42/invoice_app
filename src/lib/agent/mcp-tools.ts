import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildAgentContext,
  getAllConfig,
  getPromptMarkdown,
  isAgentRoutine,
  isPromptName,
  listIdeaItems,
  listPortfolioPositions,
  listTradeItems,
  listTrendItems,
  listWatchlistItems,
  PROMPT_NAMES,
  AGENT_ROUTINES,
} from "@/lib/agent/context";
import { logTrade } from "@/lib/agent/logTrade";
import {
  dailyLogInputSchema,
  logTradeInputSchema,
  patchConfigFieldsSchema,
  patchConfigInputSchema,
  patchPortfolioInputSchema,
  stockReportInputSchema,
  upsertIdeaFieldsSchema,
  upsertIdeaInputSchema,
  upsertTrendInputSchema,
  upsertWatchlistInputSchema,
  validationFailure,
} from "@/lib/agent/schemas";
import {
  deleteWatchlist,
  patchConfig,
  patchPortfolio,
  upsertDailyLog,
  upsertIdea,
  upsertStockReport,
  upsertTrend,
  upsertWatchlist,
} from "@/lib/agent/writes";

function textJson(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
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
      const ctx = await buildAgentContext(routine);
      return textJson(ctx);
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
      description: "List watchlist rows.",
      inputSchema: {},
    },
    async () => textJson(await listWatchlistItems()),
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
        "Patch portfolio metadata (action, stopLoss, sleeve, conviction, thesis/pageNotes, entryZone, keyRisk, theme). Does NOT write currentPrice/shares/avg.",
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
      description: "Upsert a watchlist row by ticker. Does not write prices.",
      inputSchema: upsertWatchlistInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(upsertWatchlistInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson({ ok: true, watchlist: await upsertWatchlist(parsed) });
    },
  );

  server.registerTool(
    "delete_watchlist",
    {
      title: "Delete watchlist",
      description: "Delete a watchlist row by ticker.",
      inputSchema: {
        ticker: z.string().min(1).describe("Ticker to remove"),
      },
    },
    async ({ ticker }) => {
      const result = await deleteWatchlist(ticker);
      if (!result.ok) {
        return { ...textJson(result), isError: true as const };
      }
      return textJson(result);
    },
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

  server.registerTool(
    "patch_config",
    {
      title: "Patch config",
      description:
        "Patch safe Config keys: cash, FX, thresholds, tracked tickers, LIMITS. Never prompts. LIMITS changes hard caps.",
      inputSchema: patchConfigFieldsSchema.shape,
    },
    async (args: Record<string, unknown>) => {
      const parsed = parseTool(patchConfigInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await patchConfig(parsed);
      const config = await getAllConfig();
      return textJson({ ...result, config });
    },
  );
}

/** Register all Stock HQ MCP tools (reads + writes). */
export function registerAgentMcpTools(server: McpServer): void {
  registerAgentMcpReadTools(server);
  registerAgentMcpWriteTools(server);
}
