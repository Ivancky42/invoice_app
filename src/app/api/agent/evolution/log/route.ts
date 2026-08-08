import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { parseOr400 } from "@/lib/agent/http";
import { listEvolutionLogInputSchema } from "@/lib/agent/schemas";
import { listEvolutionEvents } from "@/lib/evolution/log";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Read the append-only evolution audit log. There is no POST/DELETE here by design. */
export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = parseOr400(listEvolutionLogInputSchema, raw);
  if (!parsed.ok) return parsed.response;

  return NextResponse.json(await listEvolutionEvents(parsed.data));
}
