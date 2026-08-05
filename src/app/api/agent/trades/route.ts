import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { listTradeItems } from "@/lib/agent/context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;
  return NextResponse.json(await listTradeItems());
}
