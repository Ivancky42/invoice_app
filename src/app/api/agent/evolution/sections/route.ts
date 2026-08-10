import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { parseOr400 } from "@/lib/agent/http";
import { listRuleSectionsInputSchema } from "@/lib/agent/schemas";
import { listRuleSections } from "@/lib/evolution/read";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Section ids + sha256 digests for the branch's running ruleset (no prompt body). */
export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const raw = {
    branch: req.nextUrl.searchParams.get("branch") ?? undefined,
    file: req.nextUrl.searchParams.get("file") ?? undefined,
  };
  const parsed = parseOr400(listRuleSectionsInputSchema, raw);
  if (!parsed.ok) return parsed.response;

  const result = await listRuleSections(parsed.data);
  if (!result.ok) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}
