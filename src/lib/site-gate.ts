/** Shared PIN gate: Edge-safe token + helpers (middleware + server actions). */

export const SITE_GATE_COOKIE = "invoice_site_gate";
export const SITE_GATE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

/** Minimum APP_GATE_SECRET length (long random string, not related to PIN). */
const MIN_SECRET_CHARS = 16;

export function gateEnv(): { pin: string; secret: string } | null {
  const pin = process.env.APP_PIN?.trim() ?? "";
  const secret = process.env.APP_GATE_SECRET ?? "";
  if (!/^\d{6}$/.test(pin)) return null;
  if (secret.length < MIN_SECRET_CHARS) return null;
  return { pin, secret };
}

export function gateConfigured(): boolean {
  return gateEnv() !== null;
}

export function pinMatches(expected: string, input: string): boolean {
  if (expected.length !== input.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) r |= expected.charCodeAt(i) ^ input.charCodeAt(i);
  return r === 0;
}

/** Reject absolute URLs so open redirects can't point off-site. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  try {
    const u = new URL(next, "http://local.invalid");
    if (u.origin !== "http://local.invalid") return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(raw: string): Uint8Array {
  let b = raw.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4;
  if (pad) b += "=".repeat(4 - pad);
  const bin = atob(b);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSiteGateToken(secret: string, expMs: number): Promise<string> {
  const payloadStr = JSON.stringify({ exp: expMs });
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

export async function verifySiteGateToken(token: string, secret: string): Promise<boolean> {
  try {
    const dot = token.indexOf(".");
    if (dot < 0) return false;
    const payloadBytes = base64UrlToBytes(token.slice(0, dot));
    const sigBytes = base64UrlToBytes(token.slice(dot + 1));
    const key = await importHmacKey(secret);
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      new Uint8Array(sigBytes),
      new Uint8Array(payloadBytes),
    );
    if (!ok) return false;
    const payloadStr = new TextDecoder().decode(payloadBytes);
    const parsed = JSON.parse(payloadStr) as { exp?: unknown };
    const exp = parsed.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return false;
    return Date.now() < exp;
  } catch {
    return false;
  }
}
