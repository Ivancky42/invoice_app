import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { parseOr400 } from "@/lib/agent/http";
import { listDailyLogItems } from "@/lib/agent/context";
import { listDailyLogsQuerySchema } from "@/lib/agent/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = parseOr400(listDailyLogsQuerySchema, raw);
  if (!parsed.ok) return parsed.response;

  return NextResponse.json(await listDailyLogItems(parsed.data));
}
