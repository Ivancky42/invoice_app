# Invoice App

Simple Next.js invoice app with Quotation → Invoice → Delivery Order lifecycle, PDF export, and a Postgres database in Docker.

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
