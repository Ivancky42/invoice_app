import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { describe, expect, it } from "vitest";
import { registerAgentMcpTools } from "@/lib/agent/mcp-tools";

/**
 * The real SDK server behind the real HTTP handler — no database needed for listing
 * tools or for calls the SDK rejects before a handler runs. Catches what the stub-based
 * tests in mcp-tools.test.ts cannot: a schema the SDK refuses to register or cannot turn
 * into JSON Schema (which breaks tools/list for every client), and the validation text an
 * agent sees.
 */
const handler = createMcpHandler((server) => registerAgentMcpTools(server), {
  serverInfo: { name: "test", version: "0.0.0" },
});

const PROTOCOL = "2025-11-25";
let nextId = 1;

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await handler(
    new Request("http://localhost/api/mcp/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
  const body = await res.text();
  // Streamable HTTP may answer as JSON or as a single SSE `data:` event.
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? body
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("")
    : body;
  return { status: res.status, message: JSON.parse(json) };
}

describe("MCP server (SDK v2 via mcp-handler)", () => {
  it("initializes", async () => {
    const { status, message } = await rpc("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "vitest", version: "0" },
    });
    expect(status).toBe(200);
    expect(message.result.serverInfo.name).toBe("test");
  });

  it("lists every tool with an object JSON Schema", async () => {
    const { message } = await rpc("tools/list");
    const tools = message.result.tools as { name: string; inputSchema: { type?: string } }[];
    expect(tools).toHaveLength(63);
    for (const tool of tools) expect(tool.inputSchema.type, tool.name).toBe("object");
    const createInvoice = tools.find((t) => t.name === "create_invoice") as unknown as {
      inputSchema: { properties: Record<string, { enum?: string[] }>; required?: string[] };
    };
    expect(createInvoice.inputSchema.properties.type.enum).toEqual(["QUOTATION", "INVOICE", "DELIVERY_ORDER"]);
    expect(createInvoice.inputSchema.required).toEqual(["items"]);
  });

  it("rejects a bad enum before the handler runs, naming the legal values", async () => {
    const { message } = await rpc("tools/call", {
      name: "create_invoice",
      arguments: { type: "RECEIPT", clientName: "X", items: [{ description: "a", quantity: 1, unitPrice: 1 }] },
    });
    expect(message.result.isError).toBe(true);
    const text: string = message.result.content[0].text;
    expect(text).toMatch(/^Input validation error: Invalid arguments for tool create_invoice: /);
    const failure = JSON.parse(text.slice(text.indexOf("{")));
    expect(failure).toMatchObject({
      error: "invalid enum value for type",
      field: "type",
      legalValues: ["QUOTATION", "INVOICE", "DELIVERY_ORDER"],
    });
  });

  it("keeps the real-book branch guard's named error", async () => {
    const { message } = await rpc("tools/call", {
      name: "sync_tracked_tickers",
      arguments: { branch: "CANDIDATE" },
    });
    expect(message.result.isError).toBe(true);
    expect(message.result.content[0].text).toContain("branch_not_allowed_on_real_book");
  });
});

/**
 * Scopes through the real auth wrapper, not a hand-built handler context: if mcp-handler or
 * the SDK ever passes authInfo somewhere else, a shadow connector must lose access (the
 * billing tools fail closed), not gain it.
 */
describe("MCP auth scopes end to end (withMcpAuth + createMcpHandler)", () => {
  const authed = withMcpAuth(
    handler,
    async (_req, token) =>
      token === "shadow"
        ? { token, clientId: "t", scopes: ["mcp:shadow"] }
        : token === "full"
          ? { token, clientId: "t", scopes: ["mcp:tools"] }
          : undefined,
    {
      required: true,
      requiredScopes: [],
      resourceMetadataPath: "/.well-known/oauth-protected-resource",
      resourceUrl: "http://localhost/api/mcp/mcp",
    },
  );

  async function callAs(token: string | null, name: string, args: Record<string, unknown>) {
    const res = await authed(
      new Request("http://localhost/api/mcp/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": PROTOCOL,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
      }),
    );
    if (res.status !== 200) return { status: res.status, text: "" };
    const body = await res.text();
    const json = res.headers.get("content-type")?.includes("text/event-stream")
      ? body.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("")
      : body;
    const message = JSON.parse(json);
    return { status: res.status, isError: message.result?.isError, text: String(message.result?.content?.[0]?.text ?? "") };
  }

  it("rejects a call with no token", async () => {
    expect((await callAs(null, "list_invoices", {})).status).toBe(401);
  });

  it("refuses billing and real-book tools to a shadow-only token", async () => {
    const billing = await callAs("shadow", "get_invoice", { id: "INV-2026-0001" });
    expect(billing.isError).toBe(true);
    expect(billing.text).toContain("invoice_scope_forbidden");
    const realBook = await callAs("shadow", "sync_tracked_tickers", {});
    expect(realBook.isError).toBe(true);
    expect(realBook.text).toContain("shadow_scope_real_book_forbidden");
  });

  it("lets a full-scope token past the scope check", async () => {
    // No database here, so the call itself fails later — but not on scope.
    const res = await callAs("full", "get_invoice", { id: "INV-2026-0001" });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("invoice_scope_forbidden");
  });
});
