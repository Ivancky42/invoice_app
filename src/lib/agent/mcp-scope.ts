/**
 * MCP OAuth scopes for Stock HQ.
 *
 * `mcp:tools` — full connector (LIVE routines): real-book writes + evolution writes allowed.
 * `mcp:shadow` — shadow-only connector (CANDIDATE routines): branch-aware reads/writes only;
 *   real-book and evolution writes are refused server-side.
 */
export const MCP_SCOPE = "mcp:tools";
export const MCP_SHADOW_SCOPE = "mcp:shadow";

export const MCP_SCOPES_SUPPORTED = [MCP_SCOPE, MCP_SHADOW_SCOPE] as const;

export type McpScope = (typeof MCP_SCOPES_SUPPORTED)[number];

/** True when the token carries a recognised Stock HQ MCP scope. */
export function hasAnyMcpScope(scopes: readonly string[] | undefined): boolean {
  if (!scopes?.length) return false;
  return scopes.some((s) => s === MCP_SCOPE || s === MCP_SHADOW_SCOPE);
}

/**
 * Shadow-only token: has `mcp:shadow` and does NOT have full `mcp:tools`.
 * Full tokens (including legacy AGENT_TOKEN) always carry `mcp:tools`.
 */
export function isShadowOnlyScope(scopes: readonly string[] | undefined): boolean {
  if (!scopes?.length) return false;
  return scopes.includes(MCP_SHADOW_SCOPE) && !scopes.includes(MCP_SCOPE);
}

/** Real portfolio / watchlist / idea / evolution mutation tools. */
export function canWriteRealBook(scopes: readonly string[] | undefined): boolean {
  // Missing scopes = legacy / unverified path treated as full (HTTP AGENT_TOKEN routes).
  if (!scopes?.length) return true;
  return scopes.includes(MCP_SCOPE);
}

export function realBookWriteBlockedError(): {
  error: "shadow_scope_real_book_forbidden";
  message: string;
} {
  return {
    error: "shadow_scope_real_book_forbidden",
    message:
      "This connector is mcp:shadow only — real-book and evolution writes are forbidden. Use the LIVE (mcp:tools) connector for portfolio/watchlist/idea/rule mutations.",
  };
}

export function shadowScopeLiveBranchError(): {
  error: "shadow_scope_requires_candidate_branch";
  message: string;
} {
  return {
    error: "shadow_scope_requires_candidate_branch",
    message:
      "mcp:shadow connectors must use branch=CANDIDATE on branch-aware tools (LIVE is refused).",
  };
}

/** Normalize requested scope string from OAuth; default full tools. */
export function normalizeMcpScopeRequest(raw: string | undefined | null): string {
  const parts = (raw?.trim() || MCP_SCOPE).split(/\s+/).filter(Boolean);
  const allowed = parts.filter((s) => s === MCP_SCOPE || s === MCP_SHADOW_SCOPE);
  if (allowed.length === 0) return MCP_SCOPE;
  // Prefer a single primary scope for the minted token (shadow-only OR full, not both).
  if (allowed.includes(MCP_SHADOW_SCOPE) && !allowed.includes(MCP_SCOPE)) {
    return MCP_SHADOW_SCOPE;
  }
  return MCP_SCOPE;
}
