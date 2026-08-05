import {
  corsJson,
  corsOptions,
  getAppOrigin,
  protectedResourceMetadata,
} from "@/lib/agent/mcp-oauth";

export const dynamic = "force-dynamic";

/** Path-appended PRM — Claude probes `/.well-known/oauth-protected-resource/api/mcp/mcp`. */
export async function GET(req: Request) {
  return corsJson(protectedResourceMetadata(getAppOrigin(req)));
}

export async function OPTIONS() {
  return corsOptions();
}
