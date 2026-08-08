import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerAgentMcpTools } from "@/lib/agent/mcp-tools";
import {
  getAppOrigin,
  mcpResourceUrl,
  verifyMcpBearer,
} from "@/lib/agent/mcp-oauth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const mcpHandler = createMcpHandler(
  (server) => {
    registerAgentMcpTools(server);
  },
  {
    serverInfo: {
      name: "stock-hq",
      version: "0.5.0",
    },
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
    disableSse: true,
  },
);

/**
 * OAuth JWT (Claude Custom Connector) or legacy Bearer AGENT_TOKEN (Desktop mcp-remote).
 * resourceUrl is computed per request so WWW-Authenticate points at the public host.
 */
async function handle(req: Request): Promise<Response> {
  const origin = getAppOrigin(req);
  const resource = mcpResourceUrl(origin);
  const authHandler = withMcpAuth(
    mcpHandler,
    async (_req, bearerToken) => verifyMcpBearer(bearerToken, resource),
    {
      required: true,
      resourceMetadataPath: "/.well-known/oauth-protected-resource",
      // Either mcp:tools (LIVE) or mcp:shadow (CANDIDATE) — verified in verifyMcpBearer.
      requiredScopes: [],
      resourceUrl: resource,
    },
  );
  return authHandler(req);
}

export { handle as GET, handle as POST, handle as DELETE };
