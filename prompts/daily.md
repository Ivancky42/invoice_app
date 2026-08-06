# Daily routine

**Schedule:** 08:00 Asia/Kuala_Lumpur (MYT) ≈ 20:00 ET — reads the just-completed US close.

Follow `_shared.md` in full. It owns the write contract, Adaptive Decision Layer (§4),
sizing (§7), sleeves (§6), price provenance (§3), Decision Review (§11), and enums.

**Tools:** `get_context(routine="daily")`, `get_prompt`, `list_portfolio`,
`list_watchlist` (use `includeDemoted=true` when checking re-promotion), `list_ideas`,
`list_trends`, `list_trades`, `list_decision_reviews`, `list_daily_logs`, `get_document` →
`upsert_daily_log`, `patch_portfolio`, `upsert_watchlist`, `upsert_idea`,
`append_page_notes`, `upsert_decision_review`, `sync_tracked_tickers`. Soft-demote via
`delete_watchlist` (default) or `upsert_watchlist` with `action=DEMOTED|DROPPED` — see
`_shared` §13. Never `log_trade` (Ivan-triggered only). Never `patch_config`. Never
`hard=true` delete except structurally dead names.

---

## 0. Decision Review seeding (first scheduled run only)

**Run this block once** before §1 when `list_decision_reviews(reviewStatus=PENDING)`
returns **[]** but portfolio/watchlist `pageNotes` or recent daily logs still record
unresolved actions from the Notion era. Skip on all later runs once DR rows exist.

1. Read `list_portfolio`, `list_watchlist`, and `list_daily_logs` (~30 days).
2. For each outstanding action still open (EXIT, stop breach, REDUCE, unresolved WAIT,
   etc.), `upsert_decision_review` with:
   - `reviewStatus=PENDING`
   - `decisionDate` = **original trigger date** from the dated note or daily log — not
     today's date
   - `decisionType`, `stopLoss`, `priceAtDecision`, `positionContext`, and
     `reasonForDecision` transcribed from the source note (include adaptive state if known)
   - Stable `idempotencyKey`, e.g. `seed-dr-{TICKER}-{decisionType}-{YYYYMMDD}`
3. Re-query `list_decision_reviews(PENDING)`. §1 must not proceed while legacy pendings
   live only in notes — that silently drops them from the adaptive loop and leaves §11.8's
   escalation cap with no history.

**Known migration pendings (verify current price vs stop before §1):**

| Ticker | Issue | Notes |
|---|---|---|
| OKLO | EXIT vs $48 stop (~$42.99) | Outstanding since early Jun 2026 |
| GLXY | Stop breach (~$19.07 vs $20) | |
| ISRG | Stop breach (~$375 vs $400) | `QUALITY_CORE` — broken stop is advisory only (`_shared` §6) |

Also backfill portfolio enums (§2) for any row you touch during seeding. **Run 1 is a
backfill run**, not a normal run — sleeve-dependent judgments are unreliable until §2's
ordering is satisfied.

## 1. Pending action review (§10.3) — before creating anything new

Source of pending actions: `list_decision_reviews` with `reviewStatus=PENDING` (and
`pendingDueWithinDays` as needed), plus `list_daily_logs` for the last ~7 days when you
need narrative context (Pending Action Review tables, repeated flags). If §0 just ran,
include the seeded rows here.

For every pending STOP LOSS / TAKE PROFIT / TRIM / ADD / BUY / EXIT action:

1. **Read the original trigger** — ticker, trigger date, type, trigger price,
   stop/target/zone, original reason, expected outcome.
2. **Compare to current context** — stored close vs trigger level, vs stop/target/zone;
   thesis status; catalyst status; sector/theme momentum; news; earnings timing;
   risk/reward *today*.
3. **Reclassify** into one of the seven §4 states.
4. **Update the recommendation** — keep only if still valid; downgrade if stale; mark
   expired if not actionable; replace if reversal confirmed. Never repeat an urgent
   instruction the current setup no longer supports. Update the DR row when status
   changes.
5. **Escalation cap (§11.8):** an alert may escalate urgency at most **twice**. On the
   third run where it would repeat "execute now" without execution or materially new
   evidence, auto-downgrade to `STALE_PENDING` regardless of how far price has moved, and
   stop repeating until fresh reassessment changes the classification.

Include a Pending Action Review **table** ReportBlock in `upsert_daily_log.actionTaken`
with headers: `Ticker`, `Original Action`, `Current Status`, `Evidence Today`,
`Updated Recommendation`.

## 2. Per-ticker pass

For every portfolio and watchlist ticker in `trackedTickers`:

- Read `currentPrice` / `lastPriceUpdate` / `pageNotes` from context (or `list_portfolio`).
  Run the §3 stale-sync check.
- Check stop loss, entry/add zone, target proximity, earnings timing, thesis status,
  repeated flags.
- **Backfill null enums first** — before any sleeve-dependent rule: portfolio `sleeve`,
  `riskLevel`, `conviction` (1–5), `theme`, `marketCapBucket`, `analystRating`,
  `addZone`, `nextAddTrigger`; watchlist `riskLevel`, `theme`, `marketCapBucket`,
  `analystRating`. Use canonical sleeve mapping from `_shared` §6 (do not re-derive).
  Re-confirm and write `earningsDate` when `earningsStale` or date is in the past.
  Cross-check `averageDownsUsed` against `list_trades` (`type=ADD` where
  `pricePerShare` < `myAvgCost`) when the field looks wrong. Do **not** write `shares` /
  `currentPrice` / `myAvgCost`.
- **Then** apply sleeve rules (`_shared` §6) — a broken stop on a `QUALITY_CORE` name is a
  review trigger, **not** an exit recommendation. With `sleeve: null`, you cannot evaluate
  this correctly; backfill must precede sleeve logic.
- Update portfolio `action` to a legal `PositionAction` only (`HOLD` | `ADD_ON_DIP` |
  `REDUCE` | `EXIT` | `WATCH`) — map freeform language per `_shared` §2.
- Update watchlist `priority` and/or `action` (`WatchlistAction`) per `_shared` §13.
- Append today's dated note via `append_page_notes` (`_shared` §12).

## 3. Daily Radar (§12.1)

**One** discovery pass, 1–2 web searches maximum. Scan for tickers or themes with unusual
volume, social momentum, or breaking catalysts **not** already in portfolio, watchlist, or
ideas.

For each credible hit (**max 2/day**): `upsert_idea` with `status="RESEARCHING"`,
`ideaStage="RADAR"`, `leadTicker` set, `whyInteresting` as
`[{ "type": "paragraph", "text": "…" }]`, source in `foundVia`, `dateFound`,
`lastReviewed`. No deep research at Radar stage — the Weekly vets stubs.

A Radar stub untouched across 2 consecutive weekly runs is auto-Passed by the Weekly.

## 4. Thesis-shock listener (§12.9)

Cheap, headline-level only. Produces output **only** on shocks — if nothing qualifies,
write nothing.

- One headline search for every idea whose `catalystDate` is within 21 days — confirm the
  thesis hasn't shifted, don't just count down.
- Any idea lead ticker that moved >±20% over the past week = **THESIS SHOCK**: same-day
  re-review, dated note via `append_page_notes` or idea `notes` as ReportBlock[],
  `ideaStage` re-check, `lastReviewed` updated. Do not wait for the weekly sweep.
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
them to manual approval. Flag off-theme names higher-risk and tag "off-core-theme —
value/quality exception" in `actionNotes` (ReportBlock[]).

**Don't chase:** if thesis qualifies but price is extended, still graduate — with
`priority="WAIT_FOR_ENTRY"` and a zone set **below** the current spike.

On graduation: `upsert_watchlist` (no duplicates) with `priority`, entry zone,
stop/invalidation, catalyst, risk notes; set `graduationDate` and `graduationPrice` on the
idea and note the `ideaStage` at graduation; flip idea `status="GRADUATED"`; append a
dated note via `append_page_notes`. Put conviction in the Decision Review /
`actionNotes`, not a watchlist conviction field (none exists).

**6b. Demotion.** Auto-demote only when confidence is HIGH. Demote when any of: thesis is
`BROKEN` (not merely weakening); a recorded hard invalidation triggered; sustained
AVOID/HOLD-OFF with a broken entry-zone floor for ≥10 trading days with no offsetting
catalyst; or structurally no longer investable.

Do **not** demote for price above the zone (that's WATCH — still worth monitoring), normal
high-beta volatility, or a single bad day.

On demotion: soft-demote per `_shared` §13 (`delete_watchlist` default or
`action="DEMOTED"`), put re-entry condition in `actionNotes` as ReportBlock[], open a
Decision Review row, append a dated note. **Keep the row** (no hard delete). Tracked
tickers auto-update on demote; call `sync_tracked_tickers` in §7 if anything looks off.
Re-promotion is automatic and symmetric if it later re-qualifies (`includeDemoted=true`
to find it).

**6c. Auto BUY signal.** Generate only when **all** standard-BUY conditions hold after fresh
§4 reassessment (`_shared` §9). If price is in zone but any confirmation is missing or
upside is modest → WAIT, not BUY.

On a BUY signal: `upsert_watchlist` with `action="BUY_SUGGESTED"` and
`priority="BUY_NOW"`; put entry/stop/target/conviction/catalyst/sizing/invalidation in
`actionNotes` as ReportBlock[]; `upsert_decision_review` with `decisionType="BUY"` and
§10 scorecard in `reasonForDecision`. Never imply the trade was placed. The name stays on
the watchlist until Ivan reports an actual buy via `log_trade`.

**EARLY ENTRY** signals (`_shared` §9): `action="EARLY_ENTRY"`, DR title prefixed
`EARLY ENTRY:`, max 3/week, always test-starter sizing. Separate labelled block in the log.

Include a curation **table** ReportBlock in `watchlistMove` with headers: `Ticker`,
`Change`, `Trigger / Confidence`, `New Action`, `Entry Zone`, `Stop`, `Notes`.

If nothing qualifies, write a paragraph block "no curation changes today" and move on.

## 7. Config ↔ database reconciliation (§11.5)

Reconcile `context.trackedTickers.portfolio` against `list_portfolio` (excluding CASH_USD)
and `trackedTickers.watchlist` against `list_watchlist`. If any orphan exists, call
`sync_tracked_tickers` (rebuilds Config from Portfolio + active Watchlist) and re-check.
Report only orphans that remain after sync — those need a missing Portfolio/Watchlist row
or a demotion, not a Config edit.

Never call `patch_config` for ticker lists or LIMITS.

## 8. Shadow test (§12.6, 60-day trial from 2026-07-07)

For every holding >20% above avg cost or past its target, log two **virtual** outcomes in
the daily log's Shadow Test section: (a) fixed target-cross trim executed at target,
(b) 15%-below-rolling-high trailing stop. The Monthly compares cumulative virtual P&L after
60 days and adopts the winner as the default winner-management rule.

## 9. Write the log

`upsert_daily_log` every run, keyed on `logDate` (today's MYT date, `YYYY-MM-DD`) — the
call is idempotent, so re-running updates rather than duplicating. All narrative fields
are `ReportBlock[]`. Stamp `rulesVersion`.

| Field | Content |
|---|---|
| `marketContext` | Short paragraphs or bullets — backdrop + sector/theme momentum (not a wall of text) |
| `topNews` | Prefer `bulleted_list_item` — one story per bullet; bold ticker in the line |
| `portfolioMove` | **One `bulleted_list_item` (or table row) per position.** Never pack multiple tickers into one paragraph. Line shape: `TICKER $price move · action · one-line reason` |
| `watchlistMove` | Prefer the curation **table** (§6). If freeform, still **one bullet per ticker** |
| `actionTaken` | Pending Action Review table (§1); summarise DR creates (full rows via `upsert_decision_review`) |
| `notes` | Shadow Test (§8), post-sync reconciliation notes (§7), hygiene flags, data-quality issues |
| `flaggedTickers` | String array — one entry per ticker, e.g. `"MRVL +12.8"` / `"VST -8.1"` (not one giant UP/DOWN sentence) |

**UI readability:** the portal splits legacy walls-of-text at `TICKER $price` boundaries, but
agents must write list/table blocks going forward so weekly/monthly stay scannable too.

Set `alertEmailSent=false` — no email, ever.
