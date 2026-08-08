/**
 * Best-effort mirror of a RuleVersion's prompt files to a git branch, so a promoted
 * ruleset is readable/diffable outside the database.
 *
 * Writes ONLY to the `rules-mirror` branch — never `main`, because a push to main would
 * trigger a production deploy. Unconfigured or failing mirrors never break the caller.
 */
import { prisma } from "@/lib/prisma";

const MIRROR_BRANCH = "rules-mirror";
const API = "https://api.github.com";

export type MirrorResult = { ok: boolean; skipped?: string; error?: string };

type FileEntry = { path: string; content: string };

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/** Existing blob sha for a path on the mirror branch, or null when absent. */
async function existingSha(
  repo: string,
  token: string,
  path: string,
): Promise<string | null> {
  const res = await fetch(
    `${API}/repos/${repo}/contents/${encodeURI(path)}?ref=${MIRROR_BRANCH}`,
    { headers: ghHeaders(token), cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET contents ${path}: ${res.status}`);
  const body = (await res.json()) as { sha?: string };
  return typeof body.sha === "string" ? body.sha : null;
}

async function putFile(
  repo: string,
  token: string,
  entry: FileEntry,
  message: string,
): Promise<void> {
  const sha = await existingSha(repo, token, entry.path);
  const res = await fetch(`${API}/repos/${repo}/contents/${encodeURI(entry.path)}`, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify({
      message,
      content: Buffer.from(entry.content, "utf8").toString("base64"),
      branch: MIRROR_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`PUT contents ${entry.path}: ${res.status}`);
  }
}

/**
 * Mirror one RuleVersion's prompt files to `prompts/` on the mirror branch.
 * Never throws — returns `{ ok: false, error }` instead.
 */
export async function mirrorRuleVersion(versionId: number): Promise<MirrorResult> {
  const repo = process.env.RULES_MIRROR_REPO?.trim();
  const token = process.env.RULES_MIRROR_TOKEN?.trim();
  if (!repo || !token) return { ok: true, skipped: "unconfigured" };

  try {
    const row = await prisma.ruleVersion.findUnique({ where: { id: versionId } });
    if (!row) return { ok: false, error: `rule version ${versionId} not found` };

    const files = row.files;
    if (!files || typeof files !== "object" || Array.isArray(files)) {
      return { ok: false, error: `rule version ${versionId} has no files map` };
    }

    const entries: FileEntry[] = Object.entries(files as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === "string")
      .map(([name, content]) => ({ path: `prompts/${name}`, content }));

    const message = `rules: version ${versionId}`;
    // Sequential: the Contents API serialises commits on a branch anyway.
    for (const entry of entries) {
      await putFile(repo, token, entry, message);
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : "mirror_failed";
    console.error("[rules mirrorRuleVersion]", versionId, error);
    return { ok: false, error };
  }
}
