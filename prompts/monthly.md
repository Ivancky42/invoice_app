# Monthly routine — Macro Trend Survey + Learning Loop

**Schedule:** 1st of the month, 10:00 MYT.

Follow `_shared.md` in full.

**Tools:** `get_context(routine="monthly")`, `get_prompt`, `list_*` → `upsert_report`
(`reportType="MONTHLY"`), `upsert_trend`, `upsert_idea`, `patch_portfolio`.
Never `log_trade`, never `patch_config`.

Read the past 90 days of daily logs and weekly reports.

---

## 1. Conviction re-rank + re-buy test (§12.6)

Re-score every holding's `conviction` (1–5) and answer, per holding: **"would this system
issue a BUY on this name today, at this price, fresh?"** Record YES/NO plus one line.

Score against the right criteria for the sleeve: `QUALITY_CORE` names against quality
criteria (moat, margins, FCF, growth durability, valuation vs own history), not the 7
momentum criteria. `MOMENTUM_CATALYST` and `SPECULATIVE` against the 7.

A holding failing the re-buy test in **2 consecutive months with conviction ≤2** → formal
TRIM or EXIT recommendation, not silence.

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

Track **EARLY ENTRY** (§12.8) and **QUALITY REBOUND** (§12.12) outcomes separately, so each
tier earns or loses trust on its own record. If EARLY ENTRY's 90-day hit rate is materially
worse than standard BUYs **and** average loss exceeds test-starter tolerance, recommend
retiring the tier. Promote, adjust, or retire QUALITY REBOUND after 3 completed cases.

> **[GAP]** `graduationDate` / `graduationPrice` may still be null on older idea rows, and
> some ideas may lack `leadTicker`. Until Weekly has populated them, reconstruct what you
> can from weekly reports and state the confidence level. Do not present reconstructed
> figures as measured.

## 3. Shadow test verdict (§12.6)

The 60-day trailing-stop shadow test started 2026-07-07 and matures ~2026-09-05. Compare
cumulative virtual P&L of (a) fixed target-cross trim vs (b) 15%-below-rolling-high
trailing stop, and adopt the winner as the default winner-management rule. Until maturity,
report progress only.

## 4. Learning loop (§10.6)

Review all decisions from the past 90 days where: stop-loss triggered; take-profit/trim
triggered; an alert expired; an action went stale; a reversal was detected; an analyst
target conflicted with price action; strategy changed after new evidence.

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

Score outcomes against the **pre-registered** scorecard (§12.4), never against memory. Flag
lessons from decisions lacking a pre-registered scorecard as lower-confidence.

Questions to answer: did strict stops protect capital or cause whipsaw, and are stops too
tight for high-beta names? Did immediate trims beat holding winners with strong momentum?
Did take-profit alerts go stale too often, and should some names use trailing stops? Were
analyst targets useful or misleading, and in which sectors? Were reversals detected early
enough, and did the system confuse dead-cat bounces with real recoveries? Which strategies
were upgraded, downgraded, abandoned, or reset?

**Only update lessons on a repeated pattern across ≥3 similar reviewed cases.** Never from a
single anecdote.

## 5. Hygiene sweeps

**Series compression (§11.7).** Where ≥3 decision entries exist for the same ticker and the
same underlying action thesis, compress: keep one authoritative entry, mark duplicates
closed, append a dated compression note naming them and where the lesson lives. Closed
duplicates are never reopened. Precedent: the DDOG $220 REDUCE escalation series and the
TER above-target AVOID series.

**Orphaned pending sweep (§11.9).** Sweep every pending decision older than 35 days — the
weekly loop only covers 7–35 days, so anything older silently escapes the learning loop.
For each: complete and score the review, or mark it closed with a one-line reason. Report an
**Orphaned Reviews Cleared** count. No pending item may age out unreviewed.

> **[GAP]** Both sweeps operate on the Decision Review Log, which has no Neon table. Until
> one exists, run them over the decision tables recorded in daily logs and weekly reports,
> and state the coverage limitation in the report.

**Trend retrospectives.** For trends discovered ~3 months ago, set `verdict` — `WIN` /
`LOSS` / `ONGOING` / `TOO_EARLY` — and write the `retrospective`. This is a backward-looking
outcome field, **not** a forward-looking buy/avoid signal. Populate `avoidReason` and
`similarToPastTrend` where relevant.

## 6. Summarise

Best and worst portfolio decisions; best and worst watchlist calls; trends that accelerated,
peaked, faded, or reversed; ideas that should graduate, stay, or be dropped; repeated thesis
alerts; repeated anti-patterns; stop-loss decisions that protected capital vs caused
whipsaw; take-profit/trim decisions that worked, expired, or went stale; analyst-target
calls that helped vs misled; reversals correctly or incorrectly recognised.

## 7. Report

`upsert_report(reportType="MONTHLY", reportDate=<1st, YYYY-MM-DD>)`, content as
`ReportBlock[]`. Stamp `rulesVersion`. Required sections:

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
