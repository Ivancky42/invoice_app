import type { PromptName } from "@/lib/agent/context";

function otherPromptHeader(promptName: PromptName): string {
  return [
    `# PAPER PASS — ${promptName}`,
    "",
    "You are on the mcp:shadow connector. This connector runs paper passes only.",
    "Ivan's real portfolio is not your concern and is not available to you.",
    "",
    "When you call `get_context(..., book=\"PAPER\")`, the positions in that context ARE the paper book under management for that branch. Do not look for a real book.",
    "",
    "For the full two-pass procedure (Pass A = LIVE rules over the LIVE paper book, Pass B = CANDIDATE rules over the CANDIDATE paper book, one combined daily log), read the daily PAPER PASS brief via `get_prompt(name=\"daily\", ...)`.",
    "",
    "Real-book tools (`patch_portfolio`, `upsert_watchlist`, `log_trade`, `list_portfolio`, `list_trades`, and the rest) are not available on this connector; do not try them.",
  ].join("\n");
}

function dailyBrief(): string {
  return [
    "# PAPER PASS",
    "",
    "You are running the PAPER PASS. There are two paper books, one per ruleset. Ivan's real portfolio is not your concern and is not available to you.",
    "",
    "Positions returned by `get_context(..., book=\"PAPER\")` ARE your book. Treat them as the book under management for that pass.",
    "",
    "## Pass A — current rules, LIVE paper book",
    "",
    "1. `get_context(routine=\"daily\", branch=\"LIVE\", book=\"PAPER\")`",
    "2. `get_prompt(name=\"daily\", branch=\"LIVE\")` and `get_prompt(name=\"_shared\", branch=\"LIVE\")`",
    "3. §1 pending review from `list_decision_reviews(branch=\"LIVE\", book=\"PAPER\", reviewStatus=PENDING)`",
    "4. §2 per-ticker pass over the paper positions in that context",
    "5. §6c BUY scan over EVERY watchlist name",
    "",
    "Write `upsert_decision_review(branch=\"LIVE\", book=\"PAPER\", ...)` for each exposure decision (BUY / ADD / AVERAGE_DOWN / REDUCE / EXIT) and for each deliberate WAIT / AVOID / DO_NOT_AVERAGE_DOWN. Every BUY / ADD must carry `convictionScore` (sizing derives from it) and `ticker`.",
    "",
    "## Pass B — new rules, CANDIDATE paper book",
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
    "Real-book tools (`patch_portfolio`, `upsert_watchlist`, `log_trade`, `list_portfolio`, `list_trades`, and the rest) are not available on this connector; do not try them.",
    "",
    "## Finish",
    "",
    "Write ONE `upsert_daily_log(branch=\"CANDIDATE\", ...)` covering both passes: a short table (Book | Decisions | Buys | Sells | Notes) plus one plain-English paragraph per book about what changed and why. Keep it short.",
  ].join("\n");
}

/**
 * Non-versioned header prepended by `get_prompt` for mcp:shadow callers.
 * Stored RuleVersion files are not modified — kernel/parity hashes stay intact.
 */
export function paperPassBrief(promptName: PromptName): string {
  if (promptName === "daily") return dailyBrief();
  return otherPromptHeader(promptName);
}
