# Stock HQ — shared contract

Baseline for all routines (daily / weekly / earnings / monthly). **Neon is the book of
record.** Notion is a frozen archive — never read it, never write to it.

Ported from the Notion canonical page (Cowork Setup, Sections 2–13) on 2026-08-05.
Living strategy docs: `get_document` / `upsert_document` for `STRATEGY_LESSONS` and
`INVESTMENT_STYLE` (also included on `get_context.documents`).

---

## 1. Runtime source of truth

1. `get_context(routine=…)` **first**. Authoritative for cash, NAV, positions, watchlist,
   trends, ideas, `documents`, `limits`, `thresholds`, `trackedTickers`, legal `enums`,
   `rulesVersion`. If it errors or is unavailable: **STOP and report.** Never proceed from
   memory or from a previous run's state.
2. `get_prompt("_shared")` + `get_prompt("<routine>")`. Follow both exactly.
3. Read Strategy Lessons / Investment Style via context `documents` or `get_document`.
4. Analyse. Then write only via Stock HQ MCP tools.

Do not rely on stale config copied into a routine.

## 2. Write contract

- Status-like fields take `SCREAMING_SNAKE_CASE` values from the context `enums` payload.
  Never invent one. Never add emoji. If nothing fits, omit the field and say so in the
  daily log.
- Narrative is `ReportBlock[]` JSON — never markdown, never a plain string. Example
  table block:

```json
{
  "type": "table",
  "headers": ["Ticker", "Action", "Notes"],
  "rows": [["DDOG", "HOLD", "Thesis intact"]]
}
```

  Other allowed types: `paragraph`, `heading_1`/`heading_2`/`heading_3`,
  `bulleted_list_item`, `numbered_list_item`, `quote`, `callout`, `divider`. One-line
  notes are still `[{ "type": "paragraph", "text": "…" }]`, never a bare string.
- Every write is idempotent. Supply `idempotencyKey` on trades and Decision Review creates.
- `400` = bad payload: read the returned legal values, fix, retry **once**.
- `409` = portfolio rule violated: **do not retry.** Record and report to Ivan.
- `200` + `warnings[]` = soft sizing-band mismatch: proceed, surface the warning.
- Stamp `rulesVersion` from context on tools that accept it: `upsert_daily_log`,
  `upsert_report`, `upsert_decision_review`, `append_page_notes`, `log_trade`,
  `upsert_document`. It is a short git SHA (e.g. `17c6643`), never a date — so each
  decision can be resolved to the exact ruleset. Do **not** invent extra props on
  `patch_portfolio` / `upsert_watchlist` / `upsert_idea` / `upsert_trend` (those
  schemas omit it).
- **`upsert_daily_log` is keyed by `(logDate, routineType)`.** Daily passes
  `routineType=DAILY` (or omit — default). Earnings **must** pass `routineType=EARNINGS`.
  Same calendar day, different routines — never overwrite each other.
- **Never write marks.** `currentPrice`, `shares`, and `myAvgCost` come from the price
  sync / `log_trade` only. Agents **do** write `analystTarget` (consensus USD) via
  `patch_portfolio` / `upsert_watchlist` — the server recomputes `upsidePct`. Never write
  `upsidePct` directly.
- **`patch_config` is not on MCP.** Cash/FX/LIMITS changes are HTTP-only for Ivan.
  Ticker-list hygiene uses `sync_tracked_tickers`.
- Never email Ivan. All output goes to Neon.

### Portfolio `action` vs recommendation language

`patch_portfolio.action` accepts only `PositionAction`: `HOLD` | `ADD_ON_DIP` |
`REDUCE` | `EXIT` | `WATCH`. Map freeform recommendations in narrative/DR as follows:

| Recommendation (narrative / DR `decisionType`) | Portfolio `action` |
|---|---|
| HOLD | `HOLD` |
| ADD / AVERAGE_DOWN / ADD_ON_DIP | `ADD_ON_DIP` |
| REDUCE / TRIM / TRAIL STOP / RESET STOP | `REDUCE` (detail in notes/DR) |
| EXIT | `EXIT` |
| WAIT / AVOID / DO_NOT_AVERAGE_DOWN / WATCH | `WATCH` (detail in notes/DR) |

`DecisionType` on `upsert_decision_review` is separate: `BUY` | `ADD` | `AVERAGE_DOWN` |
`HOLD` | `REDUCE` | `EXIT` | `WAIT` | `AVOID` | `DO_NOT_AVERAGE_DOWN`.

### History reads

Use `list_daily_logs` (`since`/`until`/`limit`/`routineType`, default 14, max 90) and
`list_reports` (`reportType`, `since`/`until`/`limit`, default 8, max 36) for prior
narrative memory. Filter `routineType=DAILY` or `EARNINGS` when you need one stream only.
Use `list_decision_reviews` for pending/scored decisions. Prefer bounded windows over
pulling max every run.

`lastPriceUpdate`, `priceStatus` (`OK` | `STALE` | `SYNC_FAILED` | `UNKNOWN`), and a
**truncated** `pageNotes` preview (newest ~3 blocks) are on `get_context.positions` /
watchlist and on `list_portfolio` / `list_watchlist`. When `pageNotesTruncated=true`,
fetch older history with `get_page_notes` (`target`, `ticker`, `limit`, `offset`) — never
expect full ticker-note history in context/list payloads.

`lastRun.prices.failedTickers` / `failedDetails` expose the last price-sync misses.

### Tracked tickers

`TRACKED_TICKERS` is maintained automatically on watchlist upsert/demote/delete and
`log_trade`. Call `sync_tracked_tickers` in the Daily reconcile pass to force a rebuild
from Portfolio + active Watchlist (excludes DEMOTED/DROPPED). Do **not** use
`patch_config` for ticker lists in routines.

<!-- KERNEL:BEGIN id=price-provenance v=1 -->
## 3. Price provenance (§12.10-C — supersedes the voided §12.10)

The sync runs ~06:00 MYT ≈ 18:00 ET, ~2h after the US close. The Daily routine runs
~08:00 MYT ≈ 20:00 ET. Therefore `currentPrice` values **are final closing prices** of the
just-completed session — label them "US close (date)" with confidence, do not hedge as
"intraday".

- **Stale-sync check:** compare each position/watchlist row's `lastPriceUpdate` and
  `priceStatus` (from context or `list_portfolio` / `list_watchlist`) to the last
  completed US session (respecting holidays/weekends). Flag `STALE SYNC` / treat
  `priceStatus=STALE` or `SYNC_FAILED` as non-actionable marks.
- **Block recommendations on bad marks:** do **not** issue BUY / ADD / EXIT / REDUCE /
  RESET STOP / zone-hit recommendations that depend on `currentPrice` when
  `priceStatus` is `SYNC_FAILED`, `STALE`, or `UNKNOWN` for that ticker. Flag the data
  issue, reason from the last known-good close if available, and wait for a clean sync.
  Narrative HOLD/WATCH commentary is fine; size-changing or stop-changing calls are not.
- The system sees one price per session. Intraday wicks are invisible by design — all
  stop/zone/trigger evaluations are made on closing prices.
- Ideas `currentPrice` is **unreliable** unless `priceReliable: true` (requires
  `leadTicker`). Do not quote unreliable idea prices. §11.4 sanity rules apply: never write
  one price for a basket; if a value differs >50% from the previous stored value or doesn't
  plausibly match the lead ticker, flag rather than use.
<!-- KERNEL:END id=price-provenance -->

## 4. Adaptive Decision Layer (§10) — highest authority

Do not blindly carry forward stop-loss, take-profit, trim, buy-zone, or analyst-target
alerts. Re-evaluate every pending action against current context before repeating it.
Classify each as exactly one of:

| State | Meaning |
|---|---|
| `STILL_VALID` | Original action still supported by current price, trend, momentum, thesis, risk/reward, catalyst |
| `RECOVERED_NEEDS_REVIEW` | Sell/stop trigger hit but price recovered above it — reassess; do not repeat "sell now" |
| `REVERSAL_CONFIRMED` | Original action materially invalidated by new evidence — recommend a new strategy |
| `MISSED_OR_EXPIRED` | Take-profit/trim/buy-zone opportunity no longer actionable |
| `STALE_PENDING` | Pending >5 trading days without execution or confirmation — downgrade urgency |
| `SUPERSEDED` | A newer signal replaced it — update in place, don't repeat the old one |
| `RESOLVED` | Ivan confirmed executed / cancelled / reset / replaced |

Rules:
- Stop-loss and take-profit levels are **decision triggers, not automatic commands**.
- **Breached-stop resolution (non-negotiable for MOMENTUM_CATALYST / SPECULATIVE):**
  if `currentPrice` closed through `stopLoss`, the pending action must be resolved the
  same Daily run — either (a) keep `EXIT`/`REDUCE` as `STILL_VALID` and escalate for
  execution, or (b) formally **RESET STOP** via `patch_portfolio` with a written reason
  and new level. A breached stop that is neither executed nor re-set is not a stop —
  flag `STOP_IN_LIMBO`. Soft-stale after 5 sessions (`STALE_PENDING`); hard hygiene
  failure after 10. `QUALITY_CORE` stays advisory (§6) but must still be reclassified
  (HOLD / RESET STOP / REDUCE), never ignored.
- **Pending EXIT/REDUCE into earnings:** if a stop-out or reduce is `STILL_VALID` and
  `daysToEarnings` ≤ 2 (or earnings is tomorrow / today), the Daily/Earnings routine
  must choose explicitly: (1) **recommend execution before the print**, or (2) **defer
  past the print** with reason, adaptive state, and a RESET STOP or WAIT — never leave
  an unexecuted EXIT colliding with a binary event by silence. Lesson #1 covers adds;
  this rule covers pending exits.
- Analyst targets are one signal only. Never recommend on target alone. Weigh momentum,
  technical structure, sector trend, catalyst quality, news, valuation/risk-reward, and
  Strategy Lessons. If targets conflict with price action, explain the conflict and prefer
  `WAIT / REASSESS`. If stored `analystTarget` / `upsidePct` disagree with recent PTs in
  notes or with `(target − price) / price`, refresh the target first (`_shared` §14) —
  do not escalate on a fossil upside figure.
- Entry-zone hit is **not** automatically BUY. Evaluate constructive move vs falling knife.
  In zone but confirmation missing → WAIT. Zone entered via thesis damage, bad earnings,
  dilution, broken support, or sector weakness → AVOID.
- Mixed evidence → WAIT / REASSESS. Do not force a trade.
- Reversal forming → state explicitly which: early reversal, confirmed reversal, failed
  rebound, or trend continuation.
- Never say "execute now" / "execute before the print" unless `STILL_VALID` after fresh
  reassessment — and even then prefer **"recommend execution …"** so the advisory
  boundary stays unambiguous (`_shared` §5).

### Escalation cap vs Outstanding Decisions (§11.8)

An alert may escalate **urgency language** at most **twice**. On the third run where it
would repeat "recommend execution now" without Ivan confirming or materially new
evidence, stop repeating the urgent phrasing and classify urgency as `STALE_PENDING`.

**Do not drop a still-valid unresolved EXIT/REDUCE** just because the urgency cap fired.
Keep it in a persistent **Outstanding Decisions** section of the Daily log
(`actionTaken` or `notes`) with: ticker, original action, adaptive state, last reviewed
date, and current recommendation (calm wording). Reassess every run; only remove when
`RESOLVED` / `SUPERSEDED` / `MISSED_OR_EXPIRED` / `REVERSAL_CONFIRMED` with a written
replacement.

### Stabilization definition (§12.11 — kills unfalsifiable WAIT)

After a knife-day zone entry (single-session drop ≥7% into/through a zone, or a ≥10%
post-earnings gap), the name becomes BUY-eligible when the **first** of these fires, on
official closes:

- (a) two consecutive closes above the knife-day close, or
- (b) a close above the highest close of the trailing 5 sessions, or
- (c) three consecutive in-zone sessions with no new closing low.

If none fires within 10 sessions while price remains in zone, the Weekly must explicitly
re-underwrite (zone validity, thesis, catalyst) rather than silently extending WAIT. A
close >~3% below the zone floor invalidates the setup (MU rule).

### Recommendation tone (§10.7)

Decision-support monitor, not an execution engine. Prefer **"recommend execution"** /
"Confirm / reassess" / "Wait" — never imply the agent placed a trade. Use urgent
"recommend execution now" only when `STILL_VALID` and high-confidence; "Confirm /
reassess" when the signal changed; "Wait" on mixed evidence; "Expired"; "Superseded";
"Reset strategy". Every recommendation answers: (1) what changed, (2) why the old action
does or doesn't still apply, (3) what Ivan should decide next.

### Evidence provenance (material recommendations)

Every **material** recommendation (BUY / ADD / REDUCE / EXIT / RESET STOP / EARLY ENTRY /
new idea graduation / earnings HOLD-through) must cite:

| Field | Required |
|---|---|
| Source name + direct URL | Yes (or "company filing / IR" with link) |
| Publication / event date | Yes |
| Filing/company vs analyst/social | Label which |
| Fact vs agent inference | Explicit |
| Price / session "as of" | `lastPriceUpdate` + session label (US close date) |

Do not present inferred conclusions as filed facts. If the only source is prior notes,
say so.

<!-- KERNEL:BEGIN id=execution-boundary v=1 -->
## 5. Execution boundary — non-negotiable

- Never place, execute, route, schedule, or simulate a real trade. Never imply one
  happened. All real-money execution is Ivan's, in his own broker.
- A BUY signal is a **suggestion**. It must never move a name into the portfolio. A stock
  enters `list_portfolio` only when Ivan reports an actual trade via `log_trade`.
- Never auto-add to Portfolio via any tool.
<!-- KERNEL:END id=execution-boundary -->

## 6. Sleeves (§12.13)

Every position carries `sleeve` — `QUALITY_CORE` / `MOMENTUM_CATALYST` / `SPECULATIVE`.
Sleeve is stored on the position and read from `get_context`. New holdings default to
`MOMENTUM_CATALYST` until the Weekly assigns one; never re-derive a sleeve that is already
set. If `sleeve` is null when you touch a row, apply the default and flag it for Weekly
confirmation.

- **`QUALITY_CORE`** — price stops are **advisory review triggers only**, never auto-EXIT
  on price alone. Judged on fundamentals + valuation vs own history (moat, margins, FCF,
  growth durability). The monthly re-buy test scores against those quality criteria, not
  the 7 momentum criteria. Holding through earnings is the default. QUALITY REBOUND adds
  (§12.12) are the natural add mechanism.
- **`MOMENTUM_CATALYST`** — full §§10–12 as written: stops, zones, 7-criteria re-buy test,
  extended-winner scans. Initial stop typically ~12–20% below constructive entry; trail /
  ratchet after +30% from cost (see Stop policy below).
- **`SPECULATIVE`** — **hard** test-starter ceiling on the name at all times
  (`limits.tierBands.TEST_STARTER`, default 2–3% ex-CSPX); `log_trade` rejects size-
  increasing BUY/ADD that would leave the name above that band. Hard stops; adds only on
  fired thesis milestones (§12.7); first candidates for capital recycling.

**Sleeve aggregate cap:** `limits.speculativeSleevePct` (default **15%** of ex-CSPX NAV)
caps the sum of all `SPECULATIVE` weights. `log_trade` rejects size-increasing fills that
breach it. Context exposes `nav.sleeveExposure` (fractions). If live Speculative exposure
is already over the cap, Daily/Weekly must prioritise trims / recycling — no new Spec
adds, no adds that grow an already-oversize Spec name.

### Stop policy (placement + ratchet)

Stops are sleeve-aware decision triggers. On every Daily/Weekly touch of a name, evaluate
`stopDistancePct` = `(stopLoss − currentPrice) / currentPrice` from context:

| Sleeve | Initial stop (new / reset) | Ratchet / hygiene |
|---|---|---|
| `SPECULATIVE` | ~10–18% below entry / structure | Prefer tighter; if stop >20% below spot while thesis intact, RESET toward structure or trail |
| `MOMENTUM_CATALYST` | ~12–20% below constructive entry | After ≥+30% from cost, trail (shadow 15%-below-rolling-high is the pilot default) or raise stop so distance is not a cost-era formality; flag `STALE_STOP` if >25% below spot |
| `QUALITY_CORE` | Wider advisory ok | Breach → review / RESET STOP / REDUCE narrative, not auto-EXIT |

Never leave inverted risk (Spec stop wider than Momentum on similar vol) without an explicit
reason in notes. Shadow-test trailing outcomes inform the official stop — they do not
replace writing `stopLoss`.

## 7. Position sizing (§12.5)

Portfolio value = `nav.totalValue` from context. Caps use **ex-CSPX** NAV from
`nav.exCspxNav` (and position `weightPct` in context is already vs ex-CSPX). CSPX itself
has `weightPct: null` and is exempt from the single-name cap.

| Band | Size | When |
|---|---|---|
| Test starter | 2–3% | Mandatory ceiling for EARLY ENTRY, Very High risk, pre-revenue, dilution-risk, thesis-weakened names, **all SPECULATIVE**, and **conviction ≤2** |
| Confirmation add | ~5–6% | After the thesis metric confirms; conviction ≥3 |
| Conviction | up to 8% | Conviction 5, thesis intact |

Hard caps from `context.limits`: single position 15% ex-CSPX; theme cluster 30%;
**Speculative sleeve** `speculativeSleevePct` (default 15% ex-CSPX); cash floor ≥5% unless
deploying into a conviction-5, in-zone, catalyst-dated setup.

**Conviction ↔ size:** a conviction-1/2 name must not sit above the test-starter band.
If it already does, Daily must recommend REDUCE toward the band (capital recycling) —
do not ADD. Soft `conviction_size_mismatch` warning fires on `log_trade` when an increase
would leave conv≤2 above test-starter.

**Theme / cluster coverage:** prefer a legal `Theme` when one fits (see §13). Leaving
`theme` null is permitted when nothing maps honestly — do **not** force a wrong bucket
just to satisfy the cap. Null-theme non-CSPX holdings are **uncapped exposures**: every
Daily construction scan must list them with weight under `UNCAPPED_THEME` so they cannot
sit unnoticed. Prefer assigning a real theme (e.g. `SOCIAL_PLATFORMS` for RDDT) when one
exists. CSPX stays theme-null by design and is excluded from theme weights; do **not**
invent look-through AI exposure into the theme cap — note look-through separately in
narrative if relevant. `log_trade` warns (does not hard-block) on non-CSPX BUY/ADD with
null theme.

**Unknown earnings date blocks adds:** if `earningsStale: true` or `earningsDate` is null
on an operating company (not CSPX/cash), treat the Lesson #1 window as **unknowable** —
block BUY / ADD / AVERAGE_DOWN / EARLY ENTRY / QUALITY REBOUND adds until the next date is
written. HOLD / EXIT / REDUCE still allowed. Absence of a date is not "safe."

Every BUY / EARLY ENTRY / ADD signal must state: suggested dollar amount **and** share
count at stored price, resulting position weight, resulting theme weight, resulting
sleeve weight (`nav.sleeveExposure`), and remaining cash. A signal breaching a cap must
say so and either resize or invoke the capital-recycling rule (§12.6).

Use `averageDownsUsed` from context (backfilled / maintained by `log_trade`). When you
touch a row, set `theme` if a legal value fits; if none fits, leave null and ensure the
Daily `UNCAPPED_THEME` scan will surface it.

## 8. Averaging down / pyramiding (§12.7)

Adds on existing holdings are first-class signals, evaluated every Daily run.

**Add below cost (average down)** requires ALL of: price in add zone; thesis `INTACT` or
`STRENGTHENING` (never `WEAKENING`/`BROKEN`); the next add trigger fired or a clear dated
catalyst ahead; not within 7–10 days pre-earnings (small Test add exception); adds used
< 2 (**hard cap — max 2 average-downs per name, ever**); constructive tape, not a falling
knife. Label Test / Confirmation / Conviction add and size per §7. This cap also covers
QUALITY REBOUND fills below cost — see §9.

**Add above cost (pyramiding into strength)** is allowed and encouraged on `STRENGTHENING`
thesis + in add zone + conviction ≥4 — the preferred way to build winners (GEV/VST
pattern). Does **not** count against the two-average-down cap.

Lesson #1 (no averaging down pre-earnings) remains binding.

Every Portfolio row must carry `addZone` and `nextAddTrigger` (§12.7). Set/refresh via
`patch_portfolio`. Weekly refreshes both. Cross-check `averageDownsUsed` against
`list_trades` (`type=ADD` where `pricePerShare` < `myAvgCost`) if the field looks wrong.

## 9. Signal tiers

**Standard BUY** — all Section 6 conditions after fresh §10 reassessment: price in zone
and constructive, thesis `INTACT`/`STRENGTHENING`, clear catalyst, acceptable risk/reward,
identifiable stop, conviction 4–5, `STILL_VALID`, not chasing above zone or above analyst
target. Very high-risk / pre-revenue / dilution / thesis-weak names cap at
"BUY — test starter only".

**EARLY ENTRY (§12.8)** — conviction 3+ AND price in or near a definable zone AND a dated
catalyst within ~45 days AND plausible (not confirmed) thesis AND identifiable stop.
Always test-starter sizing. Max **3 per week**. Never within 7 days pre-earnings. Never on
a `WEAKENING`-or-worse thesis. Present in a separate labelled block, never mixed with
standard BUYs.

**QUALITY REBOUND (§12.12, pilot)** — all required: consistently profitable with net cash;
wide moat / dominant share; latest results beat on **both** revenue and EPS (never on a
miss); single-day drop ≥10% attributable to guide-tone / multiple compression, not thesis
damage. If `beatRate` is null, verify the dual beat from the print (web/notes) before
clearing the gate — do not skip it. Write the verified beat summary into the DR /
`append_page_notes` and patch `beatRate` when known.

**Re-ignition engine (mandatory, every QR signal):** state explicitly
`ENGINE_PRESENT` or `ENGINE_ABSENT` with one-line evidence (analyst-raise wave, index
inclusion, live sector narrative?).
- `ENGINE_PRESENT` (TER-Apr pattern) → full template sizing.
- `ENGINE_ABSENT` (the rule's ISRG pattern: flat/cut targets, no raise wave) → slower
  flatter base; **halve tranche 1 only**. Never size a full T1 on an absent engine.
  Record the halved share count and dollar amount in the DR.

**Staging vs average-down cap (§12.7):** QR adds **below** `myAvgCost` **do** consume
`averageDownsUsed` (same hard lifetime cap of 2 — `log_trade` enforces it). They are
**not** exempt the way pyramiding-above-cost is. Therefore:
- Ideal "thirds" template applies in full only when future tranches are expected **at or
  above** cost, or when `averageDownsUsed` headroom allows.
- When the name is **below cost** at plan time: schedule **at most two** below-cost QR
  adds — prefer T1 = §12.11 stabilization, T2 = gap-midpoint close. The catalyst/"next
  print" gate becomes **HOLD / reassess**, not a third ADD, unless by then either
  (a) `averageDownsUsed < 2` still, or (b) price ≥ `myAvgCost` (pyramiding — does not
  consume the cap). Never publish a three-ADD below-cost plan.
- Every QR ADD signal must state: engine state, tranche index (T1/T2/T3), whether this
  fill is below cost, `averageDownsUsed` before/after if executed, and remaining AD
  headroom.

Total QR size capped at test-starter band during the pilot. Max 1 new QR initiation per
month. Pre-register the quality checklist + engine state + tranche plan (not the 7
momentum criteria).

## 10. Criteria pre-registration (§12.4)

Every BUY / EARLY ENTRY / ADD / WAIT decision records the 7-criteria scorecard **at
decision time**, in this fixed format:

```
Criteria at decision (n/7): AI/future-tech ✓/✗, social momentum ✓/✗,
cluster behaviour ✓/✗, clear catalyst ✓/✗, institutional buying ✓/✗,
undervaluation ✓/✗, entry zone ✓/✗
```

Outcome scoring happens later against this pre-registered scorecard, never against memory.
Lessons derived from decisions **without** a pre-registered scorecard are flagged
lower-confidence. When a DR row has no scorecard (including migration seeds), tag
`antiPatternTags` with `NO_PREREGISTERED_SCORECARD` so the monthly learning loop can
discount it automatically.

## 11. Decision Review Log

Use `upsert_decision_review` / `list_decision_reviews`. Stamp `idempotencyKey` on creates.
Default `reviewStatus=PENDING`. Put the §12.4 criteria scorecard inside `reasonForDecision`.

Decision Reviews are live in Neon (migration seed complete — do **not** re-run
`scripts/seed-decision-reviews.ts` unless Ivan explicitly asks). Source pending actions
from `list_decision_reviews`, not from reconstructing Notion-era notes.

Decisions that warrant a DR entry: BUY, ADD, AVERAGE_DOWN, REDUCE, EXIT, WAIT before
catalyst/earnings, AVOID, DO_NOT_AVERAGE_DOWN, stop-loss action, thesis alert, earnings
result action, stock entering entry/add zone, and HOLD **only** when it is a deliberate
catalyst decision. **Not** for ordinary no-news HOLD days.

Token hygiene (§5 / §11.7–11.9): read Strategy Lessons first; then only DR rows for tickers
under analysis plus Pending reviews due within 7 days. Compress series; do not spam.

## 12. Ticker notes

`pageNotes` are **append-only**. Use `append_page_notes` (`target=portfolio|watchlist`)
with `blocks` as `ReportBlock[]`. Do **not** replace via `patch_portfolio.pageNotes` /
`upsert_watchlist.pageNotes` unless intentionally rewriting history.

Context / list serializers return only the **newest ~3** blocks plus
`pageNotesTotal` / `pageNotesTruncated`. Use `get_page_notes` for older history.
`append_page_notes` responses are similarly truncated — do not treat the response as the
full note body.

**When to append (material only — not every ticker every day):**
- A recommendation or adaptive state changes
- A threshold or zone is crossed (stop, entry/add zone, target)
- Material news or earnings occurs
- A data-quality correction is written (earnings date, target, stop RESET, theme, etc.)

Quiet no-change days belong in `upsert_daily_log` (`portfolioMove` / `watchlistMove`),
**not** as a fresh ticker note. Do not duplicate the full daily snapshot into
`pageNotes`.

**Retention:** prefer short dated entries (2–5 bullets). Full history also lives in daily
logs and Decision Reviews.

**Entry shape (UI parses this into a newest-first timeline):**
- Lead with an ISO date header: `YYYY-MM-DD:` or a readable `Mon Jun 15 2026 | …` line.
- Prefer one `paragraph` block per dated entry (append adds a new block).
- Include: stored price, signed move, action, stop/target/zone, earnings/DTE if relevant.
- Move fragments the UI highlights: `↑ +1.2%`, `↓ -0.8%`, `(+$1.20, +0.5%)`,
  `| -2.1% from $45.00`, or `(flat — …)`. Use ASCII `+`/`-` or unicode `−`; avoid inventing
  emoji status badges.

## 13. Watchlist action states

| State | How |
|---|---|
| DEMOTED / DROPPED | `delete_watchlist` (soft-demote by default) or `upsert_watchlist` with `action=DEMOTED\|DROPPED`. Record re-entry condition in `actionNotes` + a Decision Review row. |
| BUY_SUGGESTED | `upsert_watchlist` with `action=BUY_SUGGESTED` (+ Priority as appropriate) |
| EARLY_ENTRY | `upsert_watchlist` with `action=EARLY_ENTRY`; Decision Review title prefixed `EARLY ENTRY:` |

**Never hard-delete for demotion** (`hard=true` only when structurally gone — delisted /
acquired). Soft-demoted rows are hidden from `get_context` / default `list_watchlist`; pass
`includeDemoted=true` to see them for re-promotion.

Theme enum includes: AI_INFRASTRUCTURE, NUCLEAR_POWER, HUMANOID_ROBOTS, SPACE, CRYPTO,
RETAIL_TECH, HEALTHCARE, FINTECH_PAYMENTS, DEFENSE_DRONES, MEME_SPECIAL_SIT,
SOCIAL_PLATFORMS, BIOTECH_GLP1, ENERGY_COMMODITIES, MARITIME_SHIPBUILDING, QUANTUM,
PREDICTION_MARKETS, MACRO, CRITICAL_MINERALS. Prefer a legal Theme value when one fits;
leave `theme` unset only when nothing maps honestly, and surface null-theme holdings every
Daily as `UNCAPPED_THEME` (§7).

## 14. Data quality guards

- Prefer enum columns from context (`action`, `sleeve`, `theme`, `riskLevel`, `priority`,
  etc.). If a field is still null when you touch a row, backfill confidently; do not assume
  absence means "not applicable".
- **Portfolio patchable fields:** `action`, `stopLoss`, `sleeve`, `conviction` (1–5),
  `thesis`/`notes`/`pageNotes` (ReportBlock[]), `entryZone`, `addZone`, `nextAddTrigger`,
  `keyRisk`, `theme`, `riskLevel`, `marketCapBucket`, `analystRating`, `analystTarget`
  (USD; server recomputes `upsidePct`), `beatRate`, `impliedMove`, `earningsDate`
  (`YYYY-MM-DD`; clears `daysToEarnings` when past/null — system recomputes days). Not
  writable: `shares`, `currentPrice`, `myAvgCost`, `upsidePct` (derived), `socialScore`.
- **Watchlist upsertable:** includes `priority`, `action` (`WatchlistAction`),
  `marketCapBucket`, `analystRating`, `analystTarget`, `bullTarget`, `earningsDate`,
  zones, thesis/`actionNotes`/`pageNotes`. No `conviction` column on watchlist — put
  conviction in DR / notes. No direct `upsidePct` write.
- **Analyst target hygiene:** `analystTarget` is a living consensus field, not a migration
  fossil. When recent PTs in notes/web disagree with stored target by ≳15%, or when
  `upsidePct` contradicts `(analystTarget − currentPrice) / currentPrice`, refresh
  `analystTarget` via patch/upsert (prefer median of recent named PTs, else Street
  consensus). Do **not** escalate REDUCE/EXIT on negative upside alone when notes show a
  newer PT cluster — fix the target first, then reassess. Target-cross / "above analyst
  target" logic must use the refreshed field.
- **Stop hygiene:** follow §6 Stop policy. On `MOMENTUM_CATALYST` / `SPECULATIVE` winners
  ≳30% above cost, if stop is ≳25% below spot, flag `STALE_STOP` and RESET/TRAIL via
  `patch_portfolio`. Breached stops: resolve per §4 (`STOP_IN_LIMBO` if neither executed
  nor re-set). On `QUALITY_CORE`, stale/breached stops are advisory review triggers only.
- **Stale earnings:** if `earningsStale: true`, `earningsDate` is null, or `earningsDate`
  is in the past, treat earnings as unknown, re-confirm via web search, then write the
  **next** `earningsDate` via `patch_portfolio` / `upsert_watchlist`. After a print, roll
  forward to the next confirmed date — do **not** clear to null and leave the earnings
  routine blind. Null only when search cannot find a next date (say so in notes). Do not
  act on a stale `daysToEarnings`. **Unknown date blocks adds** (§7) — it does not pass
  Lesson #1 by silence.
- **Zone / cost text:** `entryZone` / `addZone` are price ranges, not avg-cost labels. If
  zone text cites an avg cost that disagrees with `myAvgCost`, rewrite the zone (or drop
  the cost clause). Never invent avg cost in zone fields — cost lives on `myAvgCost`.
- Ideas without `leadTicker` cannot join to watchlist/portfolio and have
  `priceReliable: false`. Set `leadTicker` whenever you touch an idea (§11.4).
- **Percent units (write correctly — UI formats from these):**
  - **Fractions** (`0.154` = 15.4%): `upsidePct` (system-computed), trade `pnlPct`,
    computed position P&L %.
  - **Percentage points** (`-2.5` = -2.5%): Decision Review `return1wPct` / `return4wPct` /
    `return3mPct`, Trend `perf1m` / `perf3m`. Do not write `0.025` for a −2.5% move.

## 15. Escalation

Soft warnings are informational; hard caps are `409`. Rule or limit changes are
**recommendations in reports** — agents never edit `/prompts`. `patch_config` is not
exposed on MCP (HTTP-only for Ivan). Living strategy prose updates go through
`upsert_document` (`STRATEGY_LESSONS` / `INVESTMENT_STYLE`) only on repeated patterns
(≥3 cases). Ticker-list hygiene uses `sync_tracked_tickers`.

Urgency-language cap and Outstanding Decisions: see §4 Escalation cap (§11.8).

## 16. Routine-run ledger

Every routine that writes (`daily`, `earnings`, `weekly`, `monthly`) must include a short
**Run ledger** block in the primary write (`upsert_daily_log.notes` or report `content`)
covering:

| Field | Content |
|---|---|
| Scheduled / start / completion | MYT timestamps (approx OK) |
| Routine + `rulesVersion` | From context |
| Success / failure + error | Tool/data failures, not vibes |
| Price freshness summary | Counts of `OK` / `STALE` / `SYNC_FAILED` / `UNKNOWN`; list failed tickers |
| Rows read / written | Approximate tool counts |
| Source count | Distinct web/filing sources cited |
| Forbidden tool attempts | `log_trade` / `patch_config` / etc. — should be none; say so |

This is audit evidence, not narrative padding.

<!-- KERNEL:BEGIN id=fitness-definition v=1 -->
## 17. Fitness definition (kernel)

Branch fitness over a comparison window is exactly:

`fitness = shadowReturn + avoidedLossCredit − drawdownPenalty − turnoverCost − benchmarkReturn`

- All five components are fractions of starting capital (`0.08` = 8%), never percentage points.
- `shadowReturn` is the branch's paper-ledger return; `benchmarkReturn` is CSPX over the same window.
- `avoidedLossCredit` is **signed**: correctly avoided losses add, wrongly avoided gains subtract.
- `drawdownPenalty` and `turnoverCost` are always subtracted, never floored away.
- No rule change may redefine, reweight, clamp, or drop any component, or swap the benchmark.
<!-- KERNEL:END id=fitness-definition -->

<!-- KERNEL:BEGIN id=reversion-mechanism v=1 -->
## 18. Reversion mechanism (kernel)

- Any branch whose equity closes **25% or more below its own high-water mark** hard-reverts
  immediately: the branch stops trading, its candidate rules are killed, and LIVE returns to
  the last known-good ACTIVE version.
- Reversion is evaluated first and takes precedence over every other signal — a breach reverts
  even when fitness, promotion criteria, or a pending proposal say otherwise.
- Reversion is never deferred, sampled, overridden by fresh evidence, or waived for "one more
  session".
- The 25% threshold and this precedence order can only change by a human commit to this file.
<!-- KERNEL:END id=reversion-mechanism -->

<!-- KERNEL:BEGIN id=audit-append-only v=1 -->
## 19. Audit log is append-only (kernel)

- `EvolutionEvent` records are append-only: once written they are never updated, deleted,
  redacted, back-dated, or rewritten by any agent, routine, or rule version.
- Any proposal, tool call, or rule change that attempts to modify or remove audit rows is
  rejected outright, and the rejection is itself appended to the log.
- Corrections are made by appending a new event that references the earlier one — never by
  editing history.
<!-- KERNEL:END id=audit-append-only -->
