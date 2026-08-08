import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAgentMcpTools } from "@/lib/agent/mcp-tools";

/**
 * Checked-in snapshot of every MCP tool exposed to routines.
 * Adding or renaming a tool must be a conscious edit here — the surface Ivan's agents
 * can reach is security-relevant, not an implementation detail.
 */
const EXPECTED_TOOL_NAMES = [
  "append_page_notes",
  "delete_watchlist",
  "get_config",
  "get_context",
  "get_document",
  "get_page_notes",
  "get_price_history",
  "get_prompt",
  "get_shadow_fitness",
  "list_counterfactuals",
  "list_daily_logs",
  "list_decision_reviews",
  "list_ideas",
  "list_portfolio",
  "list_reports",
  "list_shadow_orders",
  "list_shadow_positions",
  "list_trades",
  "list_trends",
  "list_watchlist",
  "log_trade",
  "patch_portfolio",
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

  it("registers each tool exactly once", () => {
    const names = collectToolNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
