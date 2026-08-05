# Command Center

Personal Next.js dashboard hosting two apps behind a single PIN gate:

- **Invoices** — Quotation → Invoice → Delivery Order lifecycle with PDF export.
- **Stocks** — Neon is the book of record. Agents read/write via `/api/agent/*` and MCP (`/api/mcp/mcp`). A daily Vercel cron refreshes Finnhub/EODHD prices into Neon (`/api/sync/prices`). Notion sync is legacy/frozen (Phase 5). See [docs/STOCK_HQ_AGENTS.md](docs/STOCK_HQ_AGENTS.md).

## Stack
- Next.js 15 (App Router) + TypeScript + Tailwind CSS
- Prisma + Postgres (Docker)
- @react-pdf/renderer for PDFs
- pnpm

## Quick start

```bash
# 1. Install deps (also generates Prisma client)
pnpm install

# 2. Start everything (DB + schema sync + dev server)
pnpm start:all
```

This will:
1. Start Postgres in Docker (`pnpm db:up`)
2. Push the Prisma schema (`pnpm db:push`)
3. Run the Next dev server on http://localhost:3000

Or step-by-step:

```bash
pnpm db:up        # start postgres
pnpm db:push      # apply schema
pnpm dev          # run frontend + API
```

Stop the database:

```bash
pnpm db:down
```

## First-time setup

1. Open http://localhost:3000/settings — fill in your company info (name, address, tax id, bank details, default tax rate, currency).
2. Drop your logo file into `public/` (e.g. `public/logo.png`) and set "Logo path" in Settings to `/logo.png`.
3. Create your first document at `/documents/new`.

## Lifecycle

Each document is one of: `QUOTATION`, `INVOICE`, `DELIVERY_ORDER`. From a document detail page, click **Convert →** to spawn the next stage. Conversions copy all line items and link the new doc back to its parent so you can navigate the chain.

## PDF export

- Inline view: `/api/pdf/<id>`
- Download: `/api/pdf/<id>?download=1`

The PDF reads the latest company settings + logo each time, so changes to your branding are reflected automatically when you re-export.

## Database

```bash
pnpm db:studio   # browse data with Prisma Studio
```

Connection string (default): `postgresql://invoice:invoice@localhost:5433/invoice_app`

## Stocks app — Neon SoT (Phase 5)

Neon is the source of truth for portfolio, watchlist, trades, trends, ideas, daily logs, and reports. The `/stocks/*` UI is read-only against Neon (`revalidate = 900`). Agents mutate data only through the Bearer-token API and MCP — not via raw SQL and not via Notion.

Full connection guide (tools, auth, go-back checklist): **[docs/STOCK_HQ_AGENTS.md](docs/STOCK_HQ_AGENTS.md)**.

### Architecture

```
Agents (Cowork / Claude / Cursor)
        │
   MCP /api/mcp/mcp  ──or──  HTTPS /api/agent/*
        │
   Bearer AGENT_TOKEN
        │
      Neon  ←── /api/sync/prices (Finnhub + EODHD cron, daily 22:00 UTC)
        │
   /stocks/* UI (read-only)
```

Notion DBs remain readable as an archived fallback during the ~2-week go-back window. Notion→Neon sync (`/api/sync/notion`, `manualSyncNotion`) is **frozen** unless `NOTION_SYNC_ENABLED=true`. The Notion sync cron has been removed from [vercel.json](vercel.json); `src/lib/notion/` stays in the repo unwired.

### Price sync

- **Daily cron**: `0 22 * * *` → `/api/sync/prices` (Finnhub → Neon Portfolio/Watchlist/Ideas; EODHD for CSPX; then portfolio snapshot). **22:00 UTC / 06:00 GMT+8**. Auth: `Authorization: Bearer $CRON_SECRET`.
- **Manual**: “Update prices” on stocks pages (PIN-gated server action).

### Agent API / MCP

- Set `AGENT_TOKEN` (32+ chars). Same token for `/api/agent/*` and `/api/mcp/mcp`.
- Reads + writes: context, prompts, portfolio, watchlist, trades, ideas, trends, config, daily log, reports, `log_trade`.
- Never grant `DATABASE_URL` to agents.

### Legacy Notion sync (emergency only)

- Env: `NOTION_SYNC_ENABLED=true` plus existing `NOTION_*` / `SYNC_SECRET`.
- `GET /api/sync/notion?secret=$SYNC_SECRET` — otherwise **503** frozen.
- UI shows “Sync from Notion (legacy)” only when enabled.
