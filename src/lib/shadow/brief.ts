import type { PromptName } from "@/lib/agent/context";

export type PaperPassBriefOpts = {
  /** Pass A `get_prompt(branch="LIVE", book="PAPER")` — rules text only, no two-pass procedure. */
  passA?: boolean;
};

function otherPromptHeader(promptName: PromptName): string {
  return [
    `# PAPER PASS — ${promptName}`,
    "",
    "This is a paper pass on the Stock HQ connector. Ivan's real portfolio is not your concern.",
    "",
    "When you call `get_context(..., book=\"PAPER\")`, the positions in that context ARE the paper book under management for that branch. Do not look for a real book.",
    "",
    "For the full two-pass procedure (Pass A first = LIVE rules over the LIVE paper book, then Pass B = CANDIDATE rules over the CANDIDATE paper book, one combined daily log), read `get_prompt(name=\"daily\", branch=\"CANDIDATE\")`.",
    "",
    "Do not call `patch_portfolio`, `upsert_watchlist`, `log_trade`, `list_portfolio`, or `list_trades` during a paper pass.",
  ].join("\n");
}

function passAHeader(promptName: PromptName): string {
  return [
    `# PAPER PASS A — LIVE rules (${promptName}, rules text only)`,
    "",
    "You are on Pass A of the paper test. The markdown below is the LIVE ruleset. It is NOT Ivan's live-advice daily.",
    "",
    "Write every decision as `upsert_decision_review(branch=\"LIVE\", book=\"PAPER\", ...)`. Do not write CANDIDATE reviews in this pass. Do not call real-book tools.",
  ].join("\n");
}

function dailyBrief(): string {
  return [
    "# PAPER PASS",
    "",
    "This is the paper test on the Stock HQ connector. Ivan's real portfolio is not your concern.",
    "",
    "There are two paper books. You MUST finish Pass A before Pass B. Do not write any CANDIDATE decision reviews until LIVE PAPER reviews for today exist.",
    "",
    "`get_context(..., book=\"PAPER\")` positions ARE that branch's paper book. `get_context(branch=\"CANDIDATE\")` also includes `paperBooks` with both books — if you opened CANDIDATE context first, still run Pass A over `paperBooks.LIVE` (call `get_context(branch=\"LIVE\", book=\"PAPER\")` for the full LIVE paper positions).",
    "",
    "## Order of work",
    "",
    "### Pass A — current rules, LIVE paper book (do this first)",
    "",
    "1. `get_context(routine=\"daily\", branch=\"LIVE\", book=\"PAPER\")`",
    "2. `get_prompt(name=\"daily\", branch=\"LIVE\", book=\"PAPER\")` and `get_prompt(name=\"_shared\", branch=\"LIVE\", book=\"PAPER\")`",
    "   Those prompts are LIVE rules text only. They are not Ivan's live-advice daily. Writes stay `branch=\"LIVE\"` `book=\"PAPER\"`.",
    "3. §1 pending review from `list_decision_reviews(branch=\"LIVE\", book=\"PAPER\", reviewStatus=PENDING)`",
    "4. §2 per-ticker pass over EVERY LIVE paper position",
    "5. §6c BUY scan over EVERY watchlist name",
    "",
    "Write `upsert_decision_review(branch=\"LIVE\", book=\"PAPER\", ...)` for each exposure decision (BUY / ADD / AVERAGE_DOWN / REDUCE / EXIT) and for each deliberate WAIT / AVOID / DO_NOT_AVERAGE_DOWN. Every BUY / ADD must carry `convictionScore` (sizing derives from it) and `ticker`.",
    "",
    "Do not start Pass B until LIVE PAPER reviews for today's LIVE paper holdings exist.",
    "",
    "### Pass B — new rules, CANDIDATE paper book",
    "",
    "Repeat identically with `branch=\"CANDIDATE\"`. Re-read `get_prompt(..., branch=\"CANDIDATE\")` for `daily` and `_shared`. Start from the rules as served for this pass; do not carry conclusions, sizes or decisions across from Pass A. If the two rulesets differ, the decisions may legitimately differ.",
    "",
    "## Idle is a decision",
    "",
    "If no BUY qualifies under a ruleset, write WAIT or AVOID decisions for the nearest candidates with the reason. This is how avoided losses get credited.",
    "",
    "## Server rules (fix and resubmit)",
    "",
    "- REDUCE / EXIT / ADD on a ticker the paper book does not hold are rejected.",
    "- BUY on a ticker the paper book already holds is rejected (use ADD).",
    "- BUY / ADD / AVERAGE_DOWN require `convictionScore` (1-5).",
    "",
    "Do not call `patch_portfolio`, `upsert_watchlist`, `log_trade`, `list_portfolio`, or `list_trades` during a paper pass.",
    "",
    "## Finish",
    "",
    "Write ONE `upsert_daily_log(branch=\"CANDIDATE\", ...)` covering both passes: a short table (Book | Decisions | Buys | Sells | Notes) plus one plain-English paragraph per book about what changed and why. Keep it short. The server rejects this log if Pass A (LIVE PAPER reviews for today) is missing.",
  ].join("\n");
}

/**
 * Non-versioned header prepended by `get_prompt` for paper callers
 * (branch=CANDIDATE, or explicit book=PAPER on LIVE for Pass A).
 * Stored RuleVersion files are not modified — kernel/parity hashes stay intact.
 */
export function paperPassBrief(
  promptName: PromptName,
  opts: PaperPassBriefOpts = {},
): string {
  if (opts.passA) return passAHeader(promptName);
  if (promptName === "daily") return dailyBrief();
  return otherPromptHeader(promptName);
}
