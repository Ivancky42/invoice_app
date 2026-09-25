/**
 * Per-request timeout for third-party price providers (EODHD, Finnhub, stooq).
 *
 * Without one, undici waits up to 300s for headers and 300s more for a body, so a single
 * provider that holds the connection open outlives the tick's 300s maxDuration. Vercel then
 * kills the function mid-job: the budget check between tickers never runs, the JobRun row
 * stays RUNNING, and every downstream job (fill, mark, fitness, evaluate) is skipped —
 * 2026-09-22..24. A timed-out call throws, and callers already treat a throw as a
 * per-ticker provider failure.
 */
export const PROVIDER_FETCH_TIMEOUT_MS = 10_000;

export function providerSignal(): AbortSignal {
  return AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS);
}

/** True for the error `providerSignal()` raises when the provider did not answer in time. */
export function isProviderTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}
