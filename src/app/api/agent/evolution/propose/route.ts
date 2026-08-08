import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
import { proposeRuleChangeInputSchema } from "@/lib/agent/schemas";
import { proposeRuleChange } from "@/lib/evolution/propose";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Create a CANDIDATE ruleset. The server assigns the lane; a supplied one is ignored. */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseOr400(proposeRuleChangeInputSchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await proposeRuleChange(parsed.data);
  if (!result.ok) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}
