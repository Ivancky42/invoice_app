# Stock HQ — Agent Connection & Post-Cutover Guide

**Audience:** Ivan (ops) + external AI agents (Cowork, Claude, Cursor, etc.)  
**Status:** Phase **5** — Neon SoT; Notion sync frozen; agent API/MCP live.  
**Repo:** `invoice_app` · **Companion plan:** `notion_to_neon_migration_4a74f236.plan.md`

This file is the operator checklist for connecting agents to Neon **through the app API/MCP**, not via raw Postgres.

---

## 1. Mental model

```
Your agent (Cowork / Claude / Cursor)
        │
        ▼
   MCP tools  ──or──  HTTPS /api/agent/*
        │
        ▼
   Bearer AGENT_TOKEN  (zod validation)
        │
        ▼
   Neon (book of record)
        │
        ▼
   /stocks/* UI (read-only)
```

| Do | Don't |
|----|--------|
| Call MCP tools or `/api/agent/*` | Give agents `DATABASE_URL` or Neon console SQL for writes |
| Use enum values from `get_context` / tool schemas | Invent statuses, emojis, or free-text labels |
| Emit narrative as `ReportBlock[]` JSON | Emit markdown for the site to parse |
| Retry once on `400` after fixing enums | Retry on `409` (portfolio rule violation) |
| Stamp `rulesVersion` from context onto writes | Edit `/prompts` via the API (read-only) |

Prices are **never** written by agents — only `/api/sync/prices` (Finnhub/EODHD cron).

---

## 2. What you set up once (after Phase 4b+)

### 2.1 Environment

Add to Vercel (Production + Preview if agents hit previews) and local `.env`:

```bash
# Distinct from SYNC_SECRET / CRON_SECRET / APP_PIN
AGENT_TOKEN=<long random secret, 32+ chars>
```

Also ensure existing vars remain:

- `DATABASE_URL` / `DIRECT_DATABASE_URL` — app + Prisma only
- `FINNHUB_API_KEY` / `EODHD_API_KEY` — price cron
- `CRON_SECRET` — Vercel cron auth for `/api/sync/prices`

**Do not** put `DATABASE_URL` into Cowork / Claude project secrets for agent use.

### 2.2 Deploy

1. Ship through Phase **4b** (read) before pointing routines at MCP for real work.
2. Ship **4c** (writes + `logTrade`) before any trade logging via agents.
3. Confirm production URL, e.g. `https://<your-app>.vercel.app`.

### 2.3 Smoke-test HTTP (before MCP)

```bash
export BASE=https://<your-app>.vercel.app
export AGENT_TOKEN=…   # same as Vercel

# Read context (daily routine shape)
curl -sS -H "Authorization: Bearer $AGENT_TOKEN" \
  "$BASE/api/agent/context?routine=daily" | jq .

# Read a prompt
curl -sS -H "Authorization: Bearer $AGENT_TOKEN" \
  "$BASE/api/agent/prompts/_shared" | head
```

Expect `401` without token, `200` + JSON/enums with token.

### 2.4 Connect MCP (preferred for Cowork / Claude)

Phase **4c** exposes a Streamable HTTP MCP endpoint at:

**`/api/mcp/mcp`** (route: `src/app/api/mcp/[transport]/route.ts`, transport = `mcp`)

Auth:

| Client | How |
|--------|-----|
| **Claude Custom Connector / Cowork (cloud)** | OAuth 2.1 on this app — DCR + consent with `AGENT_TOKEN` |
| **ChatGPT custom MCP plugin** | OAuth 2.1 — DCR + consent with `AGENT_TOKEN` (redirects under `https://chatgpt.com/connector/oauth/…`) |
| **Desktop `mcp-remote` / curl / REST** | `Authorization: Bearer $AGENT_TOKEN` (unchanged) |

Site PIN gate is bypassed for `/api/mcp`, `/api/oauth`, and `/.well-known/*`.

#### Claude Custom Connector (Cowork schedules)

1. Claude → **Settings → Connectors → Add custom connector**
2. **Name:** `Stock HQ`
3. **Remote MCP server URL:** `https://<your-app>.vercel.app/api/mcp/mcp`
4. **Advanced:** leave OAuth Client ID and Client Secret **empty** (Dynamic Client Registration)
5. **Add** → **Connect** → browser opens Stock HQ consent → paste `AGENT_TOKEN` → **Approve**
6. Confirm tools appear; attach the connector to Cowork routines

#### ChatGPT custom MCP plugin

1. ChatGPT → create plugin / custom MCP → **Server URL** `https://<your-app>.vercel.app/api/mcp/mcp`
2. **Authentication:** OAuth; registration **DCR**; scope `mcp:tools`
3. Create → OAuth consent → paste `AGENT_TOKEN` → Approve
4. Redirect URIs under `https://chatgpt.com/connector/oauth/…` are allowlisted (plus legacy `connector_platform_oauth_redirect`)

OAuth endpoints (self-hosted on the same app):

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource` (+ path variant under `/api/mcp/mcp`)
- `POST /api/oauth/register`
- `GET|POST /api/oauth/authorize` (consent; redirects with **302**)
- `POST /api/oauth/token`

Set `APP_URL` to the public origin (e.g. `https://invoice-app-beige-six.vercel.app`) so metadata URLs are correct.

#### Desktop / local stdio bridge

```json
{
  "mcpServers": {
    "stock-hq": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<your-app>.vercel.app/api/mcp/mcp",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer <AGENT_TOKEN>"
      }
    }
  }
}
```

Local Desktop config does **not** reach Cowork cloud schedules — use the Custom Connector for routines.

**Verify tools appear:**

- Read: `get_context`, `get_prompt`, `list_portfolio`, `list_watchlist`, `list_trades`, `list_ideas`, `list_trends`, `get_config`, `list_decision_reviews`, `list_daily_logs`, `list_reports`, `get_document`, `get_page_notes`, `get_price_history`, `get_shadow_fitness`, `list_shadow_positions`, `list_shadow_orders`, `list_counterfactuals`, `list_evolution_log`, `get_rule_version`, `list_rule_versions`, `get_kernel`
- Write (**live in 4c**): `upsert_daily_log`, `upsert_report`, `log_trade`, `patch_portfolio`, `append_page_notes`, `upsert_watchlist`, `delete_watchlist` (soft-demote), `upsert_trend`, `upsert_idea`, `sync_tracked_tickers`, `upsert_decision_review`, `upsert_document`, `add_evidence`, `propose_rule_change`, `apply_gap_fix`, `score_rule_version`. **`patch_config` is HTTP-only** (`PATCH /api/agent/config`) — not registered on MCP so routines cannot rewrite `LIMITS`. **Promote / revert / activate a ruleset have no tool anywhere** — promotion is cron-only (`evolution_evaluate`), same precedent as `patch_config`: a proposer must never be able to crown its own candidate.

### 2.4a Shadow evolution — read/write surface

Nine new read tools and four new write tools (Phase — shadow ledger + rule evolution) sit
alongside the existing surface, all under the same `AGENT_TOKEN` / MCP auth:

| Tool | Kind | Notes |
|---|---|---|
| `get_price_history` | Read | Daily OHLC bars for one ticker, newest first. `from`/`to` optional; default limit 120 (max 500). |
| `get_shadow_fitness` | Read | Daily `FitnessSnapshot` rows for a shadow branch (default `LIVE`). All values are FRACTIONS (`0.03` = 3%). `avoidedCreditDelta` is SIGNED — refusing a name that fell credits, refusing one that rose debits. |
| `list_shadow_positions` | Read | Open (or all, `includeClosed=true`) PAPER positions in a branch's ledger — never the real portfolio. |
| `list_shadow_orders` | Read | PAPER orders (simulated fills, never broker orders) in a branch's ledger, newest decision first. |
| `list_counterfactuals` | Read | What NOT-taken decisions (AVOID / WAIT / DO_NOT_AVERAGE_DOWN) would have been worth. `credit` is SIGNED, in NAV fractions. |
| `list_evolution_log` | Read | The append-only audit log — proposals, rejections (incl. `KERNEL_ATTEMPT`), promotions, kills, scores. Read rejections too; a repeated identical one is itself a signal. |
| `get_rule_version` | Read | Metadata for one `RuleVersion` (status, lane, limits, changedPaths, outcome). Never returns prompt text — use `get_prompt` for the running ruleset. |
| `list_rule_versions` | Read | `RuleVersion` metadata, newest first, optional `status` filter. |
| `get_kernel` | Read | The five pinned kernel clauses (id + sha256 + canonical text). Read this BEFORE `propose_rule_change` — any hunk touching a fence is rejected and logged `KERNEL_ATTEMPT`. |
| `propose_rule_change` | Write | Propose a CANDIDATE ruleset. Server assigns the lane (a supplied `lane` is ignored and recorded as `laneClaimIgnored`). Requires ≥3 cited scored decision reviews, ≥2 tickers, ≥2 ISO weeks, ≥1 wrong outcome, a falsifiable `counterCase` (≥40 chars), and a measurable `successMetric`. Loosening a rail needs ≥5 rows over ≥42 days plus `worstCase`. |
| `apply_gap_fix` | Write | Immediate patch to ONE section of the ACTIVE ruleset for a typo/contradiction (≤40 changed lines). `expectedSectionSha` required — mismatch is a 409. Not for behaviour changes; use `propose_rule_change` for those. |
| `score_rule_version` | Write | Retrospective HELPED/NEUTRAL/HURT on a RETIRED/KILLED version, computed server-side. Below 10 paired sessions returns `preview: true, outcome: null` and writes nothing. `outcomeClaim` is recorded but never authoritative. |
| `add_evidence` | Write | Append `EvidenceItem` rows to an existing Decision Review (`decisionReviewId` or `idempotencyKey`, within `branch`). Prefer citing evidence inline on `upsert_decision_review`'s `evidence[]` array instead when writing the DR fresh. |

**`branch` param semantics.** `get_context`, `get_prompt`, `upsert_daily_log`,
`upsert_report`, and `upsert_decision_review` accept an optional `branch` (`"LIVE"` default
| `"CANDIDATE"`). The real-book write surface — `log_trade`, `patch_portfolio`, watchlist /
idea / trend / document writes, `sync_tracked_tickers`, `delete_watchlist` — **rejects** a
`branch` param outright with `400 branch_not_allowed_on_real_book`: both branches read the
same one real book, and a `branch=CANDIDATE` write attempt on the real-book surface must
never silently mutate it. `CANDIDATE`-branch idempotency keys are server-prefixed
(`CANDIDATE:${key}`) so a candidate replay can never collide with or address a LIVE row.

**Evidence on `upsert_decision_review`.** Pass cited evidence inline via the `evidence`
array (`{ tier, kind, observedAt }` per item, tiers `T1`–`T4`, up to 20 items) rather than
a separate `add_evidence` follow-up call when writing the DR fresh — `add_evidence` exists
for appending evidence to a DR after the fact. `EVIDENCE_ENFORCEMENT` (env, default
`warn`) governs whether unmet tier requirements land in `warnings[]` (write proceeds) or
`failures[]` (write rejected, `strict` mode only).

### 2.5 Point the four Cowork routines

Replace Notion DB writes with thin instructions (see plan § prompts):

1. `get_context(routine=…)` — authoritative state + legal enums + `rulesVersion`
2. Read `/prompts/_shared.md` + routine file via MCP
3. Analyse
4. Write only via MCP tools; stamp `rulesVersion`
5. On `409`: log conflict in daily log; **do not retry**

Schedules (unchanged intent):

| Routine | When (MYT) |
|---------|------------|
| Daily | 08:00 |
| Weekly | Mon 07:30 |
| Earnings | Sun 18:00 |
| Monthly | 1st, 10:00 |

Paste the DATA WRITES block from the migration MD (§4.7) into each routine once writes ship.

### 2.6 Optional: raw HTTP from other agents

Any agent that can `fetch` works without MCP:

```http
Authorization: Bearer $AGENT_TOKEN
Content-Type: application/json
```

Same zod contracts as MCP tools. Prefer MCP when the client supports tool schemas so enums are enforced in the tool definition.

---

## 3. Tool / route surface

### Reads — **live (Phase 4b)**

| Capability | HTTP | Notes |
|------------|------|--------|
| Bundle for a routine | `GET /api/agent/context?routine=daily\|weekly\|earnings\|monthly` | Cash, NAV, positions, watchlist, trends+scores, ideas funnel, limits, enums, `rulesVersion` |
| Prompt file | `GET /api/agent/prompts/:name` | Serves `/prompts/*.md` from git; allowlist `_shared\|daily\|weekly\|earnings\|monthly` |
| Portfolio | `GET /api/agent/portfolio` | Positions + weightPct + pageNotes + lastPriceUpdate |
| Watchlist / trades / ideas / trends | `GET /api/agent/watchlist` etc. | Token-gated; no SQL |
| Daily logs | `GET /api/agent/daily-logs?since&until&limit` | Newest first; default limit 14 |
| Reports | `GET /api/agent/reports?reportType&since&until&limit` | WEEKLY/MONTHLY |
| Decision reviews | `GET /api/agent/decision-reviews` | Filter by ticker / status / pending window |
| Config | `GET /api/agent/config` | All Config keys |
| Price history | `GET /api/agent/price-history?ticker=…` | Daily OHLC bars, newest first; `from`/`to`; default limit 120 (max 500) |
| Shadow fitness | `GET /api/agent/shadow/fitness?branch=…` | Daily `FitnessSnapshot` rows; fractions; `avoidedCreditDelta` signed |
| Shadow positions | `GET /api/agent/shadow/positions?branch=…` | Open (or `includeClosed=true`) PAPER positions |
| Shadow orders | `GET /api/agent/shadow/orders?branch=…` | PAPER simulated fills, newest decision first |
| Counterfactuals | `GET /api/agent/shadow/counterfactuals?branch=…` | Signed credit for refused decisions |
| Evolution log | `GET /api/agent/evolution/log` | Append-only audit trail — proposals, rejections, promotions, kills, scores |
| Rule versions | `GET /api/agent/evolution/rule-versions` / `GET /api/agent/evolution/rule-versions/:id` | Metadata only, never prompt text |
| Kernel | `GET /api/agent/evolution/kernel` | Pinned kernel clauses (id + sha256 + text) |
| MCP | `POST/GET /api/mcp/mcp` | Same tools as below |

### Writes — **live (Phase 4c)**

| Capability | HTTP | Idempotency |
|------------|------|-------------|
| Daily log | `POST /api/agent/daily-log` | `logDate` |
| Report | `POST /api/agent/report` | `(reportType, reportDate)`; persists `rulesVersion` |
| Trade | `POST /api/agent/trade` | client `idempotencyKey`; syncs TRACKED_TICKERS |
| Evidence | `POST /api/agent/evidence` | Appends `EvidenceItem` rows to an existing DR (branch-scoped, 404 if not found on that branch) |
| Propose rule change | `POST /api/agent/evolution/propose` | Server assigns lane; rejects log to `EvolutionEvent` |
| Apply gap fix | `POST /api/agent/evolution/gap-fix` | `expectedSectionSha` required; 409 on mismatch |
| Score rule version | `POST /api/agent/evolution/score` | Server-computed outcome; preview-only below 10 paired sessions |
| Portfolio patch | `PATCH /api/agent/portfolio/:ticker` | includes earningsDate, marketCapBucket, analystRating |
| Watchlist upsert/delete | `PUT /api/agent/watchlist` / `DELETE /api/agent/watchlist/:ticker` | syncs TRACKED_TICKERS |
| Sync tracked tickers | `POST /api/agent/tracked-tickers/sync` | rebuild from DB |
| Trend | `PUT /api/agent/trend` | `trendName` |
| Idea | `PUT /api/agent/idea` | `stockSector` or `leadTicker` |
| Config | `PATCH /api/agent/config` | cash, FX, thresholds, tracked, LIMITS; **routines must not change LIMITS** |

`PATCH /api/agent/config` may update `LIMITS` (hard caps) — intentional and rare. Agents must not rewrite strategy prose.

### Content shape

Narrative fields are `ReportBlock[]`, not markdown:

```json
[
  { "type": "paragraph", "text": "…" },
  { "type": "heading_2", "text": "…" },
  { "type": "bulleted_list_item", "text": "…" }
]
```

Status-like fields are SCREAMING_SNAKE_CASE enums only (from context payload).

### Trade example (curl)

```bash
export BASE=http://localhost:3000
export AGENT_TOKEN=…

curl -sS -X POST "$BASE/api/agent/trade" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "2026-08-05-GLXY-ADD-1",
    "ticker": "GLXY",
    "type": "ADD",
    "date": "2026-08-05",
    "shares": 600,
    "pricePerShare": 20.73,
    "thesisAtEntry": [{ "type": "paragraph", "text": "…" }],
    "rulesVersion": "a3f9c21"
  }' | jq .
```

Replay the same `idempotencyKey` → `200` with `idempotentReplay: true` and no second row.

Deliberately oversized trade → `409` with `reason` (`single_position_cap` | `theme_cap` | `cash_floor` | `max_average_downs` | …) and **no** DB mutation.

No stored `tier` — sleeve/weight rules enforced server-side. Soft sizing-band mismatches return `200` + `warnings[]`.

Local probe (math dry-run / optional DB):

```bash
npx tsx scripts/test-log-trade.ts           # dry-run math only
npx tsx scripts/test-log-trade.ts --idempotent  # tiny ADD + replay + reverse
```

### Error semantics

| Code | Meaning | Agent action |
|------|---------|--------------|
| `400` | Bad payload / illegal enum | Read `legalValues` (or equivalent); fix; retry once |
| `401` | Missing/wrong token | Fix secrets; do not retry blindly |
| `409` | Portfolio invariant (cap, cash floor, avg-downs) | Do **not** retry; report to Ivan / daily log |
| `200` + `warnings[]` | Soft sizing-band mismatch | Proceed; surface warnings |

---

## 4. Post-implementation checklist (you)

Use this after code is merged through Phase 5.

### A. Immediate (Phase 4b day) — **code shipped; ops smoke-test**

- [ ] `AGENT_TOKEN` set on Vercel + local
- [ ] `curl` context + prompts succeed (`GET /api/agent/context?routine=daily`)
- [ ] MCP client lists read tools at `/api/mcp/mcp`
- [ ] Confirm UI still loads `/stocks/*` from Neon

### B. Before first live write (Phase 4c) — **code shipped**

- [ ] Phase 2 shares Notion-vs-derived **diff** empty or hand-resolved
- [ ] Dry-run: tiny/idempotent trade on a preview or known ticker; verify cash + shares
- [ ] Force a `409` (e.g. oversize) and confirm **no** DB write
- [ ] Replay same `idempotencyKey` → single row
- [ ] MCP write tools visible; Notion **not** used for that write

### C. Routine cutover (start of Phase 5 window)

- [ ] `/prompts/*.md` committed and `rulesVersion` matches
- [ ] All four Cowork routines updated to MCP + `get_context`
- [ ] Notion sync cron **disabled**; price cron still running and owns snapshots
- [ ] Notion left **readable** (archive / parallel reference) for ~2 weeks

### D. During go-back window (~2 weeks)

- [ ] Spot-check daily log + portfolio after each routine
- [ ] No Notion API calls in app logs (except if you temporarily re-enable)
- [ ] If MCP fails: keep Notion readable; fix agent; do not delete Notion DBs yet
- [ ] Optional: prune orphan trades with a separate agent/script (out of band)

### E. Close the door

- [ ] Confirm Ideas funnel fields (`ideaStage`, `leadTicker`, graduation*) present and used
- [ ] Confirm Theme enum populated; no free-text sector drift in new writes
- [ ] Freeze Notion workspace read-only
- [ ] Keep `src/lib/notion/` in repo one release; delete later
- [ ] Prune unused `NOTION_*` env vars from Vercel when comfortable
- [ ] Copy this guide into the repo as `docs/STOCK_HQ_AGENTS.md` (if not already) and keep it updated when routes change

### F. Ongoing ops

- [ ] Rotate `AGENT_TOKEN` if leaked; update all MCP clients
- [ ] Rule changes → git commit to `/prompts`, never Config text blobs for strategy prose
- [ ] Live thresholds/cash/tickers → Config via API or controlled patch
- [ ] Never grant Neon SQL credentials to agents

---

## 5. What agents need from you (hand them this)

Minimal brief for a new agent:

1. Base URL + `AGENT_TOKEN` (secret channel).
2. Prefer MCP; else REST table above.
3. Always `get_context` first for that routine.
4. Enums and limits in the context payload are law.
5. Narrative = `ReportBlock[]`; statuses = enums; no emoji.
6. `400` → fix once; `409` → stop and report.
7. Do not invent prices; do not open a Postgres connection.

---

## 6. Out of scope (by design)

- Direct Neon / Postgres connection strings for agents
- Agent-editable strategy prompts
- In-app stock edit forms (UI stays read-only)
- Writing prices from agents
- Automatic orphan-trade prune (separate later task)

---

## 7. When this file is “live”

| Phase | This guide |
|-------|------------|
| 0a–3 | Planning only; agents still on Notion |
| 4a | Content shape changes on site; agents still Notion |
| 4b | Read path live — MCP `/api/mcp/mcp` + `/api/agent/*` GETs |
| **4c** | **Write path live** — trades/logs via API/MCP only |
| 5 window | Routines on MCP; Notion readable fallback |
| 5 close | Notion archived; this doc is SoT for connection |

---

## 8. Phase 5 — freeze / go-back window

Neon is SoT. Notion sync cron is **removed** from `vercel.json`. Only `/api/sync/prices` runs on a schedule.

### Go-back window checklist (~2 weeks)

- [ ] Notion workspace left **readable** (do not archive or delete DBs yet)
- [ ] Notion→Neon sync **disabled** by default (`NOTION_SYNC_ENABLED` unset / not `true`)
  - `GET /api/sync/notion` → **503** with frozen message
  - `manualSyncNotion` returns the same frozen error; UI hides “Sync from Notion (legacy)”
- [ ] To emergency re-pull: set `NOTION_SYNC_ENABLED=true` on Vercel + redeploy; use HTTP or the legacy UI button; unset when done
- [ ] All four Cowork routines pointed at MCP (`/api/mcp/mcp`) + `get_context` — **no Notion writes**
- [ ] Price cron healthy (`/api/sync/prices`); spot-check portfolio after each routine
- [ ] After ~2 weeks with no go-back: archive Notion DBs read-only; prune `NOTION_*` env later; keep `src/lib/notion/` one more release before delete

### MCP endpoint & full tool list

**Endpoint:** `https://<app>/api/mcp/mcp`  
**Auth:** `Authorization: Bearer $AGENT_TOKEN`

| Kind | Tools |
|------|--------|
| **Read** | `get_context`, `get_prompt`, `list_portfolio`, `list_watchlist`, `list_trades`, `list_ideas`, `list_trends`, `get_config`, `list_decision_reviews`, `list_daily_logs`, `list_reports`, `get_document`, `get_page_notes`, `get_price_history`, `get_shadow_fitness`, `list_shadow_positions`, `list_shadow_orders`, `list_counterfactuals`, `list_evolution_log`, `get_rule_version`, `list_rule_versions`, `get_kernel` |
| **Write** | `upsert_daily_log`, `upsert_report`, `log_trade`, `patch_portfolio`, `append_page_notes`, `upsert_watchlist`, `delete_watchlist` (soft-demote; `hard=true` to erase), `upsert_trend`, `upsert_idea`, `sync_tracked_tickers`, `upsert_decision_review`, `upsert_document`, `add_evidence`, `propose_rule_change`, `apply_gap_fix`, `score_rule_version` (`patch_config` for cash/FX only in rare ops — never LIMITS from routines; promote/revert/activate have no tool anywhere — cron-only) |

Matching HTTP surface: `/api/agent/*` (see §3). Prices are never written by agents.

This copy lives in the repo as `docs/STOCK_HQ_AGENTS.md`. Update paths/tool names when the MCP route or tool surface changes.
