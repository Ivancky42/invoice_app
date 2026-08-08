import type { NextRequest } from "next/server";

/** Constant-time-ish compare so a wrong secret can't be probed byte by byte. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** SYNC_SECRET via `?secret=` or bearer, CRON_SECRET via bearer (Vercel cron). */
export function authorized(req: NextRequest): boolean {
  const sync = process.env.SYNC_SECRET?.trim();
  const cron = process.env.CRON_SECRET?.trim();

  const provided = req.nextUrl.searchParams.get("secret")?.trim() ?? "";
  if (sync && provided && timingSafeEqual(sync, provided)) return true;

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (cron && bearer && timingSafeEqual(cron, bearer)) return true;
  if (sync && bearer && timingSafeEqual(sync, bearer)) return true;

  return false;
}
