import type { NextRequest } from "next/server";

/** Constant-time string compare to avoid leaking secret length via timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Authorise a cron / task request via `?secret=` or `Authorization: Bearer`.
 * Accepts SYNC_SECRET, CRON_SECRET, or the crypto-dedicated CRYPTO_TASK_SECRET
 * (rotated independently — it lives in claude.ai scheduled-task prompts).
 */
export function authorized(req: NextRequest): boolean {
  const sync = process.env.SYNC_SECRET?.trim();
  const cron = process.env.CRON_SECRET?.trim();
  const task = process.env.CRYPTO_TASK_SECRET?.trim();

  const provided = req.nextUrl.searchParams.get("secret")?.trim() ?? "";
  if (provided) {
    if (sync && timingSafeEqual(sync, provided)) return true;
    if (task && timingSafeEqual(task, provided)) return true;
  }

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (bearer) {
    if (cron && timingSafeEqual(cron, bearer)) return true;
    if (sync && timingSafeEqual(sync, bearer)) return true;
    if (task && timingSafeEqual(task, bearer)) return true;
  }

  return false;
}
