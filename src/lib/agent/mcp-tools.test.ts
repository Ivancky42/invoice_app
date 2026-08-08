import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAgentMcpTools } from "@/lib/agent/mcp-tools";

/**
 * Checked-in snapshot of every MCP tool exposed to routines.
 * Adding or renaming a tool must be a conscious edit here — the surface Ivan's agents
 * can reach is security-relevant, not an implementation detail.
 */
const EXPECTED_TOOL_NAMES = [
  "add_evidence",
  "append_page_notes",
  "apply_gap_fix",
  "delete_watchlist",
  "get_config",
  "get_context",
  "get_document",
  "get_kernel",
  "get_page_notes",
  "get_price_history",
  "get_prompt",
  "get_rule_version",
  "get_shadow_fitness",
  "list_counterfactuals",
  "list_daily_logs",
  "list_decision_reviews",
  "list_evolution_log",
  "list_ideas",
  "list_portfolio",
  "list_reports",
  "list_rule_versions",
  "list_shadow_orders",
  "list_shadow_positions",
  "list_trades",
  "list_trends",
  "list_watchlist",
  "log_trade",
  "patch_portfolio",
  "propose_rule_change",
  "score_rule_version",
  "sync_tracked_tickers",
  "upsert_daily_log",
  "upsert_decision_review",
  "upsert_document",
  "upsert_idea",
  "upsert_report",
  "upsert_trend",
  "upsert_watchlist",
];

function collectToolNames(): string[] {
  const names: string[] = [];
  const stub = {
    registerTool(name: string) {
      names.push(name);
    },
  } as unknown as McpServer;
  registerAgentMcpTools(stub);
  return names.sort();
}

describe("MCP tool surface", () => {
  it("matches the checked-in snapshot exactly", () => {
    expect(collectToolNames()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("registers no execution-capable tool name", () => {
    for (const name of collectToolNames()) {
      expect(name).not.toMatch(/execute|broker|place/i);
      // "order" is only ever allowed on a read tool (the paper shadow ledger's
      // simulated orders). A tool that could CREATE an order must not exist.
      if (/order/i.test(name)) {
        expect(name).toMatch(/^(list|get)_/);
      }
    }
  });

  it("exposes no tool that can promote, activate or revert a rule version", () => {
    // Promotion is cron-only (`evolution_evaluate`); reversion is a kernel rule. A tool
    // that let the proposer crown its own candidate would remove the selection pressure.
    for (const name of collectToolNames()) {
      expect(name).not.toMatch(/promote|activate|revert|kill_/i);
    }
  });

  it("registers each tool exactly once", () => {
    const names = collectToolNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
