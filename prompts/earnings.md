# Earnings routine

**Schedule:** Sunday 18:00 Asia/Kuala_Lumpur (MYT)

Follow [`_shared.md`](_shared.md) for the full write contract (enums, ReportBlock narrative, idempotency, 400 vs 409, no fabricated prices, `get_context` first, stamp `rulesVersion`).

## Focus

- Earnings calendar for tracked tickers (portfolio + watchlist).
- Use Config earnings-risk thresholds from context (imminent / soon / clear) — do not hardcode cutoffs.
- Flag implied move / beat-rate notes; no fabricated prices or invented risk enums.

<!-- Ivan: paste Cowork Setup earnings strategy prose here when ready. -->
