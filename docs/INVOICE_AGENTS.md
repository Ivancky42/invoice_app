# Invoicing for agents (MCP) + recurring invoices

Everything the Invoices app does is available to an AI agent through the same MCP
connector as Stock HQ (`/api/mcp/mcp`, OAuth `mcp:tools` scope or Bearer `AGENT_TOKEN`).
A shadow-only (`mcp:shadow`) connector is refused by every billing tool.

## Tools

| Tool | What it does |
| --- | --- |
| `list_invoices` | Invoices, quotations, delivery orders. Filters: type, status[], company, client, issue-date range, search, `overdueOnly`. |
| `get_invoice` | One document by id **or number** (`INV-2026-0007`): lines, totals, parent/children, schedule. |
| `get_invoice_pdf` | The PDF as an embedded `application/pdf` resource **and** a signed download link (no PIN, 7 days by default, max 90). |
| `get_billing_summary` | Per company: invoiced, collected, outstanding, overdue, drafts, open quotes; next recurring run. |
| `create_invoice` | New invoice (default) / quotation / DO. Client autofill from saved clients; tax and notes from the company profile; Net-N → due date. |
| `update_invoice` | Patch any field; `items` replaces the lines; totals recomputed. |
| `set_invoice_status` | DRAFT / ISSUED / PAID / CANCELLED. Issuing derives a due date from Net-N terms if none. |
| `convert_invoice` | Quotation → Invoice → Delivery Order (new DRAFT linked to its parent). |
| `duplicate_invoice` | Copy as a new document, today's date. |
| `delete_invoice` | Permanent; needs `confirm: true`. Prefer CANCELLED. |
| `list_invoice_clients` / `upsert_invoice_client` | Saved bill-to clients. |
| `list_company_profiles` / `upsert_company_profile` | Billing entities (bank details, currency, tax, default). Logos stay in Settings. |
| `list_recurring_invoices` / `get_recurring_invoice` | Schedules, next 6 dates, invoices generated. |
| `create_recurring_invoice` | New schedule from a template (see below). |
| `create_recurring_from_invoice` | Make an existing invoice recurring; it counts as #1. |
| `update_recurring_invoice` | Change timing, length, template, or status (pause / resume / end). |
| `delete_recurring_invoice` | Needs `confirm: true`; generated invoices are kept. |
| `run_recurring_invoices` | Generate whatever is due now (same as the daily job). Idempotent. |

Dates are `YYYY-MM-DD` calendar days in `BILLING_TIMEZONE` (default `Asia/Kuala_Lumpur`).
Overdue = ISSUED invoice past its due date, else issue date + Net-N terms, else + 30 days.

## Recurring invoices

A schedule is an invoice template + a cadence:

- `frequency` WEEKLY / MONTHLY / QUARTERLY / YEARLY, `interval` (every N), `dayOfMonth`
  (29–31 clamp to month end without drifting).
- Ends after `maxOccurrences` invoices (e.g. 6 for a six-month project), on `endDate`, or
  never (indefinite).
- `autoIssue` (default true) → invoices are ISSUED with a due date; false → DRAFT.
- Template text can use `{{period}}` (“November 2026”), `{{month}}`, `{{year}}`,
  `{{date}}`, `{{n}}`, `{{of}}` — e.g. `Retainer {{period}} ({{n}}/{{of}})`.
  Making an existing invoice recurring rewrites its own month (“October 2026”) to
  `{{period}}` automatically.

**When they run.** The `recurring_invoices` job is first in the daily `/api/cron/tick`
(22:00 UTC = 06:00 MYT), so an invoice dated the 5th is created around 06:00 on the 5th.
A schedule whose first date is today bills immediately on creation. If the cron misses
days, the next run catches up — each invoice dated its own slot (max 24 per run). A slot
can never be billed twice (unique per schedule + date, row-locked generation). Pausing
then resuming skips the dates missed while paused.

**In the app.** Invoices ▸ Recurring lists schedules (pause / resume / run now). An invoice
page has **Make recurring**; the New Invoice form has **Bill this automatically**.

## Examples

```jsonc
// Six-month project billed on the 1st, first invoice 1 Dec
create_recurring_invoice {
  "name": "Acme app build", "clientName": "Acme Sdn Bhd", "companyName": "Grumpy Pixels",
  "startDate": "2026-12-01", "maxOccurrences": 6, "paymentTerms": "Net 14",
  "items": [{ "description": "App development — {{period}} ({{n}}/{{of}})", "quantity": 1, "unitPrice": 8000 }]
}

// Indefinite monthly retainer from an invoice already sent
create_recurring_from_invoice { "documentId": "INV-2026-0012" }

// Mark paid, then send the client a link
set_invoice_status { "id": "INV-2026-0012", "status": "PAID" }
get_invoice_pdf { "id": "INV-2026-0013", "includeFile": false, "linkTtlDays": 30 }
```

## Signed PDF links

`/api/pdf/<id>?exp=<unix>&sig=<hmac>` passes the PIN gate when the HMAC
(`PDF_LINK_SECRET`, else `APP_GATE_SECRET`, else `AGENT_TOKEN`) verifies and hasn't
expired; anything else gets 403. Rotating the secret revokes every outstanding link.
