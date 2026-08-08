import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
import { addEvidenceInputSchema } from "@/lib/agent/schemas";
import { addEvidence } from "@/lib/agent/writes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** HTTP mirror of the `add_evidence` MCP tool — append EvidenceItem rows to an existing DR. */
export async function POST(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseOr400(addEvidenceInputSchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await addEvidence(parsed.data);
  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
