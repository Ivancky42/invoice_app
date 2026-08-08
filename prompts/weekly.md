# Weekly routine — Deep Analysis + Sector Scout + Evolution Loop

**Schedule:** Mondays 07:30 MYT.

Follow `_shared.md` in full.

**Branch:** all `get_context` / `get_prompt` / `upsert_*` calls in this routine pass
`branch` explicitly — this schedule runs `branch=LIVE` (the default; still pass it
explicitly rather than relying on the default). A second Cowork schedule runs the
identical routine with `branch=CANDIDATE` against the shadow book once it exists (§0
below). Real-book write tools (`log_trade`, `patch_portfolio`, `upsert_watchlist`,
`append_page_notes`, `sync_tracked_tickers`, idea/trend/document writes) **reject** a
`branch` param outright (400) — they always address the one real book regardless of which
schedule calls them. Only `get_context`, `get_prompt`, `upsert_daily_log`, `upsert_report`,
and `upsert_decision_review` are branch-aware.

**Tools (portfolio/watchlist/report side):** `get_context(routine="weekly", branch=…)`,
`get_prompt`, `list_portfolio`, `list_watchlist` (`includeDemoted=true` when needed),
`list_ideas`, `list_trends`, `list_trades`, `list_decision_reviews`, `list_daily_logs`,
`list_reports`, `get_document`, `get_page_notes` →
`upsert_report` (`reportType="WEEKLY"`, `branch=…`), `upsert_trend`, `upsert_idea`,
`patch_portfolio`, `upsert_watchlist`, `append_page_notes`,
`upsert_decision_review` (`branch=…`, evidence attached inline — see §0d),
`sync_tracked_tickers`. Soft-demote via `delete_watchlist` / `action=DEMOTED` per
`_shared` §13. Never `log_trade`, never `patch_config`.

**Tools (evolution side, new this cycle):** `get_shadow_fitness`, `list_shadow_positions`,
`list_shadow_orders`, `list_counterfactuals`, `list_evolution_log`, `list_rule_versions`,
`get_rule_version`, `get_kernel` (read) → `propose_rule_change`, `apply_gap_fix`,
`score_rule_version` (write). **Promotion, reversion, and activation have no agent tool at
all** — see §4.

Read `list_daily_logs` for ~30 days and `list_decision_reviews` for pattern memory.
Backfill null `sleeve`/`theme` in §3 before sleeve-dependent judgments. Decision Review
migration seed is complete — do not re-seed. Include a **Run ledger** in the weekly report
(`_shared` §16). Append ticker notes only on material changes (`_shared` §12).

---

## 0. The evolution loop — five stages every week

This routine now does two jobs: the portfolio/watchlist deep-analysis pass (§§1–7, mostly
unchanged) and a weekly pass over the **rule evolution engine** — the paper-only shadow
book, its fitness ledger, and the ruleset that governs it. The five stages below are the
evolution pass; run them **before or alongside** §§1–7 since the gap-hunt in §0b draws on
this week's Decision Reviews from §1–§4.

### 0a. Review — what happened to the paper books this week

- `get_shadow_fitness(branch="LIVE")` and `get_shadow_fitness(branch="CANDIDATE")` —
  daily fitness snapshots (all values are FRACTIONS; `avoidedCreditDelta` is SIGNED).
  Read the trend over the week, not just the latest print.
- `list_shadow_positions` for both branches — what the paper book is actually holding.
- `list_counterfactuals` — what refused decisions (AVOID / WAIT / DO_NOT_AVERAGE_DOWN)
  would have been worth. A cluster of negative-credit refusals on the same pattern is a
  gap-hunt lead for §0b.
- `list_evolution_log` — the append-only audit trail: proposals, rejections
  (`KERNEL_ATTEMPT`, eligibility failures), promotions, kills, scores, mirrors. Read
  rejections too, not just successes — a repeated identical rejection is itself a signal
  that either the evidence bar or the proposal keeps missing the same way.
- If a live CANDIDATE exists (`list_rule_versions(status="CANDIDATE")` or
  `get_rule_version` on the id `ShadowBranch.CANDIDATE` points at), summarise its week:
  lane, sessions accumulated, direction of the z-score trend if visible in the fitness
  history. Do **not** try to compute promotion yourself — see §4.

### 0b. Gap hunt — find repeated failure shapes

Scan this week's Decision Reviews (via `list_decision_reviews`, and the rows written in
§1–§4 below) for patterns, specifically:

- `moveClass` (`MARKET_MOVE` / `THEME_MOVE` / `IDIOSYNCRATIC` / `INSUFFICIENT_DATA`) —
  is the ruleset repeatedly mis-crediting a market-wide move to stock-picking, or vice
  versa?
- Evidence warnings recorded on DR writes (`T12_REQUIRED_FOR_ACTION`,
  `T4_NEVER_SUFFICIENT`, `STALE_EVIDENCE`, `MOVE_CLASS_BLOCKS_THESIS_CHANGE`, etc. — see
  `_shared` evidence provenance §) — a cluster of the same warning code across tickers is
  a candidate gap, not noise.
- `list_rule_versions` for RETIRED/KILLED versions old enough that their `outcome`
  (HELPED/NEUTRAL/HURT) is populated (or, if not yet scored, old enough to attempt —
  see §0d): does the record already say a similar change failed? `list_evolution_log`
  filtered mentally for `ELIGIBILITY_REJECT` — repeated **identical** rejections (same
  code, same changedPaths, same ticker cluster) are themselves a signal that the proposal
  is not the right fix, not just that it needs re-submitting.

A gap is worth acting on only when it recurs across **multiple tickers and multiple weeks**
— a single bad week is noise, not a rule problem.

### 0c. Propose — at most one `propose_rule_change` per week

Before proposing anything, call `get_kernel` — the five kernel-fenced clauses
(`price-provenance`, `execution-boundary`, `fitness-definition`, `reversion-mechanism`,
`audit-append-only`) are the immutable boundary. Any hunk that edits a line inside a
kernel fence is refused outright and logged as `KERNEL_ATTEMPT` — do not attempt it, even
experimentally.

**Eligibility bars** (`propose_rule_change` enforces these server-side; know them before
drafting so you cite the right evidence, not after a rejection):

- **≥3 scored decision reviews** cited (`evidenceDecisionIds`) — rows with a
  `finalVerdict`, not pending ones.
- **≥2 distinct tickers** and **≥2 distinct ISO weeks** among the cited rows — a single
  ticker or a single week is not diverse evidence.
- **≥1 wrong outcome** among the cited rows — a `LOSS` verdict, a `POOR` signal quality,
  or a refused decision (AVOID/WAIT/DO_NOT_AVERAGE_DOWN) whose resolved counterfactual
  credit is negative (i.e. the refusal cost money).
- A falsifiable **`counterCase`** (≥40 characters, not "none"/"n/a") — what evidence would
  prove this change wrong.
- A measurable **`successMetric`** — must name a number and one of: fitness, return,
  drawdown, credit, hit rate/winrate, sessions, z. "the book should feel calmer" is not
  measurable and is refused.
- **Loosening a rail costs more evidence**, not less: any limits change that moves a
  parameter in its `looseningDirection` (see `get_kernel` docs / `list_rule_versions`
  changedPaths for precedent) additionally requires **≥5 cited rows spanning ≥42 days**
  and a **`worstCase`** field describing the downside scenario.
- A proposal touching the same `changedPaths` as a version RETIRED/KILLED in the last 90
  days is refused unless the cited evidence postdates that retirement (`reproposal_banned`).
- A `reasoningPattern` shared by ≥2 HURT-scored versions is refused outright
  (`pattern_retired`) — re-litigating a pattern the ledger already convicted twice is not
  a new proposal.

The **lane** (FAST vs SLOW) is assigned by the server from which numeric pointers you
touch — never claim one; a claimed lane is stripped and logged as `laneClaimIgnored`.

**Gap-fixes are different and separate**: a typo, a contradiction, or a clarification that
does not change behaviour goes through `apply_gap_fix` instead — immediate, ≤40 changed
lines, one section, `expectedSectionSha` required (409 on mismatch so you never blind-write
over prose someone else already touched). Use `propose_rule_change` only when the change
is meant to alter behaviour and needs shadow-testing before it can earn real influence.

### 0d. Score — retire the verdict on old candidates

`score_rule_version(versionId)` on any RETIRED or KILLED version old enough to have a
settled paired series. Below 10 paired sessions the call returns `preview: true,
outcome: null` and writes nothing — the version stays unscored, not NEUTRAL, until the
series is long enough; do not treat a preview as a final verdict. The `outcomeClaim` field
is recorded for the record but is **never** the outcome — the server computes
HELPED/NEUTRAL/HURT from the fitness ledger. Two HURT versions sharing a
`reasoningPattern` auto-retire that pattern (`PATTERN_RETIRED` in the log) and future
proposals citing it are refused at the eligibility gate.

### 0e. Promotion is server-side — the routine never promotes

Nothing in this routine, nor any tool it can call, promotes, reverts, or activates a
ruleset. `evolution_evaluate` is a **cron-only** job (daily, after `fitness_snapshot`) that
runs the paired sequential z-test between the CANDIDATE and LIVE shadow books and decides
`HARD_REVERT → EARLY_KILL → PROMOTE → INCONCLUSIVE → CONTINUE` in that precedence — a
kernel drawdown-floor breach reverts even a candidate with a glowing z-score. There is no
promote/revert/activate tool registered anywhere for an agent to call, by design: the
proposer must never be able to crown its own candidate. Report on the state you observe in
§0a; do not recommend "promote this now" as an action for yourself to take — only Ivan (via
the ledger you report) or the cron evaluator decides.

---

## 1. Strategy evolution review (§10.4)

For every portfolio and watchlist ticker, classify thesis as exactly one of: `INTACT`,
`STRENGTHENING`, `EVOLVING`, `WEAKENING`, `BROKEN`, `REVERSING_POSITIVE`,
`REVERSING_NEGATIVE`. (Thesis labels are narrative — not Prisma enums.)

Do not only compare price to a fixed level. Evaluate: price trend over recent weeks;
reclaim or loss of key levels; volume/momentum; relative strength vs sector and market;
news flow; earnings/catalyst proximity; analyst revisions and target dispersion; valuation
and upside/downside; whether prior outcomes support this action type; whether it resembles
a known anti-pattern.

Decision framework:
1. **Hit stop but recovered** — failed breakdown or weak rebound? → recommend HOLD /
   RESET STOP / REDUCE / EXIT / WAIT in narrative. Map to legal `PositionAction` per
   `_shared` §2. (On `QUALITY_CORE` names a broken stop is a review trigger only.)
2. **Hit take-profit but momentum accelerating** — consider partial trim, trailing stop, or
   hold. Do not sell automatically just because the target was reached.
3. **Fell below target after a take-profit alert** — mark `MISSED_OR_EXPIRED`, reassess from
   current price.
4. **Analyst target disagrees with price action** — explain the disagreement, prefer WAIT or
   staged action.
5. **Thesis changed** — write the new thesis explicitly; state whether the strategy is
   reset, downgraded, upgraded, or abandoned.

Also: conviction score is **1–5 only**, never 0–10. If converting: 9–10→5, 7–8→4, 5–6→3,
3–4→2, 1–2→1.

Recommend in narrative/DR: HOLD, ADD, WAIT, REDUCE, EXIT, TRAIL STOP, RESET STOP, or
DO_NOT_AVERAGE_DOWN. Persist portfolio `action` only as `HOLD` | `ADD_ON_DIP` | `REDUCE` |
`EXIT` | `WATCH`. Keep notes, DR, and the report consistent.

## 2. Sell-side discipline (§12.6)

**Extended-winner scan.** Any holding >30% above avg cost **and** >15% above its entry zone
with weakening momentum or deteriorating relative strength → staged-trim recommendation.
Prefer staged trims and trailing stops over full exits where the thesis is intact.

**Capital recycling.** If cash after the 5% floor cannot fund a new BUY/EARLY ENTRY signal
at its suggested size, the signal **must** name its funding source — the lowest-conviction
holding(s) by the latest re-rank, with a specific trim suggestion — or say explicitly
"no funding available; signal is watch-only." No unfunded buy recommendations.

## 3. Backfill pass (§12.5 / §8)

Backfill for all existing holdings via `patch_portfolio` / `list_trades` history:
`conviction` (1–5), `sleeve`, `theme`, `addZone`, `nextAddTrigger`. Cross-check
`averageDownsUsed` against `list_trades`. **Flag anything you cannot determine rather than
guessing.** Do **not** write `shares` via patch — shares come only from `log_trade`.

Also every week, for each holding/watchlist name you touch:
- Refresh `analystTarget` when recent PTs disagree with the stored target (`_shared` §14).
- RESET / TRAIL `stopLoss` when `STALE_STOP` / stop policy (§6) applies; write the new level.
- Resolve `STOP_IN_LIMBO` breached stops (execute path or formal RESET).
- Roll null/past `earningsDate` to the next confirmed date.
- Fix stale `entryZone` / `addZone` text (wrong avg-cost clauses, obsolete ranges).
- Assign null `theme` when a legal value fits (`SOCIAL_PLATFORMS` for social/consumer-
  internet platforms); leave null only when nothing maps and rely on Daily `UNCAPPED_THEME`.
- Null `sleeve` → default `MOMENTUM_CATALYST` and confirm.
- If `nav.sleeveExposure.SPECULATIVE` > `limits.speculativeSleevePct`, lead with a recycle
  plan before any new Spec risk.

RDDT was opened without a pre-registered scorecard (§10 breach) — keep the
lower-confidence / `NO_PREREGISTERED_SCORECARD` flag on related DRs. Theme is
`SOCIAL_PLATFORMS`; sleeve should already be set (default `MOMENTUM_CATALYST` if null).

Refresh `addZone` and `nextAddTrigger` on every holding this week (`patch_portfolio`).

## 4. Pipeline sweep (§11.1) — mandatory, every row

Touch **every** idea with `status` `RESEARCHING` or `READY_FOR_WATCHLIST`. (Skip `PASS` and
`GRADUATED`; `HOLD_OFF` gets a one-line check.) For each, either append a dated review note
(STAY / GRADUATE / HOLD OFF / DROP + one-line reason) as ReportBlock[] on idea `notes`, or
write an explicit "skipped — no new signal" line naming the row.

Always update `lastReviewed`. Any row whose `lastReviewed` is >14 days old is a hygiene
failure — list it under **Overdue Pipeline Reviews**.

**Double-DROP auto-close (§11.3):** if two consecutive weekly or monthly reviews recommend
DROP for the same row, set `status="PASS"` on the second recommendation with a dated closing
note stating the re-open condition. Do not recommend it a third time.

**Graduated-row hygiene (§11.6):** when graduating a multi-ticker row where only one ticker
moves to the watchlist, split remaining research candidates into their **own** idea rows at
graduation time. Never leave live candidates as note remnants inside a graduated row.

**Set `leadTicker` on every row you touch** — nothing joins without it (§11.4).

## 5. Sector Scout — run aggressively

Goal: catch new sectors and themes **early**, before they appear in the databases or reach
mainstream coverage.

**Step 1 — Social sweep.** Reddit, Stocktwits trending, X finance accounts: tickers or
themes with unusual momentum this week not already tracked. Flag anything appearing across
≥2 platforms or cited in 3+ posts with specific investment-thesis language — not memes.
Note tickers named, narrative used, discussion intensity.

**Step 1b — Insider & institutional clusters (§12.2).** Notable insider-buying clusters
(multiple insiders, same company/sector, past 2 weeks) and reported 13F cluster buys in
non-mainstream names. Insider clusters in a coherent sector = early theme signal.

**Step 2 — Policy & regulatory sweep.** New executive orders, hearings, budget
announcements, regulatory approvals, international policy shifts from the past 7 days.
Prioritise: US energy policy, AI regulation, defense spending, FDA approvals, space
commercialisation, semiconductor policy, Malaysia/SEA macro.

**Step 3 — Analyst & institutional sweep.** New sector initiations, thematic research, ETF
launches in the past 7 days. A cluster of initiations on the same theme (2+ banks, same
week) is a strong early signal. New ETF launches signal institutionalisation — flag
regardless of AUM.

**Step 3b — New-vehicle calendar (§12.2).** Upcoming/recent IPOs, spinoffs, lockup expiries
relevant to active or emerging themes. New pure-play vehicles = theme institutionalising;
lockup expiries = supply events for tracked names.

**Step 4 — Earnings call intelligence.** Management commentary from this week's calls
describing a new technology, regulation, or macro trend as an emerging tailwind not yet
widely covered.

**Step 4b — Supply-chain second-order pass (§12.2).** For the **single** strongest-momentum
theme currently in the portfolio or trend log, scan one tier down the supply chain
(components, materials, services, picks-and-shovels) for under-covered public names not in
any database. Precedent: MP Materials was found exactly this way. **Rotate the examined
theme weekly** — record which theme you examined so next week picks a different one.

**Step 5 — Cross-reference and score.** For each candidate: signal count (**minimum 2
independent** to proceed); investability (traded stock or ETF exists); earliness (prefer
pre-mainstream); fit with the trend + social + analyst approach and a USD-denominated book.
Drop anything with <2 independent signals or no traded vehicle. A single strong leading
signal may create a `RADAR` stub instead of a full row.

**Step 6 — Idea rows.** For each theme passing Step 5, `upsert_idea` with theme name and
one-sentence thesis (`whyInteresting` as ReportBlock[]), top 1–3 tickers, `leadTicker`,
signal sources, earliest catalyst, why this is early, risk/invalidation, `ideaStage`,
`dateFound`, `lastReviewed`.

**Step 7 — Trend log.** `upsert_trend` for each theme: update `lifecycleStage` (`EMERGING` /
`BUILDING` / `HOT` / `PEAKED` / `FADED` / `PAUSED`) and `weekMomentum` (`ACCELERATING` /
`STABLE` / `DECELERATING` / `REVERSED`) — note these are two separate fields; the old
single "Emerging/Accelerating/Peaking/Fading/Reversed" scale splits across both. Update the
four score components (`socialVelocity`, `analystMomentum`, `priceClustering`,
`fundamentalBacking`) and `signalScore`. New themes get a row at `EMERGING`.

Set `discoveredVia="WEEKLY_SCAN"`. Backfill `lifecycleStage`, `weekMomentum`, and
`discoveredVia` on existing trends when null.

**Step 8 — Graduation pass.** This is the step that actually executes graduation. Test every
`RESEARCHING` / `READY_FOR_WATCHLIST` row against the checklist in `daily.md` §6a. Theme is
not a filter. Don't chase. Set `graduationDate` + `graduationPrice` + note the stage at
graduation. Leave non-qualifying ideas in the pipeline with a one-line reason — do not
graduate marginal names to fill the list.

## 6. Report

`upsert_report(reportType="WEEKLY", reportDate=<Monday, YYYY-MM-DD>, branch=…)`, `content`
as `ReportBlock[]` (headings + tables as JSON blocks, not markdown). Stamp `rulesVersion`.

**Format:** every section is `heading_2` then a **table** or `bulleted_list_item` list —
never a single paragraph that lists many tickers. One row/bullet per ticker.

Required sections (as `heading_2` + table/paragraph blocks):

- **Strategy Changes This Week** — Ticker | Old Strategy | New Evidence | Updated Strategy |
  Reason
- **Reversal Watch** — Ticker | Prior Signal | Reversal Evidence | Confidence | Action
- **Expired / Superseded Alerts** — Ticker | Old Alert | Why | New Status
- **Graduation table** — Idea | Theme | Met Criteria? | Off-theme? | Graduated? | Initial
  Action | Entry Zone | Risk Flag
- **Overdue Pipeline Reviews** (§4)
- **Sector Scout findings** by step, including which theme Step 4b examined
- **EARLY ENTRY block** — separate and labelled, never mixed with standard BUYs
- **Decision Reviews this week** — summarise rows written via `upsert_decision_review`
  (`_shared` §11)
- **Evolution loop summary** (§0) — shadow-fitness trend for LIVE and CANDIDATE, any
  proposal made or rejected this week (with code), any gap-fix applied, any version scored,
  and the current state of the challenger book (idle / running / age in sessions). State
  plainly that promotion is server-side and none occurred by agent action.
