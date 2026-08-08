import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
import { applyGapFixInputSchema } from "@/lib/agent/schemas";
import { applyGapFix } from "@/lib/evolution/gapfix";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Small prose correction to the ACTIVE ruleset. expectedSectionSha is mandatory. */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseOr400(applyGapFixInputSchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await applyGapFix(parsed.data);
  if (!result.ok) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}
