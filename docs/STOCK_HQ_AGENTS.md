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

Auth: `Authorization: Bearer $AGENT_TOKEN` (same as `/api/agent/*`). Site PIN gate is bypassed for `/api/mcp`.

**Client config:**

```json
{
  "mcpServers": {
    "stock-hq": {
      "url": "https://<your-app>.vercel.app/api/mcp/mcp",
      "headers": {
        "Authorization": "Bearer ${AGENT_TOKEN}"
      }
    }
  }
}
```

Or, if the client only supports stdio bridges, use a small local proxy that forwards to that URL with the Bearer header.

**Verify tools appear:**

- Read: `get_context`, `get_prompt`, `list_portfolio`, `list_watchlist`, `list_trades`, `list_ideas`, `list_trends`, `get_config`
- Write (**live in 4c**): `upsert_daily_log`, `upsert_report`, `log_trade`, `patch_portfolio`, `upsert_watchlist`, `delete_watchlist`, `upsert_trend`, `upsert_idea`, `patch_config`

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
| Portfolio | `GET /api/agent/portfolio` | Positions + weightPct |
| Watchlist / trades / ideas / trends | `GET /api/agent/watchlist` etc. | Token-gated; no SQL |
| Config | `GET /api/agent/config` | All Config keys |
| MCP | `POST/GET /api/mcp/mcp` | Same tools as below |

### Writes — **live (Phase 4c)**

| Capability | HTTP | Idempotency |
|------------|------|-------------|
| Daily log | `POST /api/agent/daily-log` | `logDate` |
| Report | `POST /api/agent/report` | `(reportType, reportDate)` |
| Trade | `POST /api/agent/trade` | client `idempotencyKey` |
| Portfolio patch | `PATCH /api/agent/portfolio/:ticker` | natural |
| Watchlist upsert/delete | `PUT /api/agent/watchlist` / `DELETE /api/agent/watchlist/:ticker` | `ticker` |
| Trend | `PUT /api/agent/trend` | `trendName` |
| Idea | `PUT /api/agent/idea` | `stockSector` or `leadTicker` |
| Config | `PATCH /api/agent/config` | cash, FX, thresholds, tracked, LIMITS; **never** `/prompts` |

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
| **Read** | `get_context`, `get_prompt`, `list_portfolio`, `list_watchlist`, `list_trades`, `list_ideas`, `list_trends`, `get_config` |
| **Write** | `upsert_daily_log`, `upsert_report`, `log_trade`, `patch_portfolio`, `upsert_watchlist`, `delete_watchlist`, `upsert_trend`, `upsert_idea`, `patch_config` |

Matching HTTP surface: `/api/agent/*` (see §3). Prices are never written by agents.

This copy lives in the repo as `docs/STOCK_HQ_AGENTS.md`. Update paths/tool names when the MCP route or tool surface changes.
