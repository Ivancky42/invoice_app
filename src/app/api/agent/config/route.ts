import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import { getAllConfig } from "@/lib/agent/context";
import { readJsonBody, parseOr400 } from "@/lib/agent/http";
import { patchConfigInputSchema } from "@/lib/agent/schemas";
import { patchConfig } from "@/lib/agent/writes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;
  return NextResponse.json(await getAllConfig());
}

/**
 * PATCH safe Config keys: cash, FX, thresholds, tracked tickers, LIMITS.
 * LIMITS changes hard caps — allowed but intentional. Never prompts.
 */
export async function PATCH(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const body = await readJsonBody(req);
  if (body === null) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseOr400(patchConfigInputSchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await patchConfig(parsed.data);
  if (!result.ok) {
    // Refused before anything was written (e.g. kernel-invalid ACTIVE ruleset).
    return NextResponse.json(result, { status: result.status });
  }
  const config = await getAllConfig();
  return NextResponse.json({ ...result, config });
}
