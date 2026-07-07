# Command Center

Personal Next.js dashboard hosting three apps behind a single PIN gate:

- **Invoices** — Quotation → Invoice → Delivery Order lifecycle with PDF export.
- **Stocks** — read-only mirror of Notion-backed portfolios; Vercel crons refresh Finnhub prices on Notion once daily and pull Notion into Neon once daily (later the same morning, GMT+8); the UI reads from Neon (`revalidate = 900`).
- **Crypto** — Neon-native (no Notion) portfolio/watchlist monitor with daily technical signals (RSI, MA crosses, volume spikes, BTC beta, funding, TVL), trending-token discovery, RSS catalysts, and an AI daily brief written by claude.ai scheduled tasks. See [Crypto app](#crypto-app).

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

## Stocks app — Notion sync

The stocks UI never talks to Notion directly for reads: it uses Neon. Vercel crons **once per day** at **22:00 UTC** push Finnhub quotes to Notion (`/api/sync/notion-prices`, **06:00 GMT+8**), and at **01:30 UTC** sync Notion → Neon (`/api/sync/notion`, **09:30 GMT+8**). Pages use `revalidate = 900`.

### One-time Notion setup

1. Create an internal integration at <https://www.notion.so/my-integrations> (type **Internal**, pick the right workspace). Copy the token (starts with `secret_` or `ntn_`).
2. Set `NOTION_TOKEN` and the five `NOTION_*_DB` IDs in your environment (see `.env.example`). Set `SYNC_SECRET` (any long random string) for manual triggers; on Vercel also set `CRON_SECRET` so the auto-injected cron `Authorization` header is accepted.
3. For each of the 5 databases (Portfolio, Watchlist, Trades, Trends, Ideas) open it in Notion ▸ ••• ▸ **Connections** ▸ add the integration. Without this the API will return empty results.

### Endpoints and schedule

- **Daily crons**: `0 22 * * *` → `/api/sync/notion-prices` (Finnhub → Notion, **22:00 UTC** / **06:00 GMT+8**); `30 1 * * *` → `/api/sync/notion` (Notion → Neon, **01:30 UTC** / **09:30 GMT+8**). See [vercel.json](vercel.json). Both use `Authorization: Bearer $CRON_SECRET` from Vercel.
- **Manual button**: every stocks page (and the home hub) shows a "Sync now" button that calls a server action. The action is reachable only to PIN-authenticated browsers and reuses the same orchestrator as the cron, then revalidates the stocks routes.
- **Manual HTTP**: `GET /api/sync/notion?secret=$SYNC_SECRET` — same orchestrator, returns per-DB row counts and any per-DB errors.
- Sync: **Finnhub → Notion** (prices on board databases) via cron and manual button; **Notion → Neon** via cron and “Sync now” (cache only).
- If sync fails or is missed, the UI keeps serving the last good Neon rows. A stale banner appears when the last successful **Notion→Neon** sync is older than **~26 hours**.

## Crypto app

Routes: `/crypto` (overview), `/crypto/portfolio`, `/crypto/watchlist`, `/crypto/trades`, `/crypto/catalysts`, `/crypto/briefs`. The DB is the source of truth — no Notion. Thesis/notes/targets are edited in-app; trending tokens (from CoinGecko) can be graduated to watchlist → portfolio with one click.

### Data sources (all free)

- **CoinGecko** — price, market cap, supply, ATH, trending. Works keyless; a free [Demo API key](https://www.coingecko.com/en/api/pricing) (`COINGECKO_API_KEY`) raises rate limits.
- **Binance public data mirror** (`data-api.binance.vision`) — daily klines for RSI14 / MA20-50 crosses / volume spikes / 30d BTC beta; perp funding + open interest are optional (geo-blocked regions just get nulls).
- **DeFiLlama** — chain TVL + 7d change (keyless).
- **Alternative.me** — Fear & Greed index (keyless).
- **RSS** — CoinDesk / Cointelegraph / The Block / Decrypt headlines matched to tracked symbols → `/crypto/catalysts`.

### Env vars

All optional (missing vars degrade gracefully, nothing crashes):

- `COINGECKO_API_KEY` — CoinGecko Demo key (recommended).
- `CRYPTO_TASK_SECRET` — dedicated secret for the claude.ai scheduled tasks (rotatable independently of `SYNC_SECRET`; both are accepted by the crypto endpoints).
- `BINANCE_API_BASE` — override the Binance spot base URL (leave unset normally).

### One-time setup

1. Deploy (the migration applies via `prisma migrate deploy` in the build step), then seed the initial assets (BTC/ETH/SOL/SEI):
   ```bash
   curl -X POST "https://<domain>/api/crypto/seed?secret=$CRYPTO_TASK_SECRET"
   ```
2. Run the first data sync (or use the "Sync now" button on `/crypto`):
   ```bash
   curl "https://<domain>/api/crypto/sync?secret=$CRYPTO_TASK_SECRET"
   ```
3. Set your holdings (quantity / avg cost) and theses on `/crypto/portfolio`.
4. **Daily schedule**: add the `SYNC_SECRET` repo secret on GitHub and replace `YOUR-PROD-DOMAIN` in [.github/workflows/crypto-sync.yml](.github/workflows/crypto-sync.yml) — it hits `/api/crypto/sync` daily at 21:45 UTC (05:45 GMT+8). Vercel crons aren't used (Hobby's 2-cron cap is taken by stocks).
5. **AI briefs**: create three claude.ai scheduled tasks (daily ~06:15 GMT+8, weekly Sunday, monthly 1st) using the prompts in [docs/crypto-ai-tasks.md](docs/crypto-ai-tasks.md), substituting your domain and `CRYPTO_TASK_SECRET`. The daily task reads `GET /api/crypto/context`, decides BUY/ADD/HOLD/TRIM/SELL per holding, grades yesterday's calls, and POSTs to `/api/crypto/brief` + `/api/crypto/learning`; weekly/monthly tasks rewrite the heuristics playbook that feeds the next daily run. Running a task manually works the same as a scheduled run (briefs upsert per GMT+8 day).

### Endpoints

- `GET /api/crypto/sync` — full daily sync (markets → signals → derivatives → TVL → trending → catalysts). Auth: `?secret=` or `Authorization: Bearer` with `SYNC_SECRET`/`CRON_SECRET`/`CRYPTO_TASK_SECRET`.
- `POST /api/crypto/seed` — idempotent seed of the starter assets.
- `GET /api/crypto/context[?scope=weekly|monthly]` — compact JSON snapshot for the AI tasks.
- `POST /api/crypto/brief`, `POST /api/crypto/learning` — written back by the AI tasks.

If a sync or brief is missed, the UI keeps serving the last good rows; the overview shows a staleness warning when the latest brief is older than 2 days.
