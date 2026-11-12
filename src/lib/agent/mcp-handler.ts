import { createMcpHandler } from "mcp-handler";
import { registerAgentMcpTools } from "@/lib/agent/mcp-tools";

export const MCP_SERVER_INFO = { name: "stock-hq", version: "0.6.0" } as const;

/**
 * The Stock HQ MCP handler, unauthenticated. The route wraps it in `withMcpAuth`; tests
 * call it directly so they exercise the production server options, not a copy.
 */
export function createAgentMcpHandler() {
  return createMcpHandler(
    (server) => {
      registerAgentMcpTools(server);
    },
    {
      serverInfo: { ...MCP_SERVER_INFO },
      // A fresh server is built per request, so it can never emit tools/list_changed.
      // Advertising it (the SDK's default) lets 2026-07-28 clients hold a
      // `subscriptions/listen` SSE stream open until maxDuration kills it, then reconnect:
      // a 60s timed-out invocation per minute per connected client. With the bit off the
      // listen is acknowledged with an empty filter and closed at once.
      capabilities: { tools: { listChanged: false } },
    },
  );
}
