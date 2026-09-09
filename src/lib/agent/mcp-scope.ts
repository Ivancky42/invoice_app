/**
 * MCP OAuth scopes for Stock HQ.
 *
 * `mcp:tools` — full connector (LIVE + paper on the same Claude URL).
 *   get_context / upsert_decision_review: omitted branch → LIVE + REAL (Ivan's book).
 *   branch=CANDIDATE forces book=PAPER (the candidate paper book). Explicit book=PAPER
 *   is allowed on LIVE too (Pass A of the paper test). Listing tools: omitted book
 *   is left unset; explicit PAPER is allowed.
 * `mcp:shadow` — optional shadow-only connector: book is always PAPER.
 *   branch=LIVE is allowed only on book-aware tools. Real-book writes are refused.
 */
export const MCP_SCOPE = "mcp:tools";
export const MCP_SHADOW_SCOPE = "mcp:shadow";

export const MCP_SCOPES_SUPPORTED = [MCP_SCOPE, MCP_SHADOW_SCOPE] as const;

export type McpScope = (typeof MCP_SCOPES_SUPPORTED)[number];

export type ShadowCallBranch = "LIVE" | "CANDIDATE";
export type ShadowCallBook = "REAL" | "PAPER";

/**
 * Tools that may address branch=LIVE on mcp:shadow because they operate on a paper book
 * (or the ruleset that governs one). Non-book-aware branch tools stay CANDIDATE-only so
 * the paper run writes one combined daily log / report / evidence trail.
 */
export const BOOK_AWARE_TOOLS = [
  "get_context",
  "get_prompt",
  "upsert_decision_review",
  "list_decision_reviews",
  "list_shadow_positions",
  "list_shadow_orders",
  "get_shadow_fitness",
  "list_counterfactuals",
] as const;

export type BookAwareTool = (typeof BOOK_AWARE_TOOLS)[number];

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
      "mcp:shadow connectors must use branch=CANDIDATE on this tool (LIVE is refused). Book-aware tools may address branch=LIVE on the paper book.",
  };
}

export type ResolveShadowCallOpts = {
  /** When true, mcp:shadow may pass branch=LIVE (paper book for the LIVE ruleset). */
  bookAware: boolean;
  /**
   * How an omitted `book` is filled for mcp:tools / HTTP.
   * - `REAL` (default): writes + get_context. CANDIDATE still forces PAPER.
   * - `none`: listing/read tools. Omitted stays unset (no filter); explicit PAPER is allowed.
   */
  defaultBook?: "none" | "REAL";
};

export type ResolveShadowCallError = { __error: string };

/**
 * Bind branch + book for a tool call.
 *
 * mcp:shadow: book is forced PAPER. Omitted branch becomes CANDIDATE. branch=LIVE is
 * allowed only on book-aware tools; other branch tools keep the old CANDIDATE-only rule.
 *
 * mcp:tools / legacy (no scopes), defaultBook=REAL (writes + get_context):
 *   omitted branch → book=REAL; branch=CANDIDATE → book=PAPER (explicit REAL ignored);
 *   explicit book=PAPER on LIVE is allowed (Pass A).
 *
 * mcp:tools / legacy, defaultBook=none (listing/read):
 *   omitted book stays undefined (no filter); explicit book=PAPER is allowed.
 *
 * Decision table:
 *   caller          | tool kind        | branch in     | book in | result
 *   mcp:shadow      | book-aware       | LIVE          | *       | LIVE + PAPER
 *   mcp:shadow      | book-aware       | omitted / CAN | *       | CANDIDATE + PAPER
 *   mcp:shadow      | not book-aware   | LIVE          | *       | 400 shadow_scope_requires_candidate_branch
 *   mcp:shadow      | not book-aware   | omitted / CAN | *       | CANDIDATE + PAPER
 *   tools / HTTP    | write / context  | CANDIDATE     | *       | CANDIDATE + PAPER
 *   tools / HTTP    | write / context  | LIVE / omit   | PAPER   | LIVE + PAPER
 *   tools / HTTP    | write / context  | LIVE / omit   | omit    | book=REAL
 *   tools / HTTP    | listing          | unchanged     | PAPER   | book=PAPER (read-only)
 *   tools / HTTP    | listing          | unchanged     | omit    | book unset (no filter)
 */
export function resolveShadowCall<T extends { branch?: ShadowCallBranch; book?: ShadowCallBook }>(
  input: T,
  scopes: readonly string[] | undefined,
  opts: ResolveShadowCallOpts,
): T | ResolveShadowCallError {
  if (isShadowOnlyScope(scopes)) {
    if (!opts.bookAware && input.branch === "LIVE") {
      return { __error: JSON.stringify(shadowScopeLiveBranchError()) };
    }
    return {
      ...input,
      book: "PAPER",
      branch: input.branch ?? "CANDIDATE",
    };
  }
  if (opts.defaultBook === "none") {
    return input;
  }
  if (input.branch === "CANDIDATE") {
    return { ...input, book: "PAPER" };
  }
  return { ...input, book: input.book ?? "REAL" };
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
