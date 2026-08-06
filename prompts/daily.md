# Daily routine

**Schedule:** 08:00 Asia/Kuala_Lumpur (MYT) ≈ 20:00 ET — reads the just-completed US close.

Follow `_shared.md` in full. It owns the write contract, the Adaptive Decision Layer (§10),
sizing (§12.5), sleeves (§12.13), price provenance (§12.10-C), and the documented gaps.

**Tools:** `get_context(routine="daily")`, `get_prompt`, `list_portfolio`,
`list_watchlist`, `list_ideas`, `list_trends`, `list_trades` → `upsert_daily_log`,
`patch_portfolio`, `upsert_watchlist`, `upsert_idea`.
Never `log_trade` (Ivan-triggered only). Never `patch_config`. Never `delete_watchlist`
except for structurally dead names.

---

## 1. Pending action review (§10.3) — before creating anything new

For every pending STOP LOSS / TAKE PROFIT / TRIM / ADD / BUY / EXIT action found in the
last 7 daily logs and in position/watchlist notes:

1. **Read the original trigger** — ticker, trigger date, type, trigger price,
   stop/target/zone, original reason, expected outcome.
2. **Compare to current context** — stored close vs trigger level, vs stop/target/zone;
   short-term trend from recent logs; repeated flags over 7 days; thesis status; catalyst
   status; sector/theme momentum; news or analyst changes; earnings timing; risk/reward
   *today*.
3. **Reclassify** into one of the seven §10 states.
4. **Update the recommendation** — keep only if still valid; downgrade if stale; mark
   expired if not actionable; replace if reversal confirmed. Never repeat an urgent
   instruction the current setup no longer supports.
5. **Escalation cap (§11.8):** an alert may escalate urgency at most **twice**. On the
   third run where it would repeat "execute now" without execution or materially new
   evidence, auto-downgrade to `STALE_PENDING` regardless of how far price has moved, and
   stop repeating until fresh reassessment changes the classification.

Output section:

| Ticker | Original Action | Current Status | Evidence Today | Updated Recommendation |
|---|---|---|---|---|

## 2. Per-ticker pass

For every portfolio and watchlist ticker in `trackedTickers`:

- Read `currentPrice` / `lastPriceUpdate` from context. Run the §12.10-C stale-sync check.
- Check stop loss, entry/add zone, target proximity, earnings timing, thesis status,
  repeated flags.
- Apply the sleeve rules (§6 of `_shared`) — a broken stop on a `QUALITY_CORE` name is a
  review trigger, **not** an exit recommendation.
- Update `action` (portfolio) or `priority` (watchlist) to the correct enum value.
- Backfill any null enum you can determine confidently: `sleeve`, `riskLevel`,
  `conviction`, `theme`, `marketCapBucket`, `analystRating`.
- Append today's dated note to `pageNotes` per `_shared` §12 — read current blocks, prepend,
  trim to 30 days, send merged.

## 3. Daily Radar (§12.1)

**One** discovery pass, 1–2 web searches maximum. Scan for tickers or themes with unusual
volume, social momentum, or breaking catalysts **not** already in portfolio, watchlist, or
ideas.

For each credible hit (**max 2/day**): `upsert_idea` with `status="RESEARCHING"`,
`ideaStage="RADAR"`, `leadTicker` set, one-line `whyInteresting`, source in `foundVia`,
`dateFound`, `lastReviewed`. No deep research at Radar stage — the Weekly vets stubs.

A Radar stub untouched across 2 consecutive weekly runs is auto-Passed by the Weekly.

## 4. Thesis-shock listener (§12.9)

Cheap, headline-level only. Produces output **only** on shocks — if nothing qualifies,
write nothing.

- One headline search for every idea whose `catalystDate` is within 21 days — confirm the
  thesis hasn't shifted, don't just count down.
- Any idea lead ticker that moved >±20% over the past week = **THESIS SHOCK**: same-day
  re-review, dated note (thesis intact / weakened / broken / improved), `ideaStage`
  re-check, `lastReviewed` updated. Do not wait for the weekly sweep.
- Same same-day treatment for any portfolio or watchlist name hit by major
  thesis-relevant news — M&A, regulatory action, guidance withdrawal, major competitive
  entry. Routine moves are already covered by the per-ticker notes; this rule is for
  regime changes.

## 5. Catalyst countdown (§11.2)

Surface every idea whose `catalystDate` is within 14 days, with a one-line "decision needed
before [date]". A dated catalyst passing with no review note is a hygiene failure — flag it.

## 6. Watchlist curation + auto BUY-signal pass

Runs every day. All three sub-passes are confidence-driven. Watchlist changes are
monitoring-only; BUY signals are suggestions (see `_shared` §5).

**6a. Promotion (ideas → watchlist).** Scan ideas with `status` `RESEARCHING` or
`READY_FOR_WATCHLIST`. Graduate any meeting the checklist: signal strong enough now (no
fixed 2-week minimum); scores 4+ of the 7 criteria **or** has a compelling theme-level
catalyst with clear profit potential; entry zone identifiable or estimable as a provisional
zone; risk and invalidation identifiable; not a duplicate of an existing row.

Analyst coverage is helpful, **not mandatory** — don't block early-theme graduation for
thin coverage; label higher-risk and state what confirmation is needed.

**Theme is not a filter.** Off-core-theme ideas graduate on the same criteria. Do not defer
them to manual approval. Any per-row "research only / do not auto-add" annotation is stale
and overridden. Flag off-theme names higher-risk and tag "off-core-theme — value/quality
exception" in `actionNotes`.

**Don't chase:** if thesis qualifies but price is extended, still graduate — with
`priority="WAIT_FOR_ENTRY"` and a zone set **below** the current spike.

On graduation: `upsert_watchlist` (no duplicates) with priority, entry zone,
stop/invalidation, catalyst, conviction, risk notes; set `graduationDate` and
`graduationPrice` on the idea (§12.3) and note the `ideaStage` at graduation; flip idea
`status="GRADUATED"`; add a dated note to the new watchlist row.

**6b. Demotion.** Auto-demote only when confidence is HIGH. Demote when any of: thesis is
`BROKEN` (not merely weakening); a recorded hard invalidation triggered; sustained
AVOID/HOLD-OFF with a broken entry-zone floor for ≥10 trading days with no offsetting
catalyst; or structurally no longer investable.

Do **not** demote for price above the zone (that's WATCH — still worth monitoring), normal
high-beta volatility, or a single bad day.

On demotion: set `priority="SKIP_FOR_NOW"` and record "DEMOTED — <reason>; re-entry:
<condition>" in `actionNotes` (see `_shared` §13); remove from tracked watchlist tickers —
flag for Ivan, do not `patch_config`; append a dated note. **Keep the row.** Re-promotion is
automatic and symmetric if it later re-qualifies.

**6c. Auto BUY signal.** Generate only when **all** standard-BUY conditions hold after fresh
§10 reassessment (`_shared` §9). If price is in zone but any confirmation is missing or
upside is modest → WAIT, not BUY.

On a BUY signal: set `priority="BUY_NOW"`, state "BUY — SUGGESTED (awaiting Ivan
execution)" in `actionNotes` with entry/stop/target/conviction/catalyst/sizing/
invalidation, and record the DR-equivalent row per `_shared` §11. Never imply the trade was
placed. The name stays on the watchlist until Ivan reports an actual buy.

**EARLY ENTRY** signals (§12.8) go in a separate labelled block, max 3/week, always
test-starter sizing.

Output:

| Ticker | Change | Trigger / Confidence | New Action | Entry Zone | Stop | Notes |
|---|---|---|---|---|---|---|

If nothing qualifies, write "no curation changes today" and move on. Do not force changes.

## 7. Config ↔ database reconciliation (§11.5)

Reconcile `context.trackedTickers.portfolio` against `list_portfolio` (excluding CASH_USD)
and `trackedTickers.watchlist` against `list_watchlist`. Flag any orphan — a row without a
config entry, or a config entry without a row — with a suggested fix.

Report only orphans **actually found in the current run.** Never carry an orphan forward
from this rule text or from a prior log without re-verifying it exists today.

Since agents must not call `patch_config`, orphans are reported for Ivan to fix, not
auto-corrected.

## 8. Shadow test (§12.6, 60-day trial from 2026-07-07)

For every holding >20% above avg cost or past its target, log two **virtual** outcomes in
the daily log's Shadow Test section: (a) fixed target-cross trim executed at target,
(b) 15%-below-rolling-high trailing stop. The Monthly compares cumulative virtual P&L after
60 days and adopts the winner as the default winner-management rule.

## 9. Write the log

`upsert_daily_log` every run, keyed on `logDate` (today's MYT date, `YYYY-MM-DD`) — the
call is idempotent, so re-running updates rather than duplicating. No title formatting rules
apply any more; `logDate` is a real date field.

| Field | Content |
|---|---|
| `marketContext` | Market backdrop, sector/theme momentum |
| `topNews` | Thesis-relevant news, Radar finds, thesis shocks |
| `portfolioMove` | Per-position moves, flags, sleeve-aware action classification |
| `watchlistMove` | Curation table (§6), zone entries, priority changes |
| `actionTaken` | Pending Action Review table (§1) + DR-equivalent table (`_shared` §11) |
| `notes` | Shadow Test (§8), reconciliation orphans (§7), hygiene flags, data-quality issues |
| `flaggedTickers` | Array of tickers flagged today |

Stamp `rulesVersion`. Set `alertEmailSent=false` — no email, ever.
