# Stock HQ — shared write contract

Baseline rules for all Cowork routines (daily / weekly / earnings / monthly).
**Neon is the book of record.** Live portfolio state, cash, FX, limits, and thresholds come from `get_context` (Neon Config + tables) via MCP / `/api/agent/*`. Strategy prose may be expanded later from Cowork Setup; this file owns the **data-write contract**. Never write to Notion.

## Before writing

1. Call `get_context(routine=…)` first. Treat it as authoritative (cash, NAV, positions, watchlist, limits, legal enums, `rulesVersion`). Do not rely on memory from a previous run.
2. Read this file plus the routine-specific prompt. Follow them exactly.
3. Do the analysis, then write **only** via Stock HQ MCP (`/api/mcp/mcp`) or `/api/agent/*` tools.

## DATA WRITES

- Write only via the Stock HQ MCP tools (or matching HTTP routes). Never write to Notion. Never write prose the site has to parse.
- All status-like fields take enum values (`SCREAMING_SNAKE_CASE`) from the tool schema / context `enums` payload. Never invent a value. Never add emoji. If nothing fits, omit the field and note it in the daily log rather than coining a new status.
- Narrative content is an array of **ReportBlock** objects, not markdown and not a plain string. Use the existing block shapes (paragraph, headings, lists, tables, etc.).
- Every write is idempotent — safe to retry. Supply `idempotencyKey` on trades.
- A **400** means your payload was wrong: read the returned list of legal values and retry once.
- A **409** means the write violated a portfolio rule: **do not retry** — report it to Ivan (and record the conflict in the daily log if applicable).
- Never fabricate a price. Prices come from the price sync only.
- Stamp `rulesVersion` from context onto every write so runs are attributable to the git SHA of `/prompts`.

## Escalation

- Soft limit warnings (`warnings[]` on 200) are informational; hard caps are 409.
- Rule or limit changes go through a git commit to `/prompts` or a deliberate Config update by Ivan — agents must not rewrite the rules they are evaluated against.
