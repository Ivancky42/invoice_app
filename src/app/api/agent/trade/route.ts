import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
import { logTradeInputSchema } from "@/lib/agent/schemas";
import { logTrade } from "@/lib/agent/logTrade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseOr400(logTradeInputSchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await logTrade(parsed.data);
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 });
  }
  return NextResponse.json(result, { status: 200 });
}
