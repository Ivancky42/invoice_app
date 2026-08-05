import {
  authorizationServerMetadata,
  corsJson,
  corsOptions,
  getAppOrigin,
} from "@/lib/agent/mcp-oauth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return corsJson(authorizationServerMetadata(getAppOrigin(req)));
}

export async function OPTIONS() {
  return corsOptions();
}
