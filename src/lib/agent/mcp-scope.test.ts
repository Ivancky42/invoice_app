import { describe, expect, it } from "vitest";
import {
  canWriteRealBook,
  hasAnyMcpScope,
  isShadowOnlyScope,
  MCP_SCOPE,
  MCP_SHADOW_SCOPE,
  normalizeMcpScopeRequest,
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
