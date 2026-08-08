import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAgentToken } from "@/lib/agent/auth";
import {
  getPromptMarkdown,
  isPromptName,
  PROMPT_NAMES,
} from "@/lib/agent/context";
import { getRuleSet, readDiskRuleFiles, sha256Hex } from "@/lib/rules/resolve";
import type { Branch } from "@/generated/prisma/client";

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

  const branchParam = req.nextUrl.searchParams.get("branch");
  if (branchParam !== null && branchParam !== "LIVE" && branchParam !== "CANDIDATE") {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "branch must be LIVE or CANDIDATE" },
      { status: 400 },
    );
  }
  const branch: Branch = branchParam === "CANDIDATE" ? "CANDIDATE" : "LIVE";

  try {
    // Parity check: compare the stored ruleset text against the committed file.
    if (req.nextUrl.searchParams.get("diff") === "1") {
      const [ruleSet, diskFiles] = await Promise.all([
        getRuleSet(branch),
        readDiskRuleFiles(),
      ]);
      const dbText = ruleSet.files[`${raw}.md`] ?? null;
      const diskText = diskFiles[`${raw}.md`] ?? null;
      const dbSha = dbText === null ? null : sha256Hex(dbText);
      const diskSha = diskText === null ? null : sha256Hex(diskText);
      return NextResponse.json({
        ok: true,
        branch,
        versionId: ruleSet.versionId,
        degraded: ruleSet.degraded,
        dbSha,
        diskSha,
        identical: dbSha !== null && dbSha === diskSha,
      });
    }

    const markdown = await getPromptMarkdown(raw, branch);
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
