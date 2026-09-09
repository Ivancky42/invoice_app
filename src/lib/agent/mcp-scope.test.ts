import { describe, expect, it } from "vitest";
import {
  canWriteRealBook,
  hasAnyMcpScope,
  isShadowOnlyScope,
  MCP_SCOPE,
  MCP_SHADOW_SCOPE,
  normalizeMcpScopeRequest,
  resolveShadowCall,
  shadowScopeLiveBranchError,
} from "@/lib/agent/mcp-scope";
import {
  COUNTERFACTUAL_HORIZON_SESSIONS,
  COUNTERFACTUAL_HORIZONS,
  COUNTERFACTUAL_INTERIM_HORIZON_SESSIONS,
  residualCredit,
} from "@/lib/fitness/counterfactuals";

describe("mcp scopes", () => {
  it("treats legacy empty scopes as full real-book access", () => {
    expect(canWriteRealBook(undefined)).toBe(true);
    expect(canWriteRealBook([])).toBe(true);
    expect(isShadowOnlyScope(undefined)).toBe(false);
  });

  it("blocks real-book writes for shadow-only tokens", () => {
    expect(canWriteRealBook([MCP_SHADOW_SCOPE])).toBe(false);
    expect(isShadowOnlyScope([MCP_SHADOW_SCOPE])).toBe(true);
    expect(hasAnyMcpScope([MCP_SHADOW_SCOPE])).toBe(true);
  });

  it("allows real-book writes when mcp:tools is present", () => {
    expect(canWriteRealBook([MCP_SCOPE])).toBe(true);
    expect(canWriteRealBook([MCP_SCOPE, MCP_SHADOW_SCOPE])).toBe(true);
    expect(isShadowOnlyScope([MCP_SCOPE, MCP_SHADOW_SCOPE])).toBe(false);
  });

  it("resolveShadowCall: shadow + LIVE on a book-aware tool is ok and book is PAPER", () => {
    const resolved = resolveShadowCall(
      { branch: "LIVE" as const },
      [MCP_SHADOW_SCOPE],
      { bookAware: true },
    );
    expect(resolved).toEqual({ branch: "LIVE", book: "PAPER" });
  });

  it("resolveShadowCall: shadow + LIVE on upsert_daily_log is refused", () => {
    const resolved = resolveShadowCall(
      { branch: "LIVE" as const },
      [MCP_SHADOW_SCOPE],
      { bookAware: false },
    );
    expect(resolved).toEqual({ __error: JSON.stringify(shadowScopeLiveBranchError()) });
  });

  it("resolveShadowCall: shadow omitted branch defaults to CANDIDATE and book PAPER", () => {
    const resolved = resolveShadowCall({}, [MCP_SHADOW_SCOPE], { bookAware: true });
    expect(resolved).toEqual({ branch: "CANDIDATE", book: "PAPER" });
  });

  it("resolveShadowCall: mcp:tools + book=PAPER on LIVE is allowed (Pass A)", () => {
    const resolved = resolveShadowCall(
      { book: "PAPER" as const },
      [MCP_SCOPE],
      { bookAware: true },
    );
    expect(resolved).toEqual({ book: "PAPER" });
  });

  it("resolveShadowCall: mcp:tools + branch=CANDIDATE forces PAPER even if book=REAL", () => {
    const resolved = resolveShadowCall(
      { branch: "CANDIDATE" as const, book: "REAL" as const },
      [MCP_SCOPE],
      { bookAware: true },
    );
    expect(resolved).toEqual({ branch: "CANDIDATE", book: "PAPER" });
  });

  it("resolveShadowCall: listing tools leave omitted book unset for mcp:tools / HTTP", () => {
    expect(
      resolveShadowCall({}, [MCP_SCOPE], { bookAware: true, defaultBook: "none" }),
    ).toEqual({});
    expect(
      resolveShadowCall(
        { branch: "CANDIDATE" as const },
        undefined,
        { bookAware: true, defaultBook: "none" },
      ),
    ).toEqual({ branch: "CANDIDATE" });
  });

  it("resolveShadowCall: listing tools allow mcp:tools to pass book=PAPER", () => {
    expect(
      resolveShadowCall(
        { book: "PAPER" as const, branch: "CANDIDATE" as const },
        [MCP_SCOPE],
        { bookAware: true, defaultBook: "none" },
      ),
    ).toEqual({ book: "PAPER", branch: "CANDIDATE" });
  });

  it("resolveShadowCall: listing tools still force PAPER for mcp:shadow", () => {
    expect(
      resolveShadowCall({}, [MCP_SHADOW_SCOPE], { bookAware: true, defaultBook: "none" }),
    ).toEqual({ branch: "CANDIDATE", book: "PAPER" });
  });

  it("resolveShadowCall: legacy no-scope defaults to REAL on writes / get_context", () => {
    expect(resolveShadowCall({}, undefined, { bookAware: true })).toEqual({ book: "REAL" });
    expect(resolveShadowCall({}, [], { bookAware: false })).toEqual({ book: "REAL" });
  });

  it("normalizes OAuth scope requests to a single primary scope", () => {
    expect(normalizeMcpScopeRequest(undefined)).toBe(MCP_SCOPE);
    expect(normalizeMcpScopeRequest(MCP_SHADOW_SCOPE)).toBe(MCP_SHADOW_SCOPE);
    expect(normalizeMcpScopeRequest(`${MCP_SHADOW_SCOPE} ${MCP_SCOPE}`)).toBe(MCP_SCOPE);
    expect(normalizeMcpScopeRequest("garbage")).toBe(MCP_SCOPE);
  });
});

describe("counterfactual horizons", () => {
  it("seeds interim 21 alongside full 63", () => {
    expect(COUNTERFACTUAL_INTERIM_HORIZON_SESSIONS).toBe(21);
    expect(COUNTERFACTUAL_HORIZON_SESSIONS).toBe(63);
    expect([...COUNTERFACTUAL_HORIZONS]).toEqual([21, 63]);
  });

  it("full-horizon residual equals quarter credit once interim is recognized", () => {
    const interim = 0.012;
    const rawFull = 0.009;
    const residual = residualCredit(rawFull, interim);
    expect(interim + residual).toBeCloseTo(rawFull, 10);
    expect(residual).toBe(-0.003);
  });

  it("rounds residual to 6dp", () => {
    expect(residualCredit(0.0123456, 0.0012345)).toBe(0.011111);
  });
});
