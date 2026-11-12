import { AsyncLocalStorage } from "node:async_hooks";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";

// next/experimental/testing/server pulls in Next's request storage, which expects the
// AsyncLocalStorage global the Next runtime normally installs.
let doesProxyMatch: (typeof import("next/experimental/testing/server"))["unstable_doesMiddlewareMatch"];
beforeAll(async () => {
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
  ({ unstable_doesMiddlewareMatch: doesProxyMatch } = await import("next/experimental/testing/server"));
});

/** Agent, cron and OAuth endpoints: no PIN gate, and no proxy invocation either. */
const PASS_THROUGH = [
  "/api/mcp/mcp",
  "/api/mcp/mcp/.well-known/oauth-protected-resource",
  "/api/agent/context",
  "/api/cron/tick",
  "/api/sync/prices",
  "/api/oauth/token",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
];

/** Everything the PIN gate protects, plus look-alikes of the pass-through prefixes. */
const GATED = [
  "/",
  "/stocks",
  "/documents/abc",
  "/api/pdf/abc",
  "/api/debug/notion-daily-log-schema",
  "/api/mcp-admin",
  "/api/oauthdebug",
  "/api/agentx",
];

describe("proxy matcher", () => {
  it.each(PASS_THROUGH)("does not run the proxy for %s", (url) => {
    expect(doesProxyMatch({ config, url })).toBe(false);
  });

  it.each(GATED)("runs the proxy for %s", (url) => {
    expect(doesProxyMatch({ config, url })).toBe(true);
  });
});

describe("proxy gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  function gateOn() {
    vi.stubEnv("APP_PIN", "123456");
    vi.stubEnv("APP_GATE_SECRET", "x".repeat(64));
  }

  // Backstop for the matcher: if a pass-through path ever reaches the proxy, it must
  // still be let through rather than redirected to /login.
  it.each(PASS_THROUGH)("lets %s through without the PIN cookie", async (path) => {
    gateOn();
    const res = await proxy(new NextRequest(`https://app.test${path}`));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(GATED.filter((p) => p !== "/api/pdf/abc"))(
    "redirects %s to /login without the PIN cookie",
    async (path) => {
      gateOn();
      const res = await proxy(new NextRequest(`https://app.test${path}`));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
    },
  );
});
