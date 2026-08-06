# Earnings routine — Earnings Watch

**Schedule:** Sundays 18:00 MYT.

Follow `_shared.md` in full.

**Tools:** `get_context(routine="earnings")`, `get_prompt`, `list_portfolio`,
`list_watchlist`, `list_trades` → `patch_portfolio`, `upsert_watchlist`,
`upsert_daily_log`. Never `log_trade`, never `patch_config`.

Read the last 14 days of daily logs.

---

## 1. Stale-date guard — do this first

`get_context` sets `earningsStale: true` and clears `daysToEarnings` when
`earningsDate` is in the past. Treat those as **unknown**, re-confirm via web search,
update the date, and note the correction. Do not act on a stale `daysToEarnings`.

`earningsRisk` in context is derived from `context.thresholds.earningsRisk` (imminent /
soon / clear). Prefer that over any legacy emoji/string label.

## 2. Per-ticker pass — earnings within 14 days

For each portfolio or watchlist ticker with confirmed earnings within 14 days:

- Confirm date and timing (before/after market).
- Capture EPS estimate, revenue estimate, historical beat/miss pattern, implied move if
  available, key guidance expectations.
- Review every pending stop-loss, reduce, trim, add, and buy-zone alert under the Adaptive
  Decision Layer (`_shared` §4) **before** repeating it. Classify into one of the seven
  states.
- Apply sleeve rules (`_shared` §6): on `QUALITY_CORE` names, holding through earnings is
  the default and price stops are review triggers, not exits.
- Recommend HOLD, REDUCE, WAIT, ADD, EXIT, RESET STOP, TRAIL STOP, or DO NOT AVERAGE DOWN.
  **Default to HOLD/WAIT when confirmation is pending.**
- **Do not recommend meaningful averaging down within 7–10 days before earnings** unless
  explicitly labelled a small Test add (Lesson #1, binding).
- No EARLY ENTRY signal within 7 days pre-earnings (§12.8).
- Identify the key thesis metric to watch, and what would validate, evolve, or break the
  thesis.
- Do not follow analyst targets blindly — check the earnings setup, market momentum,
  technical structure, valuation/risk-reward, and Strategy Lessons.

Update `pageNotes` with a dated pre-earnings entry per `_shared` §12 (read, prepend, trim to
30 days, send merged).

## 3. Post-earnings pass

For any ticker that reported since the last run:

- Record actual vs estimate on revenue and EPS, guidance tone, and the market reaction.
- Reclassify thesis state.
- Check **QUALITY REBOUND** eligibility (§12.12) if all of: consistently profitable with net
  cash; wide moat; beat on **both** revenue and EPS; single-day drop ≥10% from guide-tone or
  multiple compression, not thesis damage. If eligible, note the re-ignition engine
  assessment and hand the staged-thirds entry template to the Weekly. Max 1 new initiation
  per month.
- If a knife-day zone entry occurred, apply the §12.11 stabilization definition rather than
  an open-ended WAIT.

## 4. Decision records

For every ticker with earnings within 7 days, record a pre-earnings decision entry with the
§12.4 pre-registered 7-criteria scorecard, per `_shared` §11 (interim: a table block inside
`upsert_daily_log.actionTaken`, since no Decision Review table exists).

## 5. Output

Write to `upsert_daily_log` for the run date. Required table:

| Ticker | DTE | Earnings Risk | Pending Action Status | Recommendation | Key Metric To Watch |
|---|---:|---|---|---|---|

Plus: a **Date Corrections** list (§1) naming every stale `earningsDate` you fixed, and the
DR-equivalent decision table.

Stamp `rulesVersion`. No email.
