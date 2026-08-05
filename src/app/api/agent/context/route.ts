import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import {
  buildAgentContext,
  isAgentRoutine,
  AGENT_ROUTINES,
} from "@/lib/agent/context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const routine = req.nextUrl.searchParams.get("routine")?.trim() ?? "";
  if (!isAgentRoutine(routine)) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_routine",
        message: `routine must be one of: ${AGENT_ROUTINES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const context = await buildAgentContext(routine);
  return NextResponse.json(context);
}
