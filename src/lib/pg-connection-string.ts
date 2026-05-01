/**
 * pg v8 treats sslmode=require|prefer|verify-ca like verify-full but logs a deprecation warning.
 * Set verify-full explicitly for remote DBs (e.g. Neon). See pg-connection-string / pg v9 migration notes.
 */
export function normalizePgConnectionString(url: string): string {
  if (/localhost|127\.0\.0\.1/.test(url)) return url;

  const sslRe = /([?&])sslmode=([^&]*)/;
  const m = sslRe.exec(url);
  if (m) {
    const mode = decodeURIComponent(m[2]);
    if (mode === "require" || mode === "prefer" || mode === "verify-ca") {
      return url.replace(sslRe, (_, pre: string) => `${pre}sslmode=verify-full`);
    }
    return url;
  }

  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}sslmode=verify-full`;
}
