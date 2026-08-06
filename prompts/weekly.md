# Weekly routine — Deep Analysis + Sector Scout

**Schedule:** Mondays 07:30 MYT.

Follow `_shared.md` in full.

**Tools:** `get_context(routine="weekly")`, `get_prompt`, `list_portfolio`,
`list_watchlist` (`includeDemoted=true` when needed), `list_ideas`, `list_trends`,
`list_trades`, `list_decision_reviews`, `list_daily_logs`, `list_reports`, `get_document` →
`upsert_report` (`reportType="WEEKLY"`), `upsert_trend`, `upsert_idea`, `patch_portfolio`,
`upsert_watchlist`, `append_page_notes`, `upsert_decision_review`, `sync_tracked_tickers`.
Soft-demote via `delete_watchlist` / `action=DEMOTED` per `_shared` §13. Never `log_trade`,
never `patch_config`.

Read `list_daily_logs` for ~30 days and `list_decision_reviews` for pattern memory.
Backfill null `sleeve`/`theme` in §3 before sleeve-dependent judgments. Decision Review
migration seed is complete — do not re-seed.

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

`upsert_report(reportType="WEEKLY", reportDate=<Monday, YYYY-MM-DD>)`, `content` as
`ReportBlock[]` (headings + tables as JSON blocks, not markdown). Stamp `rulesVersion`.

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
