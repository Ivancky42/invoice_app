# Earnings routine — Earnings Watch

**Schedule:** Sundays 18:00 MYT.

Follow `_shared.md` in full.

**Tools:** `get_context(routine="earnings")`, `get_prompt`, `list_portfolio`,
`list_watchlist`, `list_trades`, `list_decision_reviews`, `list_daily_logs`, `get_document`
→ `patch_portfolio`, `upsert_watchlist`, `upsert_daily_log`, `append_page_notes`,
`upsert_decision_review`. Never `log_trade`, never `patch_config`.

Use `list_daily_logs` (~14 days) plus `list_decision_reviews` for pending-action memory.

---

## 1. Stale-date guard — do this first

`get_context` sets `earningsStale: true` and clears `daysToEarnings` when
`earningsDate` is in the past. Treat those as **unknown**, re-confirm via web search,
then write the corrected `earningsDate` (`YYYY-MM-DD`) via `patch_portfolio` /
`upsert_watchlist` (system recomputes `daysToEarnings`). List corrections in the daily
log `notes`. Do not act on a stale `daysToEarnings` before the write.

`earningsRisk` in context is derived from `context.thresholds.earningsRisk` (imminent /
soon / clear). Prefer that over any legacy emoji/string label.

## 2. Per-ticker pass — earnings within 14 days

For each portfolio or watchlist ticker with confirmed earnings within 14 days:

- Confirm date and timing (before/after market).
- Capture EPS estimate, revenue estimate, historical beat/miss pattern, implied move if
  available, key guidance expectations.
- Review every pending stop-loss, reduce, trim, add, and buy-zone alert under the Adaptive
  Decision Layer (`_shared` §4) **before** repeating it. Classify into one of the seven
  states. Source pendings from `list_decision_reviews` (seed legacy pendings per `daily` §0
  if the table is empty).
- Backfill portfolio `sleeve` (and other null enums you can determine) **before** applying
  sleeve rules — canonical mapping in `_shared` §6.
- Apply sleeve rules (`_shared` §6): on `QUALITY_CORE` names, holding through earnings is
  the default and price stops are review triggers, not exits.
- Recommend in narrative/DR: HOLD, REDUCE, WAIT, ADD, EXIT, RESET STOP, TRAIL STOP, or
  DO_NOT_AVERAGE_DOWN. Persist portfolio `action` only as legal `PositionAction`
  (`_shared` §2). **Default to HOLD/WAIT when confirmation is pending.**
- **Do not recommend meaningful averaging down within 7–10 days before earnings** unless
  explicitly labelled a small Test add (Lesson #1, binding).
- No EARLY ENTRY signal within 7 days pre-earnings (`_shared` §9).
- Identify the key thesis metric to watch, and what would validate, evolve, or break the
  thesis.
- Do not follow analyst targets blindly — check the earnings setup, market momentum,
  technical structure, valuation/risk-reward, and Strategy Lessons.

Append a dated pre-earnings entry via `append_page_notes` (`_shared` §12).

## 3. Post-earnings pass

For any ticker that reported since the last run:

- Record actual vs estimate on revenue and EPS, guidance tone, and the market reaction.
- Reclassify thesis state.
- Check **QUALITY REBOUND** eligibility (`_shared` §9) if all of: consistently profitable
  with net cash; wide moat; beat on **both** revenue and EPS; single-day drop ≥10% from
  guide-tone or multiple compression, not thesis damage. If eligible, note the re-ignition
  engine assessment and hand the staged-thirds entry template to the Weekly. Max 1 new
  initiation per month.
- If a knife-day zone entry occurred, apply the §4 stabilization definition rather than
  an open-ended WAIT.

## 4. Decision records

For every ticker with earnings within 7 days, `upsert_decision_review` with the §10
pre-registered 7-criteria scorecard in `reasonForDecision`, `idempotencyKey`, and
appropriate `decisionType` (`WAIT` / `HOLD` / `AVOID` / `DO_NOT_AVERAGE_DOWN` / etc.).
Also summarise in `upsert_daily_log.actionTaken` as a table ReportBlock.

## 5. Output

`upsert_daily_log` for today's MYT date as `logDate` (`YYYY-MM-DD`). All narrative fields
are `ReportBlock[]`. Stamp `rulesVersion`. Required table in `actionTaken` or
`portfolioMove`:

Headers: `Ticker`, `DTE`, `Earnings Risk`, `Pending Action Status`, `Recommendation`,
`Key Metric To Watch`.

Plus: a **Date Corrections** list (§1) naming every stale `earningsDate` you fixed, and a
short list of Decision Review ids/titles created this run.

Set `alertEmailSent=false`. No email.
