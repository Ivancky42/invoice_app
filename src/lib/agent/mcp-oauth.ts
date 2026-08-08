/**
 * Self-hosted OAuth 2.1 helpers for Claude / ChatGPT → Stock HQ MCP.
 * Stateless JWTs (HMAC-SHA256) for auth codes + access/refresh tokens.
 */

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  hasAnyMcpScope,
  MCP_SCOPE,
  MCP_SCOPES_SUPPORTED,
  MCP_SHADOW_SCOPE,
  normalizeMcpScopeRequest,
} from "@/lib/agent/mcp-scope";

export {
  MCP_SCOPE,
  MCP_SHADOW_SCOPE,
  MCP_SCOPES_SUPPORTED,
  normalizeMcpScopeRequest,
};

/** Exact redirect URIs (Claude + ChatGPT legacy). */
export const ALLOWED_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
] as const;

/** ChatGPT per-connector callbacks: https://chatgpt.com/connector/oauth/{id} */
const CHATGPT_CONNECTOR_OAUTH_PREFIX = "https://chatgpt.com/connector/oauth/";

const AUTH_CODE_TTL_SEC = 5 * 60;
const ACCESS_TOKEN_TTL_SEC = 60 * 60;
const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Public app origin (no trailing slash). */
export function getAppOrigin(req?: Request): string {
  const fromEnv =
    process.env.APP_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (req) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host =
      req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
    return `${proto}://${host}`.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}

export function mcpResourceUrl(origin = getAppOrigin()): string {
  return `${origin}/api/mcp/mcp`;
}

export function isAllowedRedirectUri(uri: string): boolean {
  if ((ALLOWED_REDIRECT_URIS as readonly string[]).includes(uri)) return true;
  // ChatGPT DCR uses a unique callback id per connector instance.
  if (uri.startsWith(CHATGPT_CONNECTOR_OAUTH_PREFIX)) {
    const id = uri.slice(CHATGPT_CONNECTOR_OAUTH_PREFIX.length);
    return id.length > 0 && !id.includes("/") && !id.includes("?");
  }
  return false;
}

export function getAgentToken(): string | null {
  const t = process.env.AGENT_TOKEN?.trim();
  if (!t || t.length < 32) return null;
  return t;
}

export function agentTokenMatches(provided: string): boolean {
  const expected = getAgentToken();
  if (!expected) return false;
  return timingSafeEqual(expected, provided.trim());
}

function jwtSecret(): string {
  const dedicated = process.env.MCP_OAUTH_JWT_SECRET?.trim();
  if (dedicated && dedicated.length >= 32) return dedicated;
  const agent = getAgentToken();
  if (!agent) throw new Error("AGENT_TOKEN (or MCP_OAUTH_JWT_SECRET) required for OAuth JWT");
  return agent;
}

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export type JwtPayload = Record<string, unknown> & {
  typ: string;
  exp: number;
  iat: number;
};

export async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const body = b64url(JSON.stringify(payload));
  const head = b64url(JSON.stringify(header));
  const input = `${head}.${body}`;
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const input = `${head}.${body}`;
  const key = await hmacKey();
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sig).buffer as ArrayBuffer,
    new TextEncoder().encode(input),
  );
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as JwtPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    if (typeof payload.typ !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyPkceS256(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const computed = b64url(digest);
  return timingSafeEqual(computed, codeChallenge);
}

export type AuthCodeClaims = {
  typ: "auth_code";
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
  scope: string;
  resource?: string;
  iat: number;
  exp: number;
};

export type AccessTokenClaims = {
  typ: "access";
  client_id: string;
  scope: string;
  resource?: string;
  sub: "stock-hq-agent";
  iat: number;
  exp: number;
};

export type RefreshTokenClaims = {
  typ: "refresh";
  client_id: string;
  scope: string;
  resource?: string;
  iat: number;
  exp: number;
};

export async function mintAuthCode(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string;
  resource?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: AuthCodeClaims = {
    typ: "auth_code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    scope: normalizeMcpScopeRequest(input.scope),
    resource: input.resource,
    iat: now,
    exp: now + AUTH_CODE_TTL_SEC,
  };
  return signJwt(claims);
}

export async function mintAccessToken(input: {
  clientId: string;
  scope?: string;
  resource?: string;
}): Promise<{ access_token: string; expires_in: number; scope: string }> {
  const now = Math.floor(Date.now() / 1000);
  const scope = normalizeMcpScopeRequest(input.scope);
  const claims: AccessTokenClaims = {
    typ: "access",
    client_id: input.clientId,
    scope,
    resource: input.resource,
    sub: "stock-hq-agent",
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SEC,
  };
  return {
    access_token: await signJwt(claims),
    expires_in: ACCESS_TOKEN_TTL_SEC,
    scope,
  };
}

export async function mintRefreshToken(input: {
  clientId: string;
  scope?: string;
  resource?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: RefreshTokenClaims = {
    typ: "refresh",
    client_id: input.clientId,
    scope: normalizeMcpScopeRequest(input.scope),
    resource: input.resource,
    iat: now,
    exp: now + REFRESH_TOKEN_TTL_SEC,
  };
  return signJwt(claims);
}

/** Verify Bearer for MCP: OAuth access JWT or legacy raw AGENT_TOKEN. */
export async function verifyMcpBearer(
  bearerToken: string | undefined,
  resourceUrl: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;

  // Legacy Desktop / mcp-remote / curl — full LIVE access.
  if (agentTokenMatches(bearerToken)) {
    return {
      token: bearerToken,
      clientId: "agent-token",
      scopes: [MCP_SCOPE],
      expiresAt: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SEC,
      resource: new URL(resourceUrl),
    };
  }

  const payload = await verifyJwt(bearerToken);
  if (!payload || payload.typ !== "access") return undefined;
  const scope =
    typeof payload.scope === "string" && payload.scope.length > 0
      ? payload.scope.split(/\s+/).filter(Boolean)
      : [MCP_SCOPE];
  if (!hasAnyMcpScope(scope)) return undefined;

  const clientId =
    typeof payload.client_id === "string" ? payload.client_id : "unknown";
  let resource: URL | undefined;
  if (typeof payload.resource === "string" && payload.resource.length > 0) {
    try {
      resource = new URL(payload.resource);
    } catch {
      resource = undefined;
    }
  } else {
    resource = new URL(resourceUrl);
  }

  return {
    token: bearerToken,
    clientId,
    scopes: scope,
    expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
    resource,
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES_SUPPORTED],
    service_documentation: `${origin}/docs/STOCK_HQ_AGENTS.md`,
  };
}

export function protectedResourceMetadata(origin: string) {
  const resource = mcpResourceUrl(origin);
  return {
    resource,
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES_SUPPORTED],
    bearer_methods_supported: ["header"],
    resource_name: "Stock HQ MCP",
  };
}

export function corsJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export function corsOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
