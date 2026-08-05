import {
  corsJson,
  corsOptions,
  mintAccessToken,
  mintRefreshToken,
  verifyJwt,
  verifyPkceS256,
  type AuthCodeClaims,
  type RefreshTokenClaims,
} from "@/lib/agent/mcp-oauth";

export const dynamic = "force-dynamic";

async function readBody(req: Request): Promise<URLSearchParams> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await req.json()) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === "string") params.set(k, v);
    }
    return params;
  }
  return new URLSearchParams(await req.text());
}

export async function POST(req: Request) {
  let params: URLSearchParams;
  try {
    params = await readBody(req);
  } catch {
    return corsJson(
      { error: "invalid_request", error_description: "Could not parse body" },
      400,
    );
  }

  const grantType = params.get("grant_type") ?? "";
  const clientId = params.get("client_id") ?? "";

  if (grantType === "authorization_code") {
    const code = params.get("code") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    const codeVerifier = params.get("code_verifier") ?? "";

    if (!code || !clientId || !redirectUri || !codeVerifier) {
      return corsJson(
        {
          error: "invalid_request",
          error_description: "code, client_id, redirect_uri, code_verifier required",
        },
        400,
      );
    }

    const payload = await verifyJwt(code);
    if (!payload || payload.typ !== "auth_code") {
      return corsJson(
        { error: "invalid_grant", error_description: "Invalid or expired code" },
        400,
      );
    }
    const claims = payload as unknown as AuthCodeClaims;
    if (claims.client_id !== clientId) {
      return corsJson(
        { error: "invalid_grant", error_description: "client_id mismatch" },
        400,
      );
    }
    if (claims.redirect_uri !== redirectUri) {
      return corsJson(
        { error: "invalid_grant", error_description: "redirect_uri mismatch" },
        400,
      );
    }
    if (!(await verifyPkceS256(codeVerifier, claims.code_challenge))) {
      return corsJson(
        { error: "invalid_grant", error_description: "PKCE verification failed" },
        400,
      );
    }

    const access = await mintAccessToken({
      clientId,
      scope: claims.scope,
      resource: claims.resource,
    });
    const refresh_token = await mintRefreshToken({
      clientId,
      scope: claims.scope,
      resource: claims.resource,
    });

    return corsJson({
      access_token: access.access_token,
      token_type: "bearer",
      expires_in: access.expires_in,
      refresh_token,
      scope: access.scope,
    });
  }

  if (grantType === "refresh_token") {
    const refreshToken = params.get("refresh_token") ?? "";
    if (!refreshToken || !clientId) {
      return corsJson(
        {
          error: "invalid_request",
          error_description: "refresh_token and client_id required",
        },
        400,
      );
    }
    const payload = await verifyJwt(refreshToken);
    if (!payload || payload.typ !== "refresh") {
      return corsJson(
        { error: "invalid_grant", error_description: "Invalid refresh_token" },
        400,
      );
    }
    const claims = payload as unknown as RefreshTokenClaims;
    if (claims.client_id !== clientId) {
      return corsJson(
        { error: "invalid_grant", error_description: "client_id mismatch" },
        400,
      );
    }
    const access = await mintAccessToken({
      clientId,
      scope: claims.scope,
      resource: claims.resource,
    });
    const newRefresh = await mintRefreshToken({
      clientId,
      scope: claims.scope,
      resource: claims.resource,
    });
    return corsJson({
      access_token: access.access_token,
      token_type: "bearer",
      expires_in: access.expires_in,
      refresh_token: newRefresh,
      scope: access.scope,
    });
  }

  return corsJson(
    {
      error: "unsupported_grant_type",
      error_description: "Use authorization_code or refresh_token",
    },
    400,
  );
}

export async function OPTIONS() {
  return corsOptions();
}
