import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
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

  return NextResponse.json(await listDecisionReviews(parsed.data));
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

  const result = await upsertDecisionReview(parsed.data);
  if (!result.ok) {
    // Refused before anything was written (evidence_insufficient in strict mode) — same
    // 409 conflict shape the trade route uses for its refused-write path.
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json(result, { status: 200 });
}
