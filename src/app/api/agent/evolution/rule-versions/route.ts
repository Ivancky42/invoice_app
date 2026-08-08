import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { parseOr400 } from "@/lib/agent/http";
import { listRuleVersionsInputSchema } from "@/lib/agent/schemas";
import { listRuleVersions } from "@/lib/evolution/read";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = parseOr400(listRuleVersionsInputSchema, raw);
  if (!parsed.ok) return parsed.response;

  return NextResponse.json(await listRuleVersions(parsed.data));
}
