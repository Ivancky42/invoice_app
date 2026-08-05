import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Extract Bearer token from Authorization header, or null. */
export function extractBearerToken(req: Request | NextRequest): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verify `Authorization: Bearer $AGENT_TOKEN` with timing-safe compare.
 * Returns null when authorized; otherwise a 401 JSON response.
 */
export function requireAgentToken(req: Request | NextRequest): NextResponse | null {
  const expected = process.env.AGENT_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", message: "AGENT_TOKEN not configured" },
      { status: 401 },
    );
  }
  if (expected.length < 32) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
        message: "AGENT_TOKEN must be 32+ characters",
      },
      { status: 401 },
    );
  }

  const provided = extractBearerToken(req);
  if (!provided || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  return null;
}

/** True when Bearer token matches AGENT_TOKEN. */
export function isAgentAuthorized(req: Request | NextRequest): boolean {
  return requireAgentToken(req) === null;
}
