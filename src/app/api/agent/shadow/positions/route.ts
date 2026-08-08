import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { parseOr400 } from "@/lib/agent/http";
import { listShadowPositionsInputSchema } from "@/lib/agent/schemas";
import { listShadowPositions } from "@/lib/shadow/read";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const params = req.nextUrl.searchParams;
  const raw: Record<string, unknown> = Object.fromEntries(params.entries());
  // Query strings carry booleans as text; the schema wants a real boolean.
  if (params.has("includeClosed")) {
    raw.includeClosed = params.get("includeClosed") === "true";
  }

  const parsed = parseOr400(listShadowPositionsInputSchema, raw);
  if (!parsed.ok) return parsed.response;

  return NextResponse.json(await listShadowPositions(parsed.data));
}
