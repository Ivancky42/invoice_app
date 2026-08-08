import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { parseOr400 } from "@/lib/agent/http";
import { getRuleVersionInputSchema } from "@/lib/agent/schemas";
import { getRuleVersion } from "@/lib/evolution/read";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Metadata only — prompt text is never served from here (see src/lib/evolution/read.ts). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const parsed = parseOr400(getRuleVersionInputSchema, await params);
  if (!parsed.ok) return parsed.response;

  const result = await getRuleVersion(parsed.data.id);
  if (!result.ok) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}
