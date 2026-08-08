/**
 * One-time seed: legacy pending decisions from pageNotes → DecisionReview rows.
 * Idempotent via idempotencyKey. Safe to re-run.
 *
 * Usage: npx tsx scripts/seed-decision-reviews.ts
 *
 * rulesVersion must be a short git SHA (same as get_context.rulesVersion), never a date.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import { upsertDecisionReview } from "../src/lib/agent/writes";

function resolveRulesVersion(): string {
	const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7);
	if (fromEnv) return fromEnv;
	try {
		return execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
	} catch {
		return "dev";
	}
}

/** Pre-migration decisions lack a §12.4 scorecard — monthly learning loop discounts these. */
const NO_SCORECARD = ["NO_PREREGISTERED_SCORECARD"] as const;

const SEEDS = [
	{
		idempotencyKey: "seed-dr-OKLO-EXIT-20260718",
		title: "OKLO — EXIT test-starter (close below $46)",
		ticker: "OKLO",
		decisionDate: "2026-07-18",
		decisionType: "EXIT" as const,
		positionContext: "PORTFOLIO" as const,
		priceAtDecision: 41.11,
		stopLoss: 48,
		convictionScore: 2,
		reviewStatus: "PENDING" as const,
		reasonForDecision: `Migration seed from portfolio pageNotes. Test-starter EXIT: US close confirmed below $46 stop floor on 2026-07-18 (stop ~$48; close $41.11). Ivan did not execute. Notes subsequently downgraded to STALE_PENDING per §11.8 escalation cap — still requires adaptive reassessment each Daily run, not auto-dismiss. Sleeve: SPECULATIVE. No pre-registered §12.4 scorecard — lessons from this row are lower-confidence.`,
		expectedOutcome: "Exit test-starter position; recycle capital per §12.6.",
		sourceSignal: ["STOP_LOSS", "MIGRATION_SEED"],
		antiPatternTags: [...NO_SCORECARD],
	},
	{
		idempotencyKey: "seed-dr-ISRG-ADD-20260727",
		title: "ISRG — QUALITY REBOUND tranche-1 ADD",
		ticker: "ISRG",
		decisionDate: "2026-07-27",
		decisionType: "ADD" as const,
		positionContext: "PORTFOLIO" as const,
		priceAtDecision: 373,
		stopLoss: 400,
		convictionScore: 4,
		reviewStatus: "PENDING" as const,
		reasonForDecision: `Migration seed from portfolio pageNotes. QUALITY REBOUND pilot (§12.12): tranche-1 ADD suggested after §12.11 stabilization fired 2026-07-27; second trigger 2026-08-03 — close above ~$373 gap midpoint. Staged thirds entry; not yet executed. Sleeve: QUALITY_CORE — $400 stop is advisory review trigger only, not auto-EXIT. Quality rebound checklist used at decision (not 7-criteria momentum scorecard) — lessons from this row are lower-confidence for §12.4.`,
		expectedOutcome: "First third tranche add on QUALITY REBOUND template; confirm before earnings.",
		sourceSignal: ["QUALITY_REBOUND", "STABILIZATION", "MIGRATION_SEED"],
		antiPatternTags: [...NO_SCORECARD],
	},
	{
		idempotencyKey: "seed-dr-BULL-REDUCE-20260802",
		title: "BULL — capital-recycling REDUCE (oversized Speculative)",
		ticker: "BULL",
		decisionDate: "2026-08-02",
		decisionType: "REDUCE" as const,
		positionContext: "PORTFOLIO" as const,
		priceAtDecision: 7.06,
		convictionScore: 2,
		reviewStatus: "PENDING" as const,
		reasonForDecision: `Migration seed from Weekly report 2026-08-02. Capital-recycling REDUCE: position ~14% of book vs 2–3% SPECULATIVE test-starter cap (§7 / §12.13); price at decision $7.06. Trim suggested to fund higher-conviction setups; Ivan has not executed. Sleeve: SPECULATIVE. No pre-registered §12.4 scorecard — lessons from this row are lower-confidence.`,
		expectedOutcome: "Partial trim toward test-starter band; name funding source for new signals if needed.",
		sourceSignal: ["CAPITAL_RECYCLING", "WEEKLY_REPORT", "MIGRATION_SEED"],
		antiPatternTags: [...NO_SCORECARD],
	},
];

async function main() {
	const rulesVersion = resolveRulesVersion();
	console.log(`rulesVersion: ${rulesVersion}`);

	const before = await prisma.decisionReview.count();
	console.log(`Decision reviews before: ${before}`);

	for (const seed of SEEDS) {
		const result = await upsertDecisionReview({
			...seed,
			rulesVersion,
		});
		if (!result.ok) {
			throw new Error(
				`${seed.ticker} ${seed.decisionType}: evidence_insufficient — ${JSON.stringify(result.failures)}`,
			);
		}
		console.log(
			`${seed.ticker} ${seed.decisionType}:`,
			result.idempotentReplay ? "already seeded (updated)" : "created",
			result.decision.id,
		);
	}

	const pending = await prisma.decisionReview.findMany({
		where: { reviewStatus: "PENDING" },
		orderBy: { decisionDate: "asc" },
		select: {
			ticker: true,
			decisionType: true,
			decisionDate: true,
			priceAtDecision: true,
			convictionScore: true,
			rulesVersion: true,
			antiPatternTags: true,
			title: true,
			idempotencyKey: true,
		},
	});
	console.log("\nPending after seed:", pending.length);
	for (const row of pending) {
		console.log(
			`  ${row.ticker} ${row.decisionType} ${row.decisionDate?.toISOString().slice(0, 10)} @$${row.priceAtDecision} conv=${row.convictionScore} rv=${row.rulesVersion} tags=${row.antiPatternTags.join(",")}`,
		);
	}
}

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
