# Earnings routine — Earnings Watch

**Schedule:** Sundays 18:00 MYT.

Follow `_shared.md` in full.

**Branch:** pass `branch` explicitly on `get_context` / `get_prompt` / `upsert_daily_log` /
`upsert_decision_review` calls (default `LIVE`). Real-book write tools used here
(`patch_portfolio`, `upsert_watchlist`, `append_page_notes`) reject a `branch` param.

**Tools:** `get_context(routine="earnings")`, `get_prompt`, `list_portfolio`,
`list_watchlist`, `list_trades`, `list_decision_reviews`, `list_daily_logs`,
`get_document`, `get_page_notes` → `patch_portfolio`, `upsert_watchlist`,
`upsert_daily_log`, `append_page_notes`, `upsert_decision_review`. Never `log_trade`,
never `patch_config`.

Use `list_daily_logs` (~14 days; optionally `routineType=EARNINGS` or `DAILY`) plus
`list_decision_reviews` for pending-action memory.

---

## 1. Stale-date guard — do this first

`get_context` sets `earningsStale: true` when `earningsDate` is **null or in the past**
(and clears `daysToEarnings` when past). Treat those as **unknown**, re-confirm via web
search, then write the **next** confirmed `earningsDate` (`YYYY-MM-DD`) via
`patch_portfolio` / `upsert_watchlist` (system recomputes `daysToEarnings`). List
corrections in the daily log `notes`. Do not act on a stale `daysToEarnings` before the
write. Do **not** clear `earningsDate` to null after a print and move on — that makes the
next earnings pass skip the name.

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
- **Pending EXIT/REDUCE into the print:** if stop-out or reduce is still open and
  DTE ≤ 2, force the §4 choice — **recommend execution before the print** **or** defer
  past print with RESET STOP / WAIT and written reason. Never leave OKLO-style limbo into
  a binary event.
- Backfill portfolio `sleeve` (and other null enums you can determine) **before** applying
  sleeve rules — canonical mapping in `_shared` §6.
- Apply sleeve rules (`_shared` §6): on `QUALITY_CORE` names, holding through earnings is
  the default and price stops are review triggers, not exits.
- Recommend in narrative/DR: HOLD, REDUCE, WAIT, ADD, EXIT, RESET STOP, TRAIL STOP, or
  DO_NOT_AVERAGE_DOWN. Persist portfolio `action` only as legal `PositionAction`
  (`_shared` §2). **Default to HOLD/WAIT when confirmation is pending.**
- **Do not recommend meaningful averaging down within 7–10 days before earnings** unless
  explicitly labelled a small Test add (Lesson #1, binding). If `earningsDate` is unknown
  / stale, block adds entirely (`_shared` §7).
- No EARLY ENTRY signal within 7 days pre-earnings (`_shared` §9).
- Identify the key thesis metric to watch, and what would validate, evolve, or break the
  thesis.
- Do not follow analyst targets blindly — check the earnings setup, market momentum,
  technical structure, valuation/risk-reward, and Strategy Lessons.

Append a dated pre-earnings entry via `append_page_notes` only when material
(`_shared` §12) — e.g. recommendation/adaptive change, zone/stop cross, or earnings
setup update. Quiet unchanged names stay in the earnings log only.

## 3. Post-earnings pass

For any ticker that reported since the last run:

- Record actual vs estimate on revenue and EPS, guidance tone, and the market reaction.
- Reclassify thesis state.
- **Roll `earningsDate` forward** to the next confirmed report date via
  `patch_portfolio` / `upsert_watchlist`. If the next date is not yet published, leave a
  note and set a calendar reminder in `notes` — never leave the field null silently.
- Refresh `analystTarget` if the print moved Street targets (`_shared` §14).
- Check **QUALITY REBOUND** eligibility (`_shared` §9) if all of: consistently profitable
  with net cash; wide moat; beat on **both** revenue and EPS; single-day drop ≥10% from
  guide-tone or multiple compression, not thesis damage. If eligible: write
  `ENGINE_PRESENT` / `ENGINE_ABSENT` with evidence; size T1 halved when absent; state the
  tranche plan vs remaining `averageDownsUsed` headroom (below-cost QR fills consume the
  AD cap — max two below-cost adds); patch `beatRate` when verified; hand the staged plan
  to Daily / Weekly. Max 1 new QR initiation per month.
- If a knife-day zone entry occurred, apply the §4 stabilization definition rather than
  an open-ended WAIT.

## 4. Decision records

For every ticker with earnings within 7 days, `upsert_decision_review` with the §10
pre-registered 7-criteria scorecard in `reasonForDecision`, `idempotencyKey`, and
appropriate `decisionType` (`WAIT` / `HOLD` / `AVOID` / `DO_NOT_AVERAGE_DOWN` / etc.).
Also summarise in `upsert_daily_log.actionTaken` as a table ReportBlock.

## 5. Output

`upsert_daily_log` for today's MYT date as `logDate` (`YYYY-MM-DD`) with
**`routineType=EARNINGS`** (required — must not overwrite the Daily row for the same
date). All narrative fields are `ReportBlock[]`. Stamp `rulesVersion`. Include a **Run
ledger** in `notes` (`_shared` §16). Required table in `actionTaken` or
`portfolioMove`:

Headers: `Ticker`, `DTE`, `Earnings Risk`, `Pending Action Status`, `Recommendation`,
`Key Metric To Watch`.

Plus: a **Date Corrections** list (§1) naming every stale `earningsDate` you fixed, and a
short list of Decision Review ids/titles created this run.

Set `alertEmailSent=false`. No email.
