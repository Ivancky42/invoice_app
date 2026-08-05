import {
  corsJson,
  corsOptions,
  isAllowedRedirectUri,
} from "@/lib/agent/mcp-oauth";

export const dynamic = "force-dynamic";

/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591).
 * Claude Custom Connector leaves Client ID/Secret blank and registers here.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return corsJson(
      { error: "invalid_client_metadata", error_description: "JSON body required" },
      400,
    );
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (redirectUris.length === 0) {
    return corsJson(
      {
        error: "invalid_redirect_uri",
        error_description: "redirect_uris required",
      },
      400,
    );
  }
  for (const uri of redirectUris) {
    if (!isAllowedRedirectUri(uri)) {
      return corsJson(
        {
          error: "invalid_redirect_uri",
          error_description: `redirect_uri not allowed: ${uri}`,
        },
        400,
      );
    }
  }

  const clientId = `stock-hq-${crypto.randomUUID()}`;

  return corsJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name:
        typeof body.client_name === "string" ? body.client_name : "Claude",
      // Public client — no secret. Claude Advanced Client Secret stays empty.
      client_secret_expires_at: 0,
    },
    201,
  );
}

export async function OPTIONS() {
  return corsOptions();
}
