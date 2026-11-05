/**
 * Expiring, HMAC-signed PDF links: `/api/pdf/<id>?exp=<unix seconds>&sig=<base64url>`.
 *
 * The PIN gate (src/proxy.ts) lets a request through to /api/pdf/* only when the
 * signature verifies, so an agent can hand Ivan (or a client) a download link without
 * the PIN. Edge-safe (Web Crypto only) because the proxy calls `verifyPdfLink`.
 */

export const DEFAULT_PDF_LINK_TTL_SEC = 7 * 24 * 60 * 60;
export const MAX_PDF_LINK_TTL_SEC = 90 * 24 * 60 * 60;

/** Dedicated secret if set; otherwise the gate / agent secrets that already exist. */
export function pdfLinkSecret(): string | null {
  const secret =
    process.env.PDF_LINK_SECRET?.trim() ||
    process.env.APP_GATE_SECRET?.trim() ||
    process.env.AGENT_TOKEN?.trim() ||
    "";
  return usable(secret);
}

function usable(secret: string | null | undefined): string | null {
  return secret && secret.length >= 16 ? secret : null;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`pdf-link:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function signPdfPath(
  documentId: string,
  opts: { ttlSec?: number; download?: boolean; nowMs?: number; secret?: string } = {},
): Promise<{ path: string; expiresAt: Date } | null> {
  const secret = opts.secret !== undefined ? usable(opts.secret) : pdfLinkSecret();
  if (!secret) return null;
  const ttl = Math.min(Math.max(60, opts.ttlSec ?? DEFAULT_PDF_LINK_TTL_SEC), MAX_PDF_LINK_TTL_SEC);
  const exp = Math.floor((opts.nowMs ?? Date.now()) / 1000) + ttl;
  const sig = await hmac(secret, `${documentId}.${exp}`);
  const q = new URLSearchParams({ exp: String(exp), sig });
  if (opts.download) q.set("download", "1");
  return { path: `/api/pdf/${encodeURIComponent(documentId)}?${q}`, expiresAt: new Date(exp * 1000) };
}

/** True when `exp`/`sig` are a valid, unexpired signature for this document id. */
export async function verifyPdfLink(
  documentId: string,
  exp: string | null,
  sig: string | null,
  opts: { nowMs?: number; secret?: string } = {},
): Promise<boolean> {
  const secret = opts.secret !== undefined ? usable(opts.secret) : pdfLinkSecret();
  if (!secret || !exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  if (Number(exp) * 1000 <= (opts.nowMs ?? Date.now())) return false;
  const expected = await hmac(secret, `${documentId}.${exp}`);
  return constantTimeEqual(expected, sig);
}
