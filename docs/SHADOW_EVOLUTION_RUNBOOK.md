# Shadow Evolution — Production Deployment Runbook

Audience: Ivan (ops), deploying `feat/shadow-evolution` to production Neon/Vercel for the
first time. Local Docker Postgres and production Neon are **separate databases** — nothing
in local testing touches prod, and this runbook is the only path that does.

Read `docs/STOCK_HQ_SHADOW_EVOLUTION.md` first for what the system does; this doc is only
the ordered steps to turn it on safely.

---

## 1. Environment variables (Vercel → Production, and Preview if you test there)

| Var | Status | Action |
|---|---|---|
| `CRON_SECRET` | Currently **commented out** in `.env.example` | **Set it** — required for the tick's own dispatch auth (`/api/cron/tick` `authorized()`) and for the tick's self-chaining `fetch` (`chainSkipped` fires without it). Long random secret, distinct from `SYNC_SECRET`/`AGENT_TOKEN`. |
| `FINNHUB_API_KEY` | Exists | No action — already required for price sync. |
| `EODHD_API_KEY` | Exists | No action for the key itself, but see §4 — the backfill dry-run is what tells you whether this key's tier covers US equities, which changes nothing about deployment but matters for what you expect in the coverage table. |
| `RULES_MIRROR_REPO` | Optional, unset by default | Set to `owner/repo` only if you want promoted rulesets mirrored to a `rules-mirror` branch for external diffing. Mirroring is best-effort and never blocks a promotion if unset or failing. |
| `RULES_MIRROR_TOKEN` | Optional, unset by default | A GitHub PAT (classic or fine-grained) with **`contents: write`** on the target repo. The mirror writes **only** to the `rules-mirror` branch, never `main` — a push to `main` would trigger a prod deploy, so this is deliberate. |
| `EVIDENCE_ENFORCEMENT` | Optional, defaults `warn` | Leave unset (or `warn`) for the initial deploy — evidence-tier codes land in `warnings[]` on `upsert_decision_review`, nothing is rejected. Only flip to `strict` after routines have been writing evidence for a while and you've reviewed the warning volume. |

All other required vars (`DATABASE_URL`, `DIRECT_DATABASE_URL`, `AGENT_TOKEN`,
`SYNC_SECRET`, etc.) are unchanged by this branch.

---

## 2. Deploy sequencing

The branch is one unit — deploy the whole thing, not a partial cherry-pick. What actually
happens on first deploy, in order:

1. **`pnpm build` runs `prisma migrate deploy` first.** Nine new migrations apply, in
   order:

   | Migration | Matching prod resolve helper (only if `migrate deploy` reports drift) |
   |---|---|
   | `20260808120000_cron_job_ledger` | `pnpm db:resolve-cron-job-ledger-prod` |
   | `20260808130000_price_history` | `pnpm db:resolve-price-history-prod` |
   | `20260808140000_rule_versions` | `pnpm db:resolve-rule-versions-prod` |
   | `20260808150000_shadow_ledger` | `pnpm db:resolve-shadow-ledger-prod` |
   | `20260808160000_fitness` | `pnpm db:resolve-fitness-prod` |
   | `20260808170000_noise_thesis` | `pnpm db:resolve-noise-thesis-prod` |
   | `20260808180000_evidence` | `pnpm db:resolve-evidence-prod` |
   | `20260808190000_evolution` | `pnpm db:resolve-evolution-prod` |

   These are all additive, hand-written idempotent SQL (`ADD COLUMN IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, plus the raw partial-unique-index / append-only `RULE` on
   `EvolutionEvent`) — the raw constraints **ship inside the migrations themselves**, so
   prod needs **no extra step** beyond `migrate deploy`. (`scripts/apply-raw-constraints.ts`
   is chained into `pnpm db:push` for local Docker only, where `db push` bypasses
   migrations entirely — prod never runs it.)

   Only run a `db:resolve-*-prod` helper if `migrate deploy` reports that a migration's
   objects already exist (P3005-style drift) — normally none of them are needed on a clean
   history.

2. **The first nightly tick runs with empty shadow state.** `price_sync` →
   `portfolio_snapshot` → `price_history` (writes to an empty `PriceHistory` table — the
   session calendar has zero sessions until this runs at least once, more meaningfully
   until the backfill in §4 runs) → `breadth_classify` → `shadow_fill` /
   `shadow_enqueue` / `shadow_mark` (all effectively no-ops: `ShadowBranch` rows do not
   exist yet, `ensureShadowBranches()` is called lazily by the first thing that needs a
   ruleset) → `decision_returns` → `counterfactual_resolve` → `fitness_snapshot` (writes
   nothing meaningful without positions) → `evolution_evaluate` (returns
   `skipped: "no_active"` or `no_shadow_branches"` until a `RuleVersion` and both
   `ShadowBranch` rows exist). This is expected and harmless — the jobs are additive and
   inert until real data accumulates over the following days.

3. **`ensureRuleVersion1()` seeds `RuleVersion` id 1 lazily**, on the first read of any
   ruleset (the first `get_context` / `get_prompt` call after deploy, or the first cron job
   that resolves a ruleset). It reads the five committed `/prompts/*.md` files plus
   `Config.LIMITS` at that moment.

   **Before that first read happens, verify `Config.LIMITS` already exists in prod** —
   otherwise v1 seeds with `DEFAULT_LIMITS` (the code fallback) instead of your live caps,
   and every planning/fitness calculation downstream would silently use the wrong numbers
   until someone notices and re-seeds.

   ```bash
   curl -sS -H "Authorization: Bearer $AGENT_TOKEN" \
     "https://<your-app>.vercel.app/api/agent/config" | jq '.LIMITS'
   ```

   It **does** exist in prod today (Config was seeded during Phase 3) — this is a
   verification step, not expected remediation. If it is somehow missing, seed it via
   `PATCH /api/agent/config` with a `LIMITS` body **before** any routine or cron job makes
   its first ruleset read, or run `scripts/seed-rule-version.ts` locally against the prod
   URL (see §5) once `Config.LIMITS` is fixed.

---

## 3. Watch the first nightly tick

The cron fires at `vercel.json`'s schedule (`0 22 * * *` UTC = 06:00 MYT). To check sooner,
call it manually:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<your-app>.vercel.app/api/cron/tick" | jq .
```

Response fields to check:

- `ok` — `true` iff no job in this run reported `FAILED`.
- `runDay` — the UTC calendar day the tick ran for (`YYYY-MM-DD`).
- `ran[]` — one entry per job: `{ job, status, ms, detail }`. `status` is
  `SUCCESS` / `SKIPPED` / `PENDING` / `FAILED`. A `SKIPPED` with
  `detail.reason = "deps-unmet"` and `detail.unmet` naming the dependency is normal on the
  very first run if an earlier job in the chain hasn't produced its ledger row yet — re-run
  or wait for tomorrow's scheduled tick.
- `chained` — present only if this run triggered a self-chain (budget exhausted or a job
  asked to resume). Absent on a normal first run.

Also check the `JobRun` ledger directly (via Neon SQL, or a quick script) — one row per
`(job, runDay)`:

```sql
select job, status, "startedAt", "finishedAt", error, detail
from "JobRun"
where "runDay" = current_date
order by "startedAt";
```

And from the agent side, `get_context`'s `lastRun.staleJobs` surfaces any job that has not
succeeded today by the time a routine reads context — an empty array is healthy.

---

## 4. Backfill price history

Run this **locally**, pointed at prod, in a shell with `DATABASE_URL` (and
`DIRECT_DATABASE_URL` if you use it for scripts) set to the **production** Neon connection
string. Never commit or paste the prod URL into a shared file.

```bash
DATABASE_URL="<prod DATABASE_URL>" npx tsx scripts/backfill-price-history.ts --dry-run
```

This prints a per-ticker coverage table:

```
ticker | provider | rows | firstDate | lastDate | error
```

Read it before running for real:

- **This is how you answer the EODHD-US-equity-tier question.** If most tickers show
  `provider: eodhd` with ~400 rows and no `error`, the key covers US equities. If EODHD
  errors per-ticker, the row falls back to `provider: stooq` — still populated, just a
  different source; the nightly job behaves the same way going forward regardless of which
  provider wins on a given ticker.
- Any row with a non-empty `error` column means **both** providers failed for that ticker
  — the script's exit code is non-zero if this happens for anyone. Investigate those
  tickers specifically (delisted? wrong symbol format?) before proceeding.

Once the dry run looks right, run it for real:

```bash
DATABASE_URL="<prod DATABASE_URL>" npx tsx scripts/backfill-price-history.ts
```

Default is `--days=400` (~400 calendar days, matching the 3-month fitness horizon plus
slack), insert-only (`skipDuplicates` — never touches an existing `(ticker, date)` row).
Pass `--overwrite` only if you need to repair bad nightly closes already written by a
previous provider bug — it upserts every fetched bar, replacing existing rows with the
provider's fresh value.

Expected coverage after a clean run: **~400 rows per ticker** in the tracked universe
(portfolio + watchlist + the four session anchors `SPY`/`QQQ`/`AAPL`/`MSFT`), fewer for
recently-IPO'd names.

---

## 5. Seed the ruleset + verify parity

If `Config.LIMITS` was confirmed present in §2.3, lazy seeding via the first ruleset read
is sufficient and no manual step is required. To seed explicitly instead (idempotent —
no-ops if any `RuleVersion` already exists):

```bash
DATABASE_URL="<prod DATABASE_URL>" npx tsx scripts/seed-rule-version.ts
```

Then verify the stored prompt text is byte-identical to what's committed at `HEAD`:

```bash
DATABASE_URL="<prod DATABASE_URL>" npx tsx scripts/verify-rule-parity.ts
```

Exits non-zero on any mismatch. A mismatch here after a fresh seed means the prompts on
disk at deploy time differ from what's now at `HEAD` (e.g. you edited `/prompts` after
seeding) — re-seeding is not the fix once `RuleVersion` rows exist; a mismatch after that
point is expected and resolves itself once a promotion or gap-fix brings the DB copy back
in line, or is otherwise a signal worth investigating rather than auto-fixing.

---

## 6. `maxDuration=300` requires Fluid Compute

`/api/cron/tick` declares `export const maxDuration = 300;`. Vercel's Hobby/Pro plans cap
function duration lower than that **unless Fluid Compute is enabled** for the project.
`/api/sync/prices` already runs at `maxDuration = 120` today without issue — confirm in
**Vercel → Project → Settings → Functions** that Fluid Compute is on before relying on the
full 300s budget; if it is off, the tick will be truncated by the platform before its own
240s soft budget triggers a self-chain, which would look like a job silently not running
rather than a clean chain.

---

## 7. Second Cowork schedule — `branch=CANDIDATE`

The current Cowork routines run once each, against `branch=LIVE` (the default). Everything
in this build **works without a second schedule** — the LIVE shadow book fills, marks,
scores, and reports normally — but one thing does not:

**Without a `branch=CANDIDATE` schedule, the CANDIDATE book never receives its own
Decision Review stream.** `DecisionReview` rows are written per-branch; only the existing
LIVE-branch routines write them today. A SLOW-lane (prose) candidate ruleset can
accumulate shadow **sessions** on the CANDIDATE book (mechanical fills from whatever
DecisionReviews exist still enqueue against both branches' current rulesets), but
`evolution_evaluate`'s `decisions` count — the number of CANDIDATE-branch DecisionReview
rows since the candidate's evidence cutoff — stays at 0. The SLOW lane's promotion
minimum is `sessions >= 30 AND decisions >= 20`; with `decisions` permanently 0, that
minimum is never met, `z` never gets a chance to clear the promote threshold under the
lane-minimum gate, and the candidate sits at `CONTINUE` forever (or ages out to
`INCONCLUSIVE` at 60 sessions without ever having been properly tested).

**The truth, stated plainly: autonomous promotion of a SLOW-lane / prose candidate cannot
occur until the second `branch=CANDIDATE` Cowork schedule exists.** This is a safe
default, not a missing feature to panic about — it means the system will not promote a
prose change on thin evidence just because a schedule was forgotten. FAST-lane (numeric
limits-only) candidates are less affected in principle since their sizing is mechanical,
but they still accrue their `decisions` count from the same source and are subject to the
same gate.

To unlock full autonomous evolution (including SLOW-lane prose testing), set up a second
Claude Custom Connector schedule identical to the existing Weekly/Daily/Earnings/Monthly
routines, but calling `get_context` / `get_prompt` / `upsert_decision_review` /
`upsert_report` with `branch="CANDIDATE"` explicitly on every call. See
`prompts/weekly.md` §0 ("Branch") for the exact call shape the routine already expects.

---

## 8. Rollback lever

If anything about the tick or the evolution loop needs to stop immediately without a code
revert, edit `vercel.json` to point the cron entry back at the old sync route:

```json
{
  "regions": ["sin1"],
  "crons": [
    {
      "path": "/api/sync/prices",
      "schedule": "0 22 * * *"
    }
  ]
}
```

Redeploy. This restores the pre-branch behaviour exactly (price sync + portfolio snapshot
only, same schedule) — `/api/cron/tick` and everything downstream of it (shadow ledger,
fitness, evolution) simply stops being invoked. Nothing about this rollback deletes data:
`RuleVersion`, `ShadowBranch`, `FitnessSnapshot`, and `EvolutionEvent` rows are left as-is
and resume exactly where they left off if the cron entry is flipped back later.
