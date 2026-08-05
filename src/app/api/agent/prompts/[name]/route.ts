import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import {
  getPromptMarkdown,
  isPromptName,
  PROMPT_NAMES,
} from "@/lib/agent/context";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Params = { params: Promise<{ name: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const unauthorized = requireAgentToken(req);
  if (unauthorized) return unauthorized;

  const { name: raw } = await params;
  // Reject path traversal / unexpected chars; allowlist only.
  if (!isPromptName(raw)) {
    return NextResponse.json(
      {
        ok: false,
        error: "not_found",
        message: `Prompt must be one of: ${PROMPT_NAMES.join(", ")}`,
      },
      { status: 404 },
    );
  }

  try {
    const markdown = await getPromptMarkdown(raw);
    return new NextResponse(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "not_found", message: `Prompt file missing: ${raw}` },
      { status: 404 },
    );
  }
}
