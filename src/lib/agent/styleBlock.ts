import type { PromptName } from "@/lib/agent/context";
import { paperPassBrief } from "@/lib/shadow/brief";

/**
 * Non-versioned writing note prepended by `get_prompt` (and the agent HTTP prompt
 * route) for every caller. Stored RuleVersion files are not modified — kernel and
 * parity hashes stay intact.
 */
export function writingStyleBlock(): string {
  return [
    "# Writing for Ivan (server note, applies to every routine)",
    "",
    "Ivan is not a technical reader. Write like a good analyst briefing a busy client.",
    "",
    "Short sentences. Lead with what changed, then what it means, then what Ivan should do.",
    "",
    "In narrative text: no section references (§), no enum codes or field names (write \"still valid\" not `STILL_VALID`, \"test-size position\" not `TEST_STARTER`), no rule ids, no evidence-tier codes. Structured fields (enums, decisionType, reviewStatus) keep their exact values — this rule is only about prose.",
    "",
    "One line per ticker. Skip a section that has nothing new with a single line \"Nothing new.\"",
    "",
    "Round numbers (whole dollars, one decimal for %). No filler, no repeated caveats, no restating the rules.",
    "",
    "Keep required tables, but keep cells short (a few words). Prefer a 3-5 bullet summary over a long paragraph.",
    "",
    "Decision Review narrative fields (reasonForDecision, lessonLearned, etc.) follow the same style; the 7-criteria scorecard line stays exactly as specified.",
  ].join("\n");
}

/**
 * Compose the text `get_prompt` returns: style block first, then the PAPER PASS
 * brief for mcp:shadow callers, then the stored ruleset markdown.
 */
export function composePromptText(
  markdown: string,
  opts: { shadow: boolean; name: PromptName },
): string {
  const style = writingStyleBlock();
  if (opts.shadow) {
    return `${style}\n\n---\n\n${paperPassBrief(opts.name)}\n\n---\n\n${markdown}`;
  }
  return `${style}\n\n---\n\n${markdown}`;
}
