import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import {
  buildAgentContext,
  isAgentRoutine,
  AGENT_ROUTINES,
} from "@/lib/agent/context";
import { resolveShadowCall } from "@/lib/agent/mcp-scope";
import type { DecisionBook } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONTEXT_BUDGET_MS = 20_000;

async function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("context_timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

  const bookParam = req.nextUrl.searchParams.get("book");
  if (bookParam !== null && bookParam !== "REAL" && bookParam !== "PAPER") {
    return NextResponse.json(
      { ok: false, error: "invalid_book", message: "book must be REAL or PAPER" },
      { status: 400 },
    );
  }
  // HTTP AGENT_TOKEN has no scopes → mcp:tools-equivalent: REAL only.
  const resolved = resolveShadowCall(
    { book: bookParam === "REAL" || bookParam === "PAPER" ? bookParam : undefined },
    undefined,
    { bookAware: true },
  );
  if ("__error" in resolved) {
    return NextResponse.json(JSON.parse(resolved.__error) as object, { status: 400 });
  }

  const started = Date.now();
  try {
    const context = await withBudget(
      buildAgentContext(routine, "LIVE", (resolved.book ?? "REAL") as DecisionBook),
      CONTEXT_BUDGET_MS,
    );
    const res = NextResponse.json(context);
    res.headers.set("Server-Timing", `context;dur=${Date.now() - started}`);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "context_failed";
    const status = message === "context_timeout" ? 504 : 500;
    console.error("[agent/context]", message, `elapsed_ms=${Date.now() - started}`);
    return NextResponse.json(
      {
        ok: false,
        error: message === "context_timeout" ? "context_timeout" : "context_failed",
        message:
          message === "context_timeout"
            ? `get_context exceeded ${CONTEXT_BUDGET_MS}ms — retry; if persistent, check Neon compute`
            : "Failed to build agent context",
      },
      { status },
    );
  }
}
