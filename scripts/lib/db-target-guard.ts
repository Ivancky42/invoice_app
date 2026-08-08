/**
 * Refuse accidental writes against remote/prod databases from offline scripts.
 *
 * Local Docker (`localhost` / `127.0.0.1`) is allowed without a confirm flag.
 * Any other host (Neon, Railway, etc.) requires `--confirm-destructive` on wipe
 * scripts, or `--confirm-write` on mutating-but-non-wipe scripts.
 *
 * Remoteness is judged from BOTH `DATABASE_URL` (what Prisma writes through) and
 * `DIRECT_DATABASE_URL` when set. Preferring only DIRECT let a prod DATABASE_URL
 * override slip past a local DIRECT in `.env` and wipe Neon without confirm.
 */
export type DbTarget = {
  /** The URL Prisma actually uses for these scripts. */
  url: string;
  host: string;
  database: string;
  isLocal: boolean;
  /** True when any configured URL points at a non-local host. */
  requiresConfirm: boolean;
  hosts: string[];
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isLocalHost(host: string): boolean {
  return (
    LOCAL_HOSTS.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host === "postgres" || // docker compose service name
    host === "db"
  );
}

function parseUrl(raw: string): { host: string; database: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Database URL is not a valid URL");
  }
  const host = stripBrackets(parsed.hostname || "").toLowerCase();
  if (!host) throw new Error("Database URL has no host");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0] ?? "");
  return { host, database: database || "(default)" };
}

/**
 * Inspect write target. Prisma scripts use DATABASE_URL; DIRECT is checked too so a
 * mismatched pair cannot bypass the confirm gate.
 */
export function inspectDatabaseUrl(
  databaseUrl = process.env.DATABASE_URL?.trim(),
  directUrl = process.env.DIRECT_DATABASE_URL?.trim(),
): DbTarget {
  if (!databaseUrl && !directUrl) {
    throw new Error("DATABASE_URL (or DIRECT_DATABASE_URL) is not set");
  }

  // Prisma (`src/lib/prisma.ts`) always writes through DATABASE_URL — refuse a DIRECT-only
  // setup that would make the guard green while the script immediately fails (or worse,
  // a future prisma change that silently falls back).
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set (Prisma writes through DATABASE_URL; DIRECT_DATABASE_URL alone is not enough)",
    );
  }

  const writeUrl = databaseUrl;
  const write = parseUrl(writeUrl);
  const hosts = [write.host];
  let requiresConfirm = !isLocalHost(write.host);

  if (directUrl && directUrl !== writeUrl) {
    const direct = parseUrl(directUrl);
    hosts.push(direct.host);
    if (!isLocalHost(direct.host)) requiresConfirm = true;
  }

  return {
    url: writeUrl,
    host: write.host,
    database: write.database,
    isLocal: isLocalHost(write.host),
    requiresConfirm,
    hosts: [...new Set(hosts)],
  };
}

export function argvHasFlag(flag: string, argv: string[] = process.argv): boolean {
  return argv.includes(flag);
}

/**
 * Gate for scripts that DELETE / wipe shadow ledger state.
 * Remote targets require `--confirm-destructive`.
 */
export function assertDestructiveAllowed(purpose: string, argv: string[] = process.argv): DbTarget {
  const target = inspectDatabaseUrl();
  const confirmed = argvHasFlag("--confirm-destructive", argv);

  console.log(
    `DB target: host=${target.host} db=${target.database}` +
      ` local=${target.isLocal} requiresConfirm=${target.requiresConfirm}` +
      (target.hosts.length > 1 ? ` hosts=${target.hosts.join(",")}` : ""),
  );

  if (!target.requiresConfirm) {
    if (!confirmed) {
      console.warn(
        `Warning: ${purpose} will mutate local DB. Pass --confirm-destructive to silence this.`,
      );
    }
    return target;
  }

  if (!confirmed) {
    throw new Error(
      `Refusing to ${purpose} on remote DB (${target.hosts.join(" / ")} → ${target.database}).\n` +
        `Re-run with --confirm-destructive after double-checking DATABASE_URL.`,
    );
  }

  console.warn(
    `CONFIRMED destructive run on REMOTE ${target.hosts.join(" / ")}/${target.database}: ${purpose}`,
  );
  return target;
}

/**
 * Gate for scripts that UPDATE derived rows but do not wipe the paper book.
 * Remote targets require `--confirm-write`.
 */
export function assertWriteAllowed(purpose: string, argv: string[] = process.argv): DbTarget {
  const target = inspectDatabaseUrl();
  const confirmed =
    argvHasFlag("--confirm-write", argv) || argvHasFlag("--confirm-destructive", argv);

  console.log(
    `DB target: host=${target.host} db=${target.database}` +
      ` local=${target.isLocal} requiresConfirm=${target.requiresConfirm}`,
  );

  if (!target.requiresConfirm) return target;

  if (!confirmed) {
    throw new Error(
      `Refusing to ${purpose} on remote DB (${target.hosts.join(" / ")} → ${target.database}).\n` +
        `Re-run with --confirm-write after double-checking DATABASE_URL.`,
    );
  }

  console.warn(
    `CONFIRMED write on REMOTE ${target.hosts.join(" / ")}/${target.database}: ${purpose}`,
  );
  return target;
}
