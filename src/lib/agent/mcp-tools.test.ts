import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerAgentMcpTools } from "@/lib/agent/mcp-tools";
import { INVOICE_TOOL_NAMES, registerInvoiceMcpTools } from "@/lib/agent/mcp-invoice-tools";

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
  "list_rule_sections",
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
  // Invoicing (src/lib/agent/mcp-invoice-tools.ts) — mcp:tools scope only.
  "convert_invoice",
  "create_invoice",
  "create_recurring_from_invoice",
  "create_recurring_invoice",
  "delete_invoice",
  "delete_recurring_invoice",
  "duplicate_invoice",
  "get_billing_report",
  "get_billing_summary",
  "get_invoice",
  "get_invoice_pdf",
  "get_recurring_invoice",
  "list_company_profiles",
  "list_invoice_clients",
  "list_invoices",
  "list_recurring_invoices",
  "preview_invoice_email",
  "run_recurring_invoices",
  "send_invoice_email",
  "set_invoice_status",
  "update_invoice",
  "update_recurring_invoice",
  "upsert_company_profile",
  "upsert_invoice_client",
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

describe("invoice MCP tools", () => {
  type Handler = (args: unknown, extra: unknown) => Promise<{ isError?: boolean; content: { text?: string }[] }>;
  type Config = { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };

  function collect() {
    const tools = new Map<string, { config: Config; handler: Handler }>();
    const stub = {
      registerTool(name: string, config: Config, handler: Handler) {
        tools.set(name, { config, handler });
      },
    } as unknown as McpServer;
    registerInvoiceMcpTools(stub);
    return tools;
  }

  it("exports a name list matching what it registers", () => {
    expect([...collect().keys()].sort()).toEqual([...INVOICE_TOOL_NAMES].sort());
  });

  it("refuses every invoice tool on a shadow-only connector before touching the database", async () => {
    for (const [name, { handler }] of collect()) {
      const res = await handler({}, { http: { authInfo: { scopes: ["mcp:shadow"] } } });
      expect(res.isError, name).toBe(true);
      expect(res.content[0].text, name).toContain("invoice_scope_forbidden");
    }
  });

  it("marks deletes destructive and reads read-only", () => {
    const tools = collect();
    for (const [name, { config }] of tools) {
      if (name.startsWith("delete_")) expect(config.annotations?.destructiveHint, name).toBe(true);
      if (/^(list|get|preview)_/.test(name)) expect(config.annotations?.readOnlyHint, name).toBe(true);
      else expect(config.annotations?.readOnlyHint, name).toBe(false);
    }
  });

  it("requires confirm=true to delete", async () => {
    const res = await collect().get("delete_invoice")!.handler({ id: "INV-1" }, { http: { authInfo: { scopes: ["mcp:tools"] } } });
    expect(res.isError).toBe(true);
  });
});
