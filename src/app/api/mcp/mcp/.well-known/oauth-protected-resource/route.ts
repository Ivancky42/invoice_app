import {
  corsJson,
  corsOptions,
  getAppOrigin,
  protectedResourceMetadata,
} from "@/lib/agent/mcp-oauth";

export const dynamic = "force-dynamic";

/**
 * Alias PRM path advertised by mcp-handler withMcpAuth when resourceUrl is
 * `…/api/mcp/mcp` (appends `/.well-known/oauth-protected-resource` under the resource).
 */
export async function GET(req: Request) {
  return corsJson(protectedResourceMetadata(getAppOrigin(req)));
}

export async function OPTIONS() {
  return corsOptions();
}
