import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAppOrigin } from "@/lib/agent/mcp-oauth";
import { authorized } from "@/lib/cron/auth";
import { CRON_JOBS } from "@/lib/cron/jobs";
import { runTick } from "@/lib/cron/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;

  const only = params.get("only")?.trim() || null;
  if (only && !CRON_JOBS.some((j) => j.job === only)) {
    return NextResponse.json({ ok: false, error: `unknown job: ${only}` }, { status: 400 });
  }

  const rawChain = params.get("chain")?.trim();
  let chain = 0;
  if (rawChain) {
    const parsed = Number(rawChain);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return NextResponse.json({ ok: false, error: "invalid chain" }, { status: 400 });
    }
    chain = parsed;
  }

  const result = await runTick({
    origin: getAppOrigin(req),
    only,
    force: params.get("force") === "1",
    chain,
  });

  return NextResponse.json(result, { status: 200 });
}
