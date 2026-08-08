# Stock HQ — Shadow Ledger & Autonomous Evolution

**Status:** built on `feat/shadow-evolution` (9 commits landed before this doc). Local DB
only — production Neon untouched until deployed per `docs/SHADOW_EVOLUTION_RUNBOOK.md`.

This is the as-built spec for the shadow-ledger + rule-evolution system: a paper-only
portfolio with independent accounting, a signed fitness function, and an evolution engine
that proposes, shadow-tests, promotes, and reverts rule versions — with promotion held
server-side so no agent can ever promote its own change.

---

## 1. Context

Stock HQ is a decision-support system: Cowork routines read state via MCP tools, reason
against markdown rules in `/prompts`, and write decisions to Neon. Ivan executes all real
trades himself in his own broker; no code path places an order, and nothing in this build
changes that (`prompts/_shared.md` §5, kernel-pinned — see §3 below).

Before this build the system could not learn:

- Rules lived only in git — no automated loop could change them.
- There was no usable fitness signal: scoring the real book scores Ivan's follow-through
  on a suggestion, not the suggestion itself, and an avoided loss realised as literally
  $0 of P&L, so caution and cowardice looked identical.
- There was no price history: `Portfolio.currentPrice` was overwritten on every sync, so
  nothing could be replayed or backtested.

This build closes the loop with four new subsystems: a nightly `PriceHistory` store that
also serves as the trading-session calendar, a paper-only shadow ledger with independent
LIVE and CANDIDATE books, a fitness function with a **signed** avoided-loss credit, and an
evolution engine that proposes, shadow-tests, promotes, and reverts `RuleVersion` rows.

---

## 2. Architecture

### 2.1 Cron dispatcher (`src/lib/cron/`)

`src/app/api/cron/tick/route.ts` is the single Vercel Cron entry point
(`maxDuration = 300`, soft budget 240s). `src/lib/cron/runner.ts` claims a per-day lease
row (`JobRun` with `job = "__tick"`, an atomic `INSERT ... ON CONFLICT` that only steals a
stale or finished lease) and runs `src/lib/cron/jobs.ts`'s ordered `CRON_JOBS` registry —
12 jobs, each declaring `cadence` (`daily` / `monthly`) and `dependsOn`. A job whose
dependency did not `SUCCESS` today is recorded `SKIPPED` with the unmet dependency named;
nothing runs on stale upstream data.

If the wall-clock budget runs out mid-registry, or a job returns `{ done: false, cursor }`
to ask for more time, the tick self-chains via `waitUntil(fetch(".../tick?chain=n+1", {
headers: Authorization: Bearer CRON_SECRET }))`, capped at 5 chains per run day
(`MAX_CHAIN`). Chaining is **best-effort**: it needs `CRON_SECRET` (or `SYNC_SECRET`) to be
set, and a failed chain fetch is logged into the tick's own `JobRun.detail.chainOutcome`
rather than retried.

Job order (dependencies in parens):

1. `price_sync` — existing Finnhub/EODHD sync, unchanged behaviour.
2. `portfolio_snapshot` (`price_sync`) — existing snapshot job.
3. `price_history` (`price_sync`) — nightly `PriceHistory` bars.
4. `breadth_classify` (`price_history`) — per-decision `moveClass` attribution.
5. `shadow_fill` (`price_history`) — fills PENDING orders at next session's open.
6. `shadow_enqueue` (`shadow_fill`) — turns today's Decision Reviews into `ShadowOrder`
   rows. Runs **after** fill on purpose (see the ordering comment in `jobs.ts`): an order
   enqueued tonight cannot fill tonight anyway, and enqueuing first made yesterday's fill
   invisible to today's exit logic.
7. `shadow_mark` (`shadow_fill`) — marks open positions at the session close.
8. `decision_returns` (`price_history`) — 1w/4w/3m returns on Decision Review rows.
9. `counterfactual_resolve` (`price_history`, `shadow_mark`) — resolves signed credit for
   refused decisions.
10. `fitness_snapshot` (`shadow_mark`, `counterfactual_resolve`) — writes the day's
    `FitnessSnapshot` for both branches.
11. `evolution_evaluate` (`fitness_snapshot`, daily) — the **only** code path that can
    promote, revert, or kill a ruleset.
12. `rule_scoring` (monthly, no same-day dependency) — HELPED/NEUTRAL/HURT verdicts on
    versions whose paired series has settled.

### 2.2 Session calendar & price history (`src/lib/pricehistory/`, `src/lib/shadow/sessions.ts`)

`PriceHistory` **is** the calendar — there is no holiday table. A UTC date counts as a
trading session when at least 2 of 4 anchor tickers (`SPY`, `QQQ`, `AAPL`, `MSFT`, always
force-included in the nightly universe) have a bar for it. `src/lib/shadow/sessions.ts` is
pure (no Prisma at the algorithm layer) and exposes binary-search helpers over the
ascending session list: `latestSessionOnOrBeforeIn`, `nextSessionAfterIn`,
`decisionSessionFromEasternDate`.

`decisionSession` is derived from a Decision Review's **`decisionDate` when set**, else
from the US-Eastern calendar date of `createdAt`. Notion-synced and agent-written rows
carry an explicit calendar `decisionDate` (stored as UTC midnight or noon) — using that
date's `ymd` avoids collapsing a backfill onto the sync day. When `decisionDate` is null
(live routines that omitted it), fall back to Eastern `createdAt`: routines run after the
US close, so the freshest bars the agent could have seen belong to that session (a
20:00 ET write is already the next UTC day, so a naive UTC lookup would credit a session
that has not happened yet). Never run Notion midnight-UTC `decisionDate` values through
Eastern conversion — that would shift them back a calendar day.

Per-consumer missing-data policy: a fill that cannot find its scheduled open stays
`PENDING` and is `REJECTED` after 3 sessions; a mark that finds no bar carries the prior
mark forward and is flagged `DEGRADED` once >20% of a branch's open positions are stale;
the sequential z-test (§4) drops `DEGRADED` sessions entirely; the benchmark (CSPX) carries
forward for up to 3 sessions before a fitness snapshot is written `quality: null` rather
than guessed.

`scripts/backfill-price-history.ts` bulk-loads ~400 days per ticker from EODHD with a
per-ticker `stooq` fallback on provider error, and prints a coverage table
(`ticker | provider | rows | firstDate | lastDate | error`), exiting non-zero if any
ticker ended in error — this is how the EODHD US-equity tier question gets answered (see
§6).

### 2.3 Rules in the database (`src/lib/rules/`)

`getRuleSet(branch)` (`src/lib/rules/resolve.ts`) resolves LIVE to the current `ACTIVE`
`RuleVersion` and CANDIDATE to whatever `ShadowBranch.CANDIDATE.ruleVersionId` points at —
**provided that pointer is a legitimate challenger** (§2.4). Results are cached 60s per
branch. On any DB failure, or when the resolved ruleset fails the kernel gate, resolution
falls back to the on-disk `/prompts/*.md` files with `degraded: true` rather than throwing
or serving corrupted prose — a routine must never stop because Neon hiccuped.

`RuleVersion.id 1` is lazily seeded by `ensureRuleVersion1()` the first time no
`RuleVersion` row exists: it reads the five committed prompt files plus live
`Config.LIMITS`, validates the kernel, and creates an `ACTIVE`/`HUMAN` row. The seed is an
upsert-style create-if-missing (no `P2002` catch anywhere in this codebase, matching the
`ensureContentPages()` precedent) — it never clobbers an existing ruleset. **This means
`Config.LIMITS` must already exist before the first read in a fresh environment**, or v1
seeds with `DEFAULT_LIMITS` instead of the live caps (see the runbook).

8 numeric parameters are extracted from prose into `RuleVersion.limits` (`LimitsConfig`),
parsed by `parseLimits` with a per-key fallback so a partially-written limits blob degrades
one field at a time rather than failing whole.

`scripts/verify-rule-parity.ts` asserts the `ACTIVE` version's stored file text is
byte-identical (sha256) to the committed `/prompts/*.md` files — the parity check for "did
someone edit the DB out from under git, or git out from under the DB". A promoted
`RuleVersion` is also mirrored (best-effort, via the GitHub Contents API) to a
`rules-mirror` branch — **never `main`**, since a push to `main` would trigger a prod
deploy (`src/lib/rules/gitMirror.ts`).

### 2.4 Challenger resolution — pointer-as-truth (`src/lib/rules/challenger.ts`)

**Delta from the original plan:** the plan assumed the CANDIDATE branch could be resolved
by `RuleVersion.status === "CANDIDATE"`. That degenerates: after a promotion, the deposed
champion keeps running on the challenger book so the new rules must beat the rules they
replaced (the **revert series**), but the deposed champion's status is `RETIRED`, not
`CANDIDATE`. Keying off status made the revert series permanently unreachable —
`getRuleSet("CANDIDATE")` fell back to ACTIVE, `evolution_evaluate` skipped every day with
`no_candidate`, and `ensureShadowBranches` reconciled the pointer back to ACTIVE on the
next tick, erasing the series before it produced one paired session.

The fix: `ShadowBranch.CANDIDATE.ruleVersionId` is the **pointer-as-truth**. A single pure
predicate, `challengerLegitimacy(target, active)`, is shared by `getRuleSet`,
`ensureShadowBranches`, and `evolution_evaluate` — the same three call sites that used to
each re-derive the answer independently and disagree. A target is legitimate iff it is
either a status-`CANDIDATE` row (a live experiment) or a `RETIRED` row that is exactly
`active.parentId` (the immediately-deposed champion, and nothing older). Anything else —
missing, `KILLED`, a stale `RETIRED` from an earlier generation — is illegitimate and the
caller falls back to (or reconciles to) `ACTIVE`. **Single challenger is enforced in code
across every lane by this one predicate** — there is no path that lets two candidates run
concurrently on the CANDIDATE book.

### 2.5 Kernel (`src/lib/rules/kernel.ts`, `src/lib/rules/kernelClauses.ts`)

Five HTML-comment-fenced regions in `prompts/_shared.md`
(`<!-- KERNEL:BEGIN id=… v=1 --> ... <!-- KERNEL:END id=… -->`) are immutable at the prose
layer: `price-provenance`, `execution-boundary`, `fitness-definition`,
`reversion-mechanism`, `audit-append-only`. Their canonical sha256 hashes are a
**checked-in TypeScript constant**, `KERNEL_CLAUSES` in `src/lib/rules/kernelClauses.ts`,
generated by `npx tsx scripts/print-kernel-hashes.ts --emit` — changing a kernel clause
therefore requires a human commit + deploy, not a database write. `validateKernel()`
diffs a candidate file set against the pinned canonical text (fence-content only, markers
excluded) and returns violations; `kernelGate()` wraps that into the ok/refuse decision
used by `getRuleSet`, `ensureRuleVersion1`, `apply_gap_fix`, and `propose_rule_change`.

Outside the fences, `scanForbiddenPatterns` runs a regex sweep for language that would
imply real execution, and `changedLinesInside` (an LCS diff) enforces the per-lane diff
budget: **zero** changed lines inside any fence ever; **≤120** changed lines for a SLOW
(prose) proposal; **≤40** for a gap-fix. A proposal that touches a fence is rejected
outright and logged as `KERNEL_ATTEMPT` — not silently dropped, not partially applied.

A tool-name snapshot test (part of the MCP registration test suite) asserts nothing
registered on the MCP server matches `/order|execute|broker|place/` — the execution
boundary is enforced twice, once in prose (kernel-pinned) and once at the tool-surface
level.

### 2.6 Shadow ledger (`src/lib/shadow/`)

Two independent `ShadowBranch` rows, `LIVE` and `CANDIDATE`, each with its own `cash`,
`startNav` (`SHADOW_INITIAL_NAV = 100_000`), and `highWaterNav`. Nothing in
`src/lib/shadow/` or `src/lib/fitness/` reads `Portfolio`, `Trade`, or `Config.CASH_*` —
the paper book is accounting-isolated from the real one by construction (verified by
grepping those modules for the real-book model names).

- `shadow_enqueue` (`src/lib/shadow/enqueue.ts`) turns a Decision Review into a
  `ShadowOrder` per branch, sized by `permittedSize` (§4) for the branch's own ruleset.
- `shadow_fill` (`src/lib/shadow/fill.ts`) fills a `PENDING` order at the **next session's
  `PriceHistory.open`**, never same-session and never at a close — `fillSession >
  decisionSession` is enforced structurally, closing the "traded on a price it could not
  have known yet" hole.
- `shadow_mark` (`src/lib/shadow/mark.ts`) marks every open `ShadowPosition` at the
  session's close, carrying the prior mark forward (flagged `markStale`) when a bar is
  missing.
- `src/lib/shadow/branches.ts` also owns `resetBranch(branch, ruleVersionId)`: closes every
  open position, rejects pending orders (`branch_reset`), and restarts the book at
  `SHADOW_INITIAL_NAV` under the new ruleset. Used on every promotion and every kill —
  a challenger's book, win or lose, never carries positions or drawdown history into the
  next experiment.

### 2.7 Fitness (`src/lib/fitness/`)

`src/lib/fitness/math.ts` is pure — zero Prisma imports, fractions throughout (`0.03` =
3%, never a `Pct`-suffixed field; the one fraction→percentage-point conversion in the
codebase is `src/lib/shadow/decisionReturns.ts`, and it is never imported here). See §5 for
the formulas. `src/lib/fitness/snapshot.ts` is the daily job that reads both branches'
marked books, resolved counterfactuals, and turnover, and writes one `FitnessSnapshot` row
per branch per session with a `quality` (`OK` / `DEGRADED` / `null`).
`src/lib/fitness/counterfactuals.ts` seeds a `Counterfactual` row **per horizon** (21
interim + 63 full quarter) for every AVOID / WAIT / DO_NOT_AVERAGE_DOWN decision (a WAIT
on an already-held position is treated as HOLD, not a counterfactual — there is nothing
declined). Interim credit enters fitness ~3 weeks after the decision; the 63-session row
stores the residual vs already-recognized shorter credits so lifetime Σ equals the quarter
measure. `src/lib/fitness/breadthClassify.ts` computes `MoveClass` per decision.
`evolution_evaluate` additionally refuses **promotion** until ≥20 RESOLVED interim (21-session)
counterfactuals have non-zero signed credit (`counterfactual_credit_gate`); kills/reverts still
run. Keep `EVOLUTION_PROMOTE=0` as the ops kill switch. CANDIDATE Cowork connectors must
authorize with `mcp:shadow` — real-book writes are refused server-side.

### 2.8 Evolution engine (`src/lib/evolution/`)

- `src/lib/evolution/parameters.ts` — the **complete** registry of every numeric leaf in
  `LimitsConfig`, `LIMITS_PARAMS`, each entry carrying a `hardRange`, a
  `looseningDirection`, and a `lane` (`FAST` / `SLOW`). A limits pointer with no registry
  entry is refused outright (`unknown_limits_path`) — this closes the hole where an
  unregistered pointer (e.g. `/tierBands/TEST_STARTER/0 = 0.9`) could sail past every rail
  and land in `Config.LIMITS` on promotion. **The registry is complete including the
  SLOW-lane rails** — tier-band floors, `entryZoneWidthPct`, `themeBreadthThreshold`,
  `excessMoveIdiosyncratic` — registered so they are range-checked even though they cannot
  take the fast lane. `parameters.test.ts` asserts completeness against `DEFAULT_LIMITS` so
  a newly-added limits key cannot silently reopen the gap.
- `src/lib/evolution/eligibility.ts` — pure evidence-bar checks (§6 of this doc has the
  exact thresholds); every rejection code is unit-tested independently.
- `src/lib/evolution/propose.ts` — `propose_rule_change`. Gate order: structural checks →
  **kernel** → per-parameter drift guard → eligibility → row creation. A supplied `lane` is
  stripped and recorded as `laneClaimIgnored`; the server assigns FAST only when every
  touched limits pointer is FAST-lane and no prose hunk is included.
- `src/lib/evolution/gapfix.ts` — `apply_gap_fix`: immediate, section-scoped, ≤40 changed
  lines, `expectedSectionSha` required (409 on mismatch). An in-flight CANDIDATE touching
  the same section is rebased onto the gap-fixed prose, or killed if the rebase is not
  clean. **Gap-fix versions carry no experimental provenance** — no `reasoningPattern`, no
  `successMetric`, no lane, no evidence citations — because a gap-fix is a correction to
  the ACTIVE ruleset's prose, not a hypothesis under shadow test.
- `src/lib/evolution/evaluate.ts` — `evolution_evaluate`, the sole promotion path (§4).
- `src/lib/evolution/scoring.ts` — `score_rule_version` / monthly `rule_scoring` (§4/§6).
- `src/lib/evolution/log.ts` — `appendEvolutionEvent`, the single chokepoint every writer
  in this subsystem goes through; `EvolutionEvent` rows are enforced append-only by a raw
  Postgres `RULE` (no `UPDATE`/`DELETE`), not just application discipline.

### 2.9 Evidence (`src/lib/evidence/`)

`checkEvidence()` (`src/lib/evidence/rules.ts`) is pure and mirrors `logTrade`'s
soft-warning / hard-reject shape. `EVIDENCE_ENFORCEMENT` (env, default `warn`) decides
whether its codes land in `warnings[]` (write proceeds) or `failures[]` (write is
rejected, `evidence_insufficient`) — except `STALE_EVIDENCE`, which is always a warning
even in `strict` mode, because a satisfied-but-aging requirement is not the same failure
as an unsatisfied one.

**Delta from the original plan — evidence tiers were derived, not copied from prose.** The
plan assumed `_shared.md` §9 defined evidence-source tiers (T1..T4). It does not: §9
("Signal tiers") defines BUY-**signal** tranches (Standard / EARLY ENTRY / QUALITY
REBOUND) — there is no literal T1–T4 evidence-strength prose anywhere in the committed
prompts. The `EvidenceTier` / `EvidenceKind` enums and the tier semantics were instead
derived from the one place the concept already existed in code — the
`hasTier12Evidence` parameter at the `classifyMove` call site (`src/lib/fitness/math.ts`
/ `breadthClassify.ts`) — and documented as a convention on the Prisma enums:

| Tier | Meaning | Example kinds |
|---|---|---|
| T1 | Primary source | Filing, earnings call, management guidance |
| T2 | Primary data / credible secondary reporting on a T1 event | Analyst note quoting a filing, credible outlet reporting guidance |
| T3 | Social sentiment | Reddit/Stocktwits/X discussion |
| T4 | Weakest — never sufficient alone | `PRICE_ACTION`, `INFERENCE` |

`PRICE_ACTION` and `INFERENCE` are **excluded kinds**: they satisfy no tier requirement at
any nominal tier, so an item mis-tagged T1/PRICE_ACTION still contributes nothing. An
exposure-changing decision (BUY/ADD/REDUCE/EXIT/etc.) needs ≥1 T1/T2 item; a thesis-state
change needs ≥1 T1 item specifically; a `MARKET_MOVE`-attributed name needs a fresh T1/T2
item post-dating the move before its thesis state can change on that move alone.

### 2.10 Known seeding gap: DecisionReview has no sleeve

`permittedSize()` (§5) applies a `SPECULATIVE`-sleeve cap when `sleeve` is known, but
`DecisionReview` — the row the shadow ledger and counterfactual engine read a decision
from — has no `sleeve` column. In practice this means the speculative-sleeve cap inside
`permittedSize` is **inert in seeding**: every counterfactual and shadow order is sized as
if `sleeve` were unset, so the sleeve cap never actually binds a paper fill or a
counterfactual credit today. This is a known, accepted gap (not a bug) — see §7.

---

## 3. The kernel

Five clauses, fenced in `prompts/_shared.md`, pinned by sha256 in
`src/lib/rules/kernelClauses.ts`:

| id | Section | What it locks |
|---|---|---|
| `price-provenance` | §3 | Marks are last-close, not intraday; stale-sync handling |
| `execution-boundary` | §5 | No code path ever places, executes, routes, or simulates a real trade; a BUY signal is a suggestion |
| `fitness-definition` | §17 | The exact fitness formula (§5 below) — components cannot be redefined, reweighted, clamped, or dropped |
| `reversion-mechanism` | §18 | 25% drawdown from high-water mark hard-reverts, evaluated first, never deferred |
| `audit-append-only` | §19 | `EvolutionEvent` rows are never updated, deleted, or back-dated |

Changing any of these five requires editing the fence text in git, regenerating
`kernelClauses.ts` via `scripts/print-kernel-hashes.ts --emit`, and deploying — there is no
database path to a kernel change. This is enforced structurally (`validateKernel`), not by
policy: any attempted edit inside a fence, by any tool, is rejected and the attempt itself
is appended to `EvolutionEvent` as `KERNEL_ATTEMPT`.

---

## 4. The fitness function

All quantities are **fractions of NAV** (`0.03` = 3%), never percentage points, per the
kernel `fitness-definition` clause.

```
fitness = shadowReturn + avoidedLossCredit − drawdownPenalty − turnoverCost − benchmarkReturn
```

- `shadowReturn` — the branch's own paper-ledger return over the window.
- `benchmarkReturn` — CSPX over the same window; subtracted so this is **excess** fitness
  (a branch up 3% while CSPX is up 5% scores negative).
- `avoidedLossCredit` — **signed**, from `counterfactualCredit`:

  ```
  credit = −horizonReturn × permittedSize
  ```

  Refusing a name that then fell **credits** the branch (positive); refusing a name that
  then rose **debits** it (negative). The sign is the entire point: an unsigned
  `max(0, …)` credit would make "avoid everything" a free lunch, so evolution would drift
  towards blanket caution and the ruleset would stop buying. Scoring on discrimination
  (avoiding the *right* names), not on volume of refusals, requires the debit side.
- `permittedSize` — the fraction of NAV the branch's own ruleset would have allowed, using
  headroom (`cap − currentWeight`), matching how a real buy is sized. `DO_NOT_AVERAGE_DOWN`
  is sized as the incremental **add** it refused (`CONFIRMATION` band top minus current
  weight), not as a fresh position — sizing it as a full position would roughly triple
  every DNAD credit and debit and let one decision type dominate the fitness signal.
- `drawdownPenalty` / `turnoverCost` — always subtracted, never floored to zero by a rule
  change.

**Sequential test** (`sequentialZ`): the z-score of a candidate's edge is computed from
**per-session increments** (`candidate.fitnessIncrement − live.fitnessIncrement` for every
session both branches produced an `OK` snapshot), not from differencing a rolling window —
differencing a 30-session rolling level would overlap 29 of 30 observations between
consecutive points, understating the standard error by roughly √30 and manufacturing
significance. `n < 2` or a degenerate (zero) standard error → `z = null`, which can never
promote.

**Verdict precedence** (`evaluateCandidate`), fixed and deliberate:

```
HARD_REVERT → EARLY_KILL → PROMOTE → INCONCLUSIVE → CONTINUE
```

1. `HARD_REVERT` — the branch under test has drawn down >25% from its own high-water mark.
   Checked **first**, beats a glowing z-score outright: the kernel `reversion-mechanism`
   clause requires this precedence and it cannot be reordered by any rule change.
2. `EARLY_KILL` — ≥10 sessions and `z ≤ −1.5`: the candidate is losing badly enough to stop
   early rather than exhaust the evidence horizon.
3. `PROMOTE` — `z ≥ 2.0` **and** the lane's minimum evidence is met (`FAST`: 10
   sessions/10 decisions; `SLOW`: 30 sessions/20 decisions) **and** the candidate's max
   drawdown is within `max(live's drawdown × 1.25, 5% floor)` **and** fewer than 8
   promotions have occurred in the trailing 90 days.
4. `INCONCLUSIVE` — ≥60 sessions with no promote/revert signal; the experiment is stale.
5. `CONTINUE` — the steady state; keep collecting evidence.

**Promotion is one transaction** (`promote()` in `evolution/evaluate.ts`): retire the
incumbent (partial unique index allows exactly one `ACTIVE` row), activate the candidate,
and write `Config.LIMITS = candidate.limits` — all inside the same `$transaction`. This is
the **one real-money-adjacent consequence** in the whole system: `logTrade` enforces
`Config.LIMITS` on the real book while planning reads the versioned ruleset's limits, so
desyncing the two would let a promoted ruleset plan to caps `log_trade` does not honour.
The move is bounded three separate ways before it can ever reach this transaction: the
`LIMITS_PARAMS` hard ranges, the 90-day/v1 drift rails plus the consecutive-loosening
ratchet at propose time, and the 8-promotions-per-90-days rail inside
`evaluateCandidate` itself.

**Deposed-champion mechanics:** after a promotion, `resetBranch("CANDIDATE",
isRevert ? candidateId : activeId)` re-points the challenger book at the version the new
incumbent just deposed — the new champion has to beat what it replaced, not coast. A
`REVERT` (the deposed champion winning its own revert series) is **not** a separate
mechanism: it is `PROMOTE` again, `isRevert = candidateId === active.parentId`, same
transaction, same `PROMOTE` event kind — only the detail records `revert: true`. After a
revert there is nothing left to re-litigate (the loser that just lost was already the
challenger's challenger), so the challenger book goes **idle** on the new incumbent
instead of starting a third round of the same duel.

**EARLY_KILL / INCONCLUSIVE / a lost revert series** all end the same way: the challenger
stops trading and its book is reset under the incumbent. Only a status-`CANDIDATE` row is
marked `KILLED` — a deposed champion that loses its revert series was a legitimate ruleset
that already retired honestly, and stays `RETIRED`.

---

## 5. The evolution loop

**Propose → shadow-test → promote/revert.**

1. **Propose** (`propose_rule_change`) — an agent submits prose hunks and/or limits
   changes plus `changeSummary`, `reasoningPattern`, `successMetric`, `counterCase`, and
   citations (`evidenceDecisionIds`). Gates run cheapest-and-most-fundamental first:
   structural validity → **kernel** (fence + forbidden-pattern scan, LCS diff budget) →
   per-parameter `driftGuard` (hard range → 90-day drift → v1 drift → consecutive-
   loosening ratchet) → `checkEligibility` (§6) → row creation as a `CANDIDATE`
   `RuleVersion`. Any refusal is appended to `EvolutionEvent` with a machine-readable code
   — a rejected proposal is evidence too, and repeat-identical rejections are themselves a
   weekly-routine signal (see `prompts/weekly.md` §0b).
2. **Shadow-test** — `ensureShadowBranches` points the `CANDIDATE` book at the new version;
   its own paper ledger accrues fills, marks, counterfactuals, and a daily
   `FitnessSnapshot`, all isolated from `LIVE`.
3. **Evaluate** (daily, `evolution_evaluate`) — the paired z-test decides
   `HARD_REVERT`/`EARLY_KILL`/`PROMOTE`/`INCONCLUSIVE`/`CONTINUE` per §4.
4. **Promote** transactionally re-points `LIVE` at the winner and writes
   `Config.LIMITS`; **kill/revert** resets the `CANDIDATE` book to the incumbent.
5. **Score** (`score_rule_version`, agent-triggerable; `rule_scoring`, monthly cron) —
   retrospective HELPED/NEUTRAL/HURT on a finished (`RETIRED`/`KILLED`) version, computed
   **server-side** from the paired fitness series. Below `SCORE_MIN_SESSIONS` (10) paired
   sessions the call returns `preview: true, outcome: null` and **writes nothing** — an
   early NEUTRAL would be a one-way door, since the monthly job only revisits versions
   with `outcome: null`. Two `HURT` versions sharing a `reasoningPattern` auto-retire that
   pattern (`PATTERN_RETIRED`), and future proposals citing it are refused at the
   eligibility gate before they ever reach the kernel check.

**Promotion is server-side, full stop.** There is no `promote` / `revert` / `activate`
tool registered on MCP anywhere — the same precedent as `patch_config` not being
registered. `evolution_evaluate` is cron-only. A proposer that could crown or spare its
own candidate would remove the only selection pressure in the system.

---

## 6. Known limitations & risks

- **Sample size vs. autonomous promotion.** `evolution_evaluate` runs once per day and the
  z-test is recomputed on the accumulating series every time — this is **daily z-peeking**,
  which inflates the false-promotion rate above the nominal significance level of a single
  fixed-horizon test. There is **no alpha-spending correction** (e.g. O'Brien-Fleming
  boundaries). This is an **accepted, deliberate** trade-off, not an oversight: the
  compensating controls are the lane minimums (FAST 10 sessions/10 decisions, SLOW 30
  sessions/20 decisions — a promotion cannot fire on day 2 no matter how extreme an early
  z-score is), the drawdown gates (candidate ≤ 1.25× live's drawdown or a 5% floor,
  whichever is looser), and the 8-promotions-per-90-days rail. None of these fully offset
  the statistical inflation; they bound its blast radius.
- **EODHD tier unknown until backfill.** `src/lib/eodhd/quote.ts` served only `CSPX.LSE`
  before this build. Whether the EODHD key's tier covers US equities for the nightly
  `price_history` job and the bulk backfill is answered empirically by
  `scripts/backfill-price-history.ts --dry-run`'s coverage table — see the runbook. The
  per-ticker `stooq` fallback (plus Finnhub's `o` field, now parsed) keeps the nightly path
  alive regardless of the answer.
- **Cron chaining is best-effort.** A tick that needs to chain (budget exhausted or a job
  asked to resume) does so via `waitUntil(fetch(...))`; if `CRON_SECRET`/`SYNC_SECRET` is
  unset the chain is silently skipped (`chainSkipped` in the tick detail) and the remaining
  jobs wait for tomorrow's scheduled tick. A failed chain fetch is logged into the ledger,
  not retried.
- **Slow-lane / prose evolution needs the second Cowork schedule.** `DecisionReview` rows
  are written per-branch, and there is no routine that writes `CANDIDATE`-branch DRs today
  — only the Weekly LIVE routine exists. Without a second Cowork schedule running
  `branch=CANDIDATE`, the CANDIDATE book only ever fills the mechanical
  (limits-driven) shadow orders any DecisionReview on either branch produces; there is no
  independent CANDIDATE decision stream to test SLOW-lane prose changes against. In
  concrete terms: `decisions` (the count `evolution_evaluate` reads for the lane minimum)
  stays at 0 for the CANDIDATE branch until that schedule exists, so `z` for a SLOW-lane
  candidate can accumulate sessions but never clears the `decisions >= 20` minimum, and
  **autonomous promotion of a SLOW-lane / prose candidate cannot occur until the CANDIDATE
  schedule exists.** This is a safe default, not a bug — see the runbook §7.
- **Revert series runs on SLOW-lane minimums.** A deposed champion always resumes as a
  full `RuleVersion` (its own `lane` is whatever it was when active, which may be null/SLOW
  for an old version), so its revert series is held to the SLOW lane's 30-session/20-
  decision minimum, not the FAST lane's 10/10, even if the version that deposed it was a
  FAST-lane limits tweak. This means a revert series can take materially longer to resolve
  than the promotion that triggered it.
- **DecisionReview has no `sleeve` column (§2.10).** `permittedSize`'s speculative-sleeve
  cap is inert in seeding today — every shadow order and counterfactual is sized as if
  `sleeve` were unset. This under-counts risk-adjusted credit/debit for Speculative-sleeve
  refusals specifically; it does not affect the sizing of shadow BUY/ADD fills for other
  decision types, which are sized from conviction alone.
- **Gap-fixes carry no experimental provenance.** A `apply_gap_fix` change lands directly
  on the `ACTIVE` ruleset without a shadow-test period, by design (it is meant for typos
  and contradictions, not behaviour changes). If a gap-fix inadvertently changes behaviour,
  there is no z-test catching it before it is live — only the ≤40-line budget and the
  `expectedSectionSha` 409-on-mismatch check guard against a large or blind edit.

---

## 7. Corrections from the original orchestration plan

For traceability against `/Users/trishateh/.claude/plans/review-and-orchestrate-the-golden-kite.md`:

1. Challenger resolution is **pointer-as-truth** via `ShadowBranch.CANDIDATE` plus a
   legitimacy predicate (`src/lib/rules/challenger.ts`), not status-`CANDIDATE` lookups —
   see §2.4.
2. Single challenger is enforced **in code, across all lanes**, by that one predicate —
   not by a lane-specific rule.
3. The `LIMITS_PARAMS` registry is **complete**, including SLOW-lane rails (tier-band
   floors, entry-zone width, theme-breadth threshold, excess-move threshold) — registered
   for range-checking even though they cannot take the FAST lane.
4. `score_rule_version` returns a **preview** below the minimum paired-session count and
   writes nothing, rather than persisting an early (and permanent) `NEUTRAL`.
5. Gap-fix versions carry **no experimental provenance** (no `reasoningPattern` /
   `successMetric` / lane / citations) — they are corrections, not hypotheses.
6. Evidence tiers were **derived**, not copied from prose: `_shared.md` §9 defines
   BUY-signal tranches, not evidence-source tiers — see §2.9.
7. `DecisionReview` has **no `sleeve` column**, so `permittedSize`'s speculative-sleeve cap
   is inert in seeding — a known, accepted gap, not a regression (§2.10, §6).
