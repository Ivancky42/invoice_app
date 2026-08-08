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
  listPriceHistoryItems,
  listStockReportItems,
  listTradeItems,
  listTrendItems,
  listWatchlistItems,
  PROMPT_NAMES,
  AGENT_ROUTINES,
} from "@/lib/agent/context";
import { logTrade } from "@/lib/agent/logTrade";
import {
  canWriteRealBook,
  isShadowOnlyScope,
  realBookWriteBlockedError,
  shadowScopeLiveBranchError,
} from "@/lib/agent/mcp-scope";
import { getShadowFitness, listCounterfactuals } from "@/lib/fitness/read";
import { applyGapFix } from "@/lib/evolution/gapfix";
import { listEvolutionEvents } from "@/lib/evolution/log";
import { proposeRuleChange } from "@/lib/evolution/propose";
import { getKernel, getRuleVersion, listRuleVersions } from "@/lib/evolution/read";
import { scoreRuleVersion } from "@/lib/evolution/scoring";
import { listShadowOrders, listShadowPositions } from "@/lib/shadow/read";
import {
  dailyLogInputSchema,
  getContentPageInputSchema,
  getPriceHistoryInputSchema,
  getShadowFitnessInputSchema,
  listCounterfactualsInputSchema,
  listDailyLogsQuerySchema,
  listDecisionReviewsQuerySchema,
  listReportsQuerySchema,
  listShadowOrdersInputSchema,
  listShadowPositionsInputSchema,
  logTradeInputSchema,
  patchPortfolioInputSchema,
  appendPageNotesInputSchema,
  addEvidenceFieldsSchema,
  addEvidenceInputSchema,
  applyGapFixInputSchema,
  getRuleVersionInputSchema,
  listEvolutionLogInputSchema,
  listRuleVersionsInputSchema,
  proposeRuleChangeFieldsSchema,
  proposeRuleChangeInputSchema,
  scoreRuleVersionInputSchema,
  getPageNotesInputSchema,
  stockReportInputSchema,
  upsertContentPageInputSchema,
  upsertDecisionReviewInputSchema,
  upsertIdeaFieldsSchema,
  upsertIdeaInputSchema,
  upsertTrendInputSchema,
  upsertWatchlistInputSchema,
  realBookBranchGuard,
  validationFailure,
} from "@/lib/agent/schemas";
import {
  addEvidence,
  appendPageNotes,
  deleteWatchlist,
  getContentPage,
  getPageNotes,
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

type ToolExtra = { authInfo?: { scopes?: string[] } };

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

function toolScopes(extra: ToolExtra | undefined): string[] | undefined {
  return extra?.authInfo?.scopes;
}

/**
 * Block real-book / evolution writes for mcp:shadow connectors.
 * Fail closed when scopes are present but do not include mcp:tools.
 */
function denyRealBookWrite(extra: ToolExtra | undefined) {
  if (canWriteRealBook(toolScopes(extra))) return null;
  return textError(JSON.stringify(realBookWriteBlockedError()));
}

/**
 * Shadow connectors must address CANDIDATE. LIVE is refused; omitted branch becomes
 * CANDIDATE.
 */
function forceShadowBranch<T extends { branch?: "LIVE" | "CANDIDATE" }>(
  input: T,
  extra: ToolExtra | undefined,
): T | { __error: string } {
  if (!isShadowOnlyScope(toolScopes(extra))) return input;
  if (input.branch === "LIVE") {
    return { __error: JSON.stringify(shadowScopeLiveBranchError()) };
  }
  return { ...input, branch: "CANDIDATE" };
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
        branch: z
          .enum(["LIVE", "CANDIDATE"])
          .optional()
          .describe("Ruleset branch (default LIVE); CANDIDATE is shadow-only"),
      },
    },
    async ({ routine, branch }, extra) => {
      if (!isAgentRoutine(routine)) {
        return textError(`Invalid routine. Allowed: ${AGENT_ROUTINES.join(", ")}`);
      }
      const branched = forceShadowBranch({ branch }, extra);
      if ("__error" in branched) return textError(branched.__error);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const ctx = await Promise.race([
          buildAgentContext(routine, branched.branch ?? "LIVE"),
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
      description:
        "Read a prompt from the active ruleset (falls back to the committed /prompts file). Read-only.",
      inputSchema: {
        name: z.enum(PROMPT_NAMES).describe("Prompt basename without .md"),
        branch: z
          .enum(["LIVE", "CANDIDATE"])
          .optional()
          .describe("Ruleset branch (default LIVE); CANDIDATE is shadow-only"),
      },
    },
    async ({ name, branch }, extra) => {
      if (!isPromptName(name)) {
        return textError(`Invalid prompt name. Allowed: ${PROMPT_NAMES.join(", ")}`);
      }
      const branched = forceShadowBranch({ branch }, extra);
      if ("__error" in branched) return textError(branched.__error);
      try {
        const markdown = await getPromptMarkdown(name, branched.branch ?? "LIVE");
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
      description: "List current portfolio positions with weightPct, averageDownsUsed, lastPriceUpdate, priceStatus. pageNotes are truncated to newest ~3 blocks (see pageNotesTruncated / get_page_notes).",
      inputSchema: {},
    },
    async () => textJson(await listPortfolioPositions()),
  );

  server.registerTool(
    "list_watchlist",
    {
      title: "List watchlist",
      description:
        "List watchlist rows with lastPriceUpdate and priceStatus. Excludes DEMOTED/DROPPED by default; pass includeDemoted=true to include soft-demoted names. pageNotes truncated to newest ~3 (use get_page_notes for history).",
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
        "List Decision Review Log rows (filter by ticker, reviewStatus, branch LIVE|CANDIDATE, or pendingDueWithinDays).",
      inputSchema: listDecisionReviewsQuerySchema.shape,
    },
    async (args, extra) => {
      const parsed = parseTool(listDecisionReviewsQuerySchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      return textJson(await listDecisionReviews(branched));
    },
  );

  server.registerTool(
    "list_daily_logs",
    {
      title: "List daily logs",
      description:
        "List DailyLog rows (newest first). Optional since/until YYYY-MM-DD and routineType (DAILY|EARNINGS); default limit 14 (max 90).",
      inputSchema: listDailyLogsQuerySchema.shape,
    },
    async (args, extra) => {
      const parsed = parseTool(listDailyLogsQuerySchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      return textJson(await listDailyLogItems(branched));
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
    async (args, extra) => {
      const parsed = parseTool(listReportsQuerySchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      return textJson(await listStockReportItems(branched));
    },
  );

  server.registerTool(
    "get_price_history",
    {
      title: "Get daily price history",
      description:
        "List PriceHistory daily OHLC bars for one ticker, newest first. Optional from/to YYYY-MM-DD; default limit 120 (max 500).",
      inputSchema: getPriceHistoryInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(getPriceHistoryInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson(await listPriceHistoryItems(parsed));
    },
  );

  server.registerTool(
    "get_document",
    {
      title: "Get content document",
      description:
        "Read Strategy Lessons Summary or Investment Style Profile (Neon ContentPage, ReportBlock[] body). Missing rows are auto-seeded as stubs — never 404 for these keys.",
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

  server.registerTool(
    "list_shadow_positions",
    {
      title: "List shadow positions",
      description:
        "List PAPER positions in a shadow branch's ledger (default LIVE). Open only unless includeClosed=true. Paper accounting — never the real portfolio.",
      inputSchema: listShadowPositionsInputSchema.shape,
    },
    async (args, extra) => {
      const parsed = parseTool(listShadowPositionsInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      return textJson(await listShadowPositions(branched));
    },
  );

  server.registerTool(
    "list_shadow_orders",
    {
      title: "List shadow orders",
      description:
        "List PAPER orders in a shadow branch's ledger (default LIVE), newest decision first. Optional status filter; default limit 50 (max 200). These are simulated fills, never broker orders.",
      inputSchema: listShadowOrdersInputSchema.shape,
    },
    async (args, extra) => {
      const parsed = parseTool(listShadowOrdersInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      return textJson(await listShadowOrders(branched));
    },
  );

  server.registerTool(
    "get_shadow_fitness",
    {
      title: "Get shadow fitness",
      description:
        "Daily fitness snapshots for a shadow branch (default LIVE), newest session first. All values are FRACTIONS (0.03 = 3%). avoidedCreditDelta is SIGNED: refusing a name that fell credits, refusing one that rose debits. turnoverDelta is fill-friction only (0 on hold days). maxDrawdown is rolling 30-session peak-to-trough, not lifetime HWM. Default limit 30 (max 90).",
      inputSchema: getShadowFitnessInputSchema.shape,
    },
    async (args, extra) => {
      const parsed = parseTool(getShadowFitnessInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      return textJson(await getShadowFitness(branched));
    },
  );

  server.registerTool(
    "list_counterfactuals",
    {
      title: "List counterfactuals",
      description:
        "List what NOT-taken decisions (AVOID / WAIT / DO_NOT_AVERAGE_DOWN) would have been worth for a shadow branch (default LIVE), newest decision first. Rows exist at dual horizons (21 interim for loop speed, 63 full-quarter residual). `credit` is SIGNED and in NAV fractions. Optional status filter; default limit 50 (max 200).",
      inputSchema: listCounterfactualsInputSchema.shape,
    },
    async (args, extra) => {
      const parsed = parseTool(listCounterfactualsInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      return textJson(await listCounterfactuals(branched));
    },
  );

  server.registerTool(
    "list_evolution_log",
    {
      title: "List evolution log",
      description:
        "Read the APPEND-ONLY evolution audit log (proposals, rejections, kernel attempts, promotions, kills, scores), newest first. Rejections are logged too — read them before re-proposing. Default limit 50 (max 200).",
      inputSchema: listEvolutionLogInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(listEvolutionLogInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson(await listEvolutionEvents(parsed));
    },
  );

  server.registerTool(
    "get_rule_version",
    {
      title: "Get rule version",
      description:
        "Metadata for one RuleVersion: status, lane, limits, changedPaths, direction/scope, reasoningPattern, outcome. Never returns prompt text — use get_prompt for the ruleset you are running.",
      inputSchema: getRuleVersionInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(getRuleVersionInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await getRuleVersion(parsed.id);
      if (!result.ok) return { ...textJson(result), isError: true as const };
      return textJson(result);
    },
  );

  server.registerTool(
    "list_rule_versions",
    {
      title: "List rule versions",
      description:
        "List RuleVersion metadata (newest first), optionally filtered by status. Metadata only — never prompt text. Default limit 20 (max 100).",
      inputSchema: listRuleVersionsInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(listRuleVersionsInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson(await listRuleVersions(parsed));
    },
  );

  server.registerTool(
    "get_kernel",
    {
      title: "Get kernel clauses",
      description:
        "The pinned kernel clauses (id + sha256 + canonical text) from the deployed bundle. Read this BEFORE proposing: any change that edits a line inside a kernel fence is rejected and logged as a KERNEL_ATTEMPT.",
      inputSchema: {},
    },
    async () => textJson(getKernel()),
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
    async (args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
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
      description:
        "Upsert DailyLog on (logDate, routineType). Default routineType=DAILY; Earnings must pass EARNINGS so the two do not overwrite each other. Narrative fields are ReportBlock[].",
      inputSchema: dailyLogInputSchema.shape,
    },
    async (args, extra) => {
      const parsed = parseTool(dailyLogInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      return textJson({ ok: true, dailyLog: await upsertDailyLog(branched) });
    },
  );

  server.registerTool(
    "upsert_report",
    {
      title: "Upsert stock report",
      description: "Upsert StockReport on (reportType, reportDate). content is ReportBlock[].",
      inputSchema: stockReportInputSchema.shape,
    },
    async (args, extra) => {
      const parsed = parseTool(stockReportInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      return textJson({ ok: true, report: await upsertStockReport(branched) });
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
    async (args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
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
    async (args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
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
        "Append ReportBlock[] to portfolio or watchlist pageNotes (append-only). Response returns only the newest ~3 blocks plus totals — use get_page_notes for older history.",
      inputSchema: appendPageNotesInputSchema.shape,
    },
    async (args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
      const parsed = parseTool(appendPageNotesInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await appendPageNotes(parsed);
      if (!result.ok) return { ...textJson(result), isError: true as const };
      return textJson(result);
    },
  );

  server.registerTool(
    "get_page_notes",
    {
      title: "Get page notes history",
      description:
        "Paginated pageNotes for one portfolio or watchlist ticker (newest first). Use when pageNotesTruncated=true on context/list responses. Default limit 20.",
      inputSchema: getPageNotesInputSchema.shape,
    },
    async (args) => {
      const parsed = parseTool(getPageNotesInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await getPageNotes(parsed);
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
    async (args, extra) => {
      const parsed = parseTool(upsertDecisionReviewInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      const result = await upsertDecisionReview(branched);
      if (!result.ok) {
        return { ...textJson(result), isError: true as const };
      }
      return textJson(result);
    },
  );

  server.registerTool(
    "add_evidence",
    {
      title: "Add evidence",
      description:
        "Append EvidenceItem rows to an existing Decision Review (by decisionReviewId or idempotencyKey, within branch — default LIVE). Additive — use upsert_decision_review's evidence[] to replace-on-replay instead. 404 when the DR is not found on that branch.",
      inputSchema: addEvidenceFieldsSchema.shape,
    },
    async (args, extra) => {
      const parsed = parseTool(addEvidenceInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const branched = forceShadowBranch(parsed, extra);
      if ("__error" in branched) return textError(branched.__error);
      const result = await addEvidence(branched);
      if (!result.ok) {
        return { ...textJson(result), isError: true as const };
      }
      return textJson(result);
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
    async (args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
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
        // Real-book write: LIVE only.
        branch: realBookBranchGuard,
      },
    },
    async ({ ticker, hard, action }, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
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
        "Rebuild Config TRACKED_TICKERS from Portfolio + active Watchlist. Includes rows with action=null; excludes only DEMOTED/DROPPED. Prefer this over patch_config for ticker list hygiene.",
      // Real-book write: LIVE only.
      inputSchema: { branch: realBookBranchGuard },
    },
    async (_args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
      return textJson(await syncTrackedTickersFromDb());
    },
  );

  server.registerTool(
    "upsert_trend",
    {
      title: "Upsert trend",
      description: "Upsert a trend by trendName.",
      inputSchema: upsertTrendInputSchema.shape,
    },
    async (args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
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
    async (args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
      const parsed = parseTool(upsertIdeaInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      return textJson({ ok: true, idea: await upsertIdea(parsed) });
    },
  );

  server.registerTool(
    "propose_rule_change",
    {
      title: "Propose rule change",
      description:
        "Propose a CANDIDATE ruleset (prose hunks and/or limits changes). The SERVER assigns the lane — any `lane` you pass is ignored and recorded. Requires cited scored decision reviews (≥3, ≥2 tickers, ≥2 ISO weeks, ≥1 wrong outcome), a falsifiable counterCase (≥40 chars) and a measurable successMetric. Kernel edits, drift-rail breaches and eligibility failures are rejected AND appended to the evolution log.",
      inputSchema: proposeRuleChangeFieldsSchema.shape,
    },
    async (args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
      const parsed = parseTool(proposeRuleChangeInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await proposeRuleChange(parsed);
      if (!result.ok) return { ...textJson(result), isError: true as const };
      return textJson(result);
    },
  );

  server.registerTool(
    "apply_gap_fix",
    {
      title: "Apply gap fix",
      description:
        "Immediately patch ONE section of the ACTIVE ruleset for a typo / contradiction / clarification (≤40 changed lines). expectedSectionSha is REQUIRED and a mismatch is a 409. Not a rule change: use propose_rule_change for anything that alters behaviour. An in-flight candidate is rebased, or killed if it touched the same section.",
      inputSchema: applyGapFixInputSchema.shape,
    },
    async (args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
      const parsed = parseTool(applyGapFixInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await applyGapFix(parsed);
      if (!result.ok) return { ...textJson(result), isError: true as const };
      return textJson(result);
    },
  );

  server.registerTool(
    "score_rule_version",
    {
      title: "Score rule version",
      description:
        "Compute the retrospective HELPED/NEUTRAL/HURT outcome of a RETIRED or KILLED rule version from the fitness ledger. `outcomeClaim` is recorded under outcomeDetail.agentClaim and logged, but NEVER used as the outcome — the server scores it. Below 10 paired sessions the call returns `preview: true, outcome: null` and writes NOTHING: the version stays unscored until its series is long enough.",
      inputSchema: scoreRuleVersionInputSchema.shape,
    },
    async (args, extra) => {
      const blocked = denyRealBookWrite(extra);
      if (blocked) return blocked;
      const parsed = parseTool(scoreRuleVersionInputSchema, args);
      if ("__error" in parsed) return textError(parsed.__error);
      const result = await scoreRuleVersion(parsed);
      if (!result.ok) return { ...textJson(result), isError: true as const };
      return textJson(result);
    },
  );

  // patch_config intentionally NOT registered on MCP — routines must not rewrite LIMITS.
  // Ivan ops: PATCH /api/agent/config with Bearer AGENT_TOKEN.
  //
  // Same precedent, same reason: promote / revert / activate are intentionally NOT
  // registered anywhere as agent tools. Promotion is cron-only (`evolution_evaluate`) and
  // reversion is a kernel rule — a proposer that could crown or spare its own candidate
  // would remove the only selection pressure in the system.
}

/** Register all Stock HQ MCP tools (reads + writes). */
export function registerAgentMcpTools(server: McpServer): void {
  registerAgentMcpReadTools(server);
  registerAgentMcpWriteTools(server);
}
