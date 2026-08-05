import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
import { patchPortfolioInputSchema } from "@/lib/agent/schemas";
import { patchPortfolio } from "@/lib/agent/writes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ ticker: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const { ticker } = await ctx.params;
  if (!ticker?.trim()) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  const body = await readJsonBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseOr400(patchPortfolioInputSchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await patchPortfolio(decodeURIComponent(ticker), parsed.data);
  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
