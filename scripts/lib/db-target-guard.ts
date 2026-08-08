/**
 * Refuse accidental writes against remote/prod databases from offline scripts.
 *
 * Local Docker (`localhost` / `127.0.0.1`) is allowed without a confirm flag.
 * Any other host (Neon, Railway, etc.) requires `--confirm-destructive` on wipe
 * scripts, or `--confirm-write` on mutating-but-non-wipe scripts.
 */
export type DbTarget = {
  url: string;
  host: string;
  database: string;
  isLocal: boolean;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** Parse DATABASE_URL / DIRECT_DATABASE_URL into a host fingerprint (never logs secrets). */
export function inspectDatabaseUrl(
  raw = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim(),
): DbTarget {
  if (!raw) {
    throw new Error("DATABASE_URL (or DIRECT_DATABASE_URL) is not set");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }

  const host = stripBrackets(parsed.hostname || "").toLowerCase();
  if (!host) throw new Error("DATABASE_URL has no host");

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0] ?? "");
  const isLocal =
    LOCAL_HOSTS.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host === "postgres" || // docker compose service name
    host === "db";

  return { url: raw, host, database: database || "(default)", isLocal };
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
    `DB target: host=${target.host} db=${target.database} local=${target.isLocal}`,
  );

  if (target.isLocal) {
    if (!confirmed) {
      console.warn(
        `Warning: ${purpose} will mutate local DB. Pass --confirm-destructive to silence this.`,
      );
    }
    return target;
  }

  if (!confirmed) {
    throw new Error(
      `Refusing to ${purpose} on remote DB (${target.host}/${target.database}).\n` +
        `Re-run with --confirm-destructive after double-checking DATABASE_URL.`,
    );
  }

  console.warn(
    `CONFIRMED destructive run on REMOTE ${target.host}/${target.database}: ${purpose}`,
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
    `DB target: host=${target.host} db=${target.database} local=${target.isLocal}`,
  );

  if (target.isLocal) return target;

  if (!confirmed) {
    throw new Error(
      `Refusing to ${purpose} on remote DB (${target.host}/${target.database}).\n` +
        `Re-run with --confirm-write after double-checking DATABASE_URL.`,
    );
  }

  console.warn(`CONFIRMED write on REMOTE ${target.host}/${target.database}: ${purpose}`);
  return target;
}
