import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
import { resolveShadowCall } from "@/lib/agent/mcp-scope";
import {
  listDecisionReviewsQuerySchema,
  upsertDecisionReviewInputSchema,
} from "@/lib/agent/schemas";
import { listDecisionReviews, upsertDecisionReview } from "@/lib/agent/writes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = parseOr400(listDecisionReviewsQuerySchema, raw);
  if (!parsed.ok) return parsed.response;

  // HTTP listing: omitted book stays unset (no filter); explicit PAPER is allowed.
  const resolved = resolveShadowCall(parsed.data, undefined, {
    bookAware: true,
    defaultBook: "none",
  });
  if ("__error" in resolved) {
    return NextResponse.json(JSON.parse(resolved.__error) as object, { status: 400 });
  }

  return NextResponse.json(await listDecisionReviews(resolved));
}

export async function PUT(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseOr400(upsertDecisionReviewInputSchema, body);
  if (!parsed.ok) return parsed.response;

  // HTTP AGENT_TOKEN has no scopes → mcp:tools-equivalent: REAL only.
  const resolved = resolveShadowCall(parsed.data, undefined, { bookAware: true });
  if ("__error" in resolved) {
    return NextResponse.json(JSON.parse(resolved.__error) as object, { status: 400 });
  }

  const result = await upsertDecisionReview(resolved);
  if (!result.ok) {
    const status = "status" in result && typeof result.status === "number" ? result.status : 409;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 200 });
}
