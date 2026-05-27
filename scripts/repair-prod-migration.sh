#!/usr/bin/env bash
# One-time repair for failed 20250527150000 on Neon/Vercel prod.
# Usage (from repo root, with Neon *direct* URL — not pooled):
#   DIRECT_DATABASE_URL='postgresql://...' ./scripts/repair-prod-migration.sh
set -euo pipefail

if [[ -z "${DIRECT_DATABASE_URL:-}" && -z "${DATABASE_URL:-}" ]]; then
  echo "Set DIRECT_DATABASE_URL to your Neon direct connection string (see .env.example)."
  exit 1
fi

echo "Marking failed migration as applied (columns already exist from 20250527140000)..."
pnpm exec prisma migrate resolve --applied 20250527150000_portfolio_snapshot_breakdown --config prisma.config.ts

echo "Applying pending migrations (holdingsBreakdown)..."
pnpm exec prisma migrate deploy --config prisma.config.ts

echo "Done. Redeploy on Vercel — build should pass."
