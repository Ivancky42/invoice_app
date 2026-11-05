/**
 * Prisma CLI (migrate deploy, db push) must use a DIRECT Postgres connection, never a
 * PgBouncer pool. `migrate deploy` takes a session-level advisory lock; through a
 * transaction pool the unlock can run on a different server connection, leaving the
 * lock held on a pooled connection — every later build then times out waiting for it
 * (P1002). The app runtime keeps using the pooled DATABASE_URL.
 *
 * Order: DIRECT_DATABASE_URL → DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING (set by
 * Neon's Vercel integration) → DATABASE_URL with Neon's "-pooler" host suffix removed.
 */
export function directDatabaseUrl(vars: Record<string, string | undefined>, fallback: () => string): string {
  for (const key of ["DIRECT_DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"]) {
    const v = vars[key]?.trim();
    if (v) return v;
  }
  return unpooledNeonUrl(fallback());
}

/** ep-x-123-pooler.region.aws.neon.tech → ep-x-123.region.aws.neon.tech; other URLs unchanged. */
export function unpooledNeonUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!/\.neon\.tech$/i.test(u.hostname) || !/-pooler\./i.test(u.hostname)) return url;
    u.hostname = u.hostname.replace(/-pooler\./i, ".");
    u.searchParams.delete("pgbouncer");
    return u.toString();
  } catch {
    return url;
  }
}
