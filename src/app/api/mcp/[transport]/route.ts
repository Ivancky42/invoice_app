import { withMcpAuth } from "mcp-handler";
import { createAgentMcpHandler } from "@/lib/agent/mcp-handler";
import {
  getAppOrigin,
  mcpResourceUrl,
  verifyMcpBearer,
} from "@/lib/agent/mcp-oauth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const mcpHandler = createAgentMcpHandler();

/**
 * mcp-handler 2 serves every request it is given (no basePath; the legacy SSE transport
 * is gone), so only `/api/mcp/mcp` — the Streamable HTTP URL clients are configured
 * with — reaches it. Other segments 404, as `basePath` + `disableSse` did in 1.x.
 */
const MCP_SEGMENT = "mcp";

/**
 * OAuth JWT (Claude Custom Connector) or legacy Bearer AGENT_TOKEN (Desktop mcp-remote).
 * resourceUrl is computed per request so WWW-Authenticate points at the public host.
 */
async function handle(
  req: Request,
  { params }: { params: Promise<{ transport: string }> },
): Promise<Response> {
  if ((await params).transport !== MCP_SEGMENT) {
    return new Response("Not Found", { status: 404 });
  }
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
