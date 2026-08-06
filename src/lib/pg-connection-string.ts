/**
 * Normalize Postgres URLs for the `pg` driver + Neon.
 * - pg v8 treats sslmode=require|prefer|verify-ca like verify-full but logs a deprecation warning.
 * - Neon: sslnegotiation=direct skips an SSL negotiation round-trip on the proxy.
 */

function withQueryParam(url: string, key: string, value: string): string {
  if (new RegExp(`[?&]${key}=`).test(url)) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}${key}=${value}`;
}

export function normalizePgConnectionString(url: string): string {
  if (/localhost|127\.0\.0\.1/.test(url)) return url;

  let out = url;

  const sslRe = /([?&])sslmode=([^&]*)/;
  const m = sslRe.exec(out);
  if (m) {
    const mode = decodeURIComponent(m[2]);
    if (mode === "require" || mode === "prefer" || mode === "verify-ca") {
      out = out.replace(sslRe, (_, pre: string) => `${pre}sslmode=verify-full`);
    }
  } else {
    out = withQueryParam(out, "sslmode", "verify-full");
  }

  // Neon proxy supports direct SSL negotiation (faster connect) with PG17+ clients.
  if (/\.neon\.tech\b/i.test(out)) {
    out = withQueryParam(out, "sslnegotiation", "direct");
  }

  return out;
}
