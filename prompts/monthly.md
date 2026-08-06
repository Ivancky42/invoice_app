# Monthly routine — Macro Trend Survey + Learning Loop

**Schedule:** 1st of the month, 10:00 MYT.

Follow `_shared.md` in full.

**Tools:** `get_context(routine="monthly")`, `get_prompt`, `list_portfolio`,
`list_watchlist`, `list_ideas`, `list_trends`, `list_trades`, `list_decision_reviews`,
`list_daily_logs`, `list_reports`, `get_document` → `upsert_report`
(`reportType="MONTHLY"`), `upsert_trend`, `upsert_idea`, `patch_portfolio`,
`append_page_notes`, `upsert_decision_review`, `upsert_document` (Strategy Lessons only
when a repeated pattern warrants it — `_shared` §15), `sync_tracked_tickers`. Never
`log_trade`, never `patch_config`.

Learning-loop memory: `list_decision_reviews`, `list_daily_logs` (up to 90 days),
`list_reports` (`WEEKLY` + prior `MONTHLY`), plus `get_document("STRATEGY_LESSONS")`.

---

## 1. Conviction re-rank + re-buy test (§12.6)

Re-score every holding's `conviction` (1–5) via `patch_portfolio` and answer, per holding:
**"would this system issue a BUY on this name today, at this price, fresh?"** Record
YES/NO plus one line in the report.

Score against the right criteria for the sleeve: `QUALITY_CORE` names against quality
criteria (moat, margins, FCF, growth durability, valuation vs own history), not the 7
momentum criteria. `MOMENTUM_CATALYST` and `SPECULATIVE` against the 7.

A holding failing the re-buy test in **2 consecutive months with conviction ≤2** → formal
TRIM or EXIT recommendation (`action=REDUCE` or `EXIT`), not silence.

Report the re-rank **by sleeve**.

## 2. Discovery Scorecard (§12.3)

The measure of whether discovery is actually early. Compute and log:

1. **Discovery P&L** — for each name graduated to the watchlist, hypothetical return from
   `graduationPrice` / `graduationDate` to now, vs SPX over the same window.
2. **Earliness lag** — days between our `graduationDate` and the first major analyst
   initiation or mainstream-coverage milestone. Estimate via web search; note confidence.
3. **Average stage at graduation.**

Target: graduate at `PRE_BUZZ` / `EMERGING`, before `INSTITUTIONALIZING`. If most
graduations happen at `INSTITUTIONALIZING` / `MAINSTREAM`, **say so explicitly and diagnose
which sweep failed.**

Track **EARLY ENTRY** (`_shared` §9) and **QUALITY REBOUND** outcomes separately, so each
tier earns or loses trust on its own record. If EARLY ENTRY's 90-day hit rate is materially
worse than standard BUYs **and** average loss exceeds test-starter tolerance, recommend
retiring the tier. Promote, adjust, or retire QUALITY REBOUND after 3 completed cases.

> Older idea rows may still lack `graduationDate` / `graduationPrice` / `leadTicker`.
> Reconstruct what you can from Decision Reviews and state confidence. Do not present
> reconstructed figures as measured.

## 3. Shadow test verdict (§12.6)

The 60-day trailing-stop shadow test started 2026-07-07 and matures ~2026-09-05. Compare
cumulative virtual P&L of (a) fixed target-cross trim vs (b) 15%-below-rolling-high
trailing stop, and adopt the winner as the default winner-management rule. Until maturity,
report progress only. Source virtual outcomes from `list_daily_logs` Shadow Test sections.

## 4. Learning loop (§10.6)

Review Decision Review rows from the past ~90 days where: stop-loss triggered;
take-profit/trim triggered; an alert expired; an action went stale; a reversal was
detected; an analyst target conflicted with price action; strategy changed after new
evidence. Prefer `list_decision_reviews` over inventing history.

Score three things separately:

- **Signal quality** — was the original signal good? (good signal/good outcome; good
  signal/poor execution; bad signal/avoided loss; bad signal/opportunity cost; early signal
  later confirmed; false signal reversed quickly)
- **Execution quality** — right timing? (prompt; delayed but acceptable; delayed and lost
  edge; missed; avoided an unnecessary trade; required manual override)
- **Adaptation quality** — did the system adapt after new information? (correctly held
  despite stop breach; correctly exited despite rebound; correctly marked expired;
  incorrectly repeated a stale alert; incorrectly followed an analyst target; incorrectly
  ignored improving momentum)

Judge decisions on whether the system recognised changing evidence, avoided stale alerts,
adjusted when the thesis evolved, and avoided known anti-patterns — **not** merely on
whether the original stop or target was hit.

Score outcomes against the **pre-registered** scorecard (`_shared` §10), never against
memory. Flag lessons from decisions lacking a pre-registered scorecard as lower-confidence.
Update DR outcome / quality fields via `upsert_decision_review` when scoring.

Questions to answer: did strict stops protect capital or cause whipsaw, and are stops too
tight for high-beta names? Did immediate trims beat holding winners with strong momentum?
Did take-profit alerts go stale too often, and should some names use trailing stops? Were
analyst targets useful or misleading, and in which sectors? Were reversals detected early
enough, and did the system confuse dead-cat bounces with real recoveries? Which strategies
were upgraded, downgraded, abandoned, or reset?

**Only update lessons on a repeated pattern across ≥3 similar reviewed cases.** Never from a
single anecdote. When updating living lessons, use `upsert_document` for
`STRATEGY_LESSONS` (ReportBlock[] body) — never invent a Config rewrite.

## 5. Hygiene sweeps

**Series compression (§11.7).** Where ≥3 Decision Review entries exist for the same ticker
and the same underlying action thesis, compress: keep one authoritative entry, mark
duplicates `CLOSED`, append a dated compression note naming them and where the lesson
lives. Closed duplicates are never reopened.

**Orphaned pending sweep (§11.9).** Sweep every pending Decision Review older than 35 days —
the weekly loop only covers 7–35 days, so anything older silently escapes the learning
loop. For each: complete and score the review, or mark it `CLOSED` with a one-line reason.
Report an **Orphaned Reviews Cleared** count. No pending item may age out unreviewed.

**Trend retrospectives.** For trends discovered ~3 months ago, set `verdict` — `WIN` /
`LOSS` / `ONGOING` / `TOO_EARLY` — and write the `retrospective` as ReportBlock[]. This is
a backward-looking outcome field, **not** a forward-looking buy/avoid signal. Populate
`avoidReason` and `similarToPastTrend` where relevant.

## 6. Summarise

Best and worst portfolio decisions; best and worst watchlist calls; trends that accelerated,
peaked, faded, or reversed; ideas that should graduate, stay, or be dropped; repeated thesis
alerts; repeated anti-patterns; stop-loss decisions that protected capital vs caused
whipsaw; take-profit/trim decisions that worked, expired, or went stale; analyst-target
calls that helped vs misled; reversals correctly or incorrectly recognised.

## 7. Report

`upsert_report(reportType="MONTHLY", reportDate=<1st, YYYY-MM-DD>)`, `content` as
`ReportBlock[]` (JSON blocks, not markdown). Stamp `rulesVersion`. Required sections:

- **Discovery Scorecard** (§2) — discovery P&L, earliness lag, average stage at graduation,
  EARLY ENTRY and QUALITY REBOUND tracked separately
- **Conviction re-rank by sleeve** (§1) — including re-buy test YES/NO per holding
- **Adaptive Strategy Lessons** — Pattern | Evidence Count | Worked / Failed | New Lesson |
  Apply To
- **Rules To Add / Modify** — Existing Rule | Problem Found | Updated Rule | Confidence
- **Orphaned Reviews Cleared** count (§5)
- **Shadow Test** progress or verdict (§3)

Rule changes are **recommendations to Ivan**, delivered in the report. Agents never edit
`/prompts` and never call `patch_config` — the system must not rewrite the rules it is
evaluated against.
