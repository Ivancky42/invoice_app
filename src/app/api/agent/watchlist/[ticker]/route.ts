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

  const result = await deleteWatchlist(decodeURIComponent(ticker));
  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
