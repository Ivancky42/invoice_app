import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { deleteWatchlist } from "@/lib/agent/writes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ ticker: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const { ticker } = await ctx.params;
  if (!ticker?.trim()) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "true";
  const actionParam = url.searchParams.get("action");
  const action = actionParam === "DROPPED" ? ("DROPPED" as const) : ("DEMOTED" as const);

  const result = await deleteWatchlist(decodeURIComponent(ticker), { hard, action });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
