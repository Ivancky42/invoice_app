/**
 * Invoicing MCP tools: quotations, invoices, delivery orders, PDFs, clients, company
 * profiles and recurring schedules. Every tool needs the full `mcp:tools` scope — a
 * shadow-only (paper-trading) connector can neither read nor change billing.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { mcpInput } from "@/lib/agent/mcp-input";
import { canWriteRealBook } from "@/lib/agent/mcp-scope";
import { validationFailure } from "@/lib/agent/schemas";
import {
  appUrl,
  billingSummary,
  convertDocument,
  createDocument,
  deleteDocument,
  duplicateDocument,
  findDocumentRow,
  getDocument,
  InvoicingError,
  listClients,
  listCompanies,
  listDocuments,
  setDocumentStatus,
  updateDocument,
  upsertClient,
  upsertCompany,
} from "@/lib/invoicing/documents";
import {
  billingSummarySchema,
  createDocumentSchema,
  createRecurringSchema,
  deleteDocumentSchema,
  deleteRecurringSchema,
  documentRefSchema,
  duplicateDocumentSchema,
  listDocumentsSchema,
  listRecurringSchema,
  pdfSchema,
  recurringFromDocumentSchema,
  recurringRefSchema,
  runRecurringSchema,
  setStatusSchema,
  updateDocumentSchema,
  updateRecurringSchema,
  upsertClientSchema,
  upsertCompanySchema,
} from "@/lib/invoicing/inputs";
import { signPdfPath } from "@/lib/invoicing/pdfLink";
import { renderDocumentPdf } from "@/lib/invoicing/pdfRender";
import {
  createRecurringFromDocument,
  createRecurringInvoice,
  deleteRecurringInvoice,
  getRecurringInvoice,
  listRecurringInvoices,
  runDueRecurringInvoices,
  updateRecurringInvoice,
} from "@/lib/invoicing/recurring";

/** The slice of the SDK v2 handler context we read: auth lives under `http` (undefined on stdio). */
type ToolExtra = { http?: { authInfo?: { scopes?: string[] } } };
type ToolResult = {
  content: (
    | { type: "text"; text: string }
    | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } }
  )[];
  isError?: true;
};

/** Largest PDF embedded inline; bigger ones come back as a signed link only. */
const MAX_EMBEDDED_PDF_BYTES = 3 * 1024 * 1024;

const TEMPLATE_HELP =
  "Line item descriptions, project title/description and notes may contain {{period}} (e.g. 'November 2026'), {{month}}, {{year}}, {{date}}, {{n}} (invoice number in the series) and {{of}} (series length), filled in on each generated invoice.";

function text(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function fail(error: string, message: string, extra: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error, message, ...extra }) }], isError: true };
}

type InvoiceToolSpec<S extends z.ZodObject> = {
  title: string;
  description: string;
  schema: S;
  kind: "read" | "write" | "destructive";
  run: (input: z.infer<S>) => Promise<unknown | ToolResult>;
};

function isToolResult(v: unknown): v is ToolResult {
  return typeof v === "object" && v !== null && Array.isArray((v as ToolResult).content);
}

function register<S extends z.ZodObject>(server: McpServer, name: string, spec: InvoiceToolSpec<S>) {
  server.registerTool(
    name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: mcpInput(spec.schema),
      annotations: {
        title: spec.title,
        readOnlyHint: spec.kind === "read",
        destructiveHint: spec.kind === "destructive",
        idempotentHint: spec.kind === "read",
        openWorldHint: false,
      },
    },
    async (args: unknown, extra: ToolExtra) => {
      if (!canWriteRealBook(extra?.http?.authInfo?.scopes)) {
        return fail(
          "invoice_scope_forbidden",
          "Billing tools need the full mcp:tools connector; this connector is mcp:shadow only.",
        );
      }
      const parsed = spec.schema.safeParse(args ?? {});
      if (!parsed.success) {
        const failure: ToolResult = {
          content: [{ type: "text", text: JSON.stringify(validationFailure(parsed.error)) }],
          isError: true,
        };
        return failure;
      }
      try {
        const out = await spec.run(parsed.data);
        return isToolResult(out) ? out : text(out);
      } catch (e) {
        if (e instanceof InvoicingError) return fail(e.code, e.message);
        const message = e instanceof Error ? e.message : String(e);
        if (/Invalid date/.test(message)) return fail("invalid", message);
        if (/Unique constraint/i.test(message)) return fail("conflict", message);
        console.error(`[mcp ${name}]`, message);
        return fail("internal_error", `${name} failed: ${message.slice(0, 300)}`);
      }
    },
  );
}

/** Register every invoicing tool. Order is irrelevant; names are pinned in mcp-tools.test.ts. */
export function registerInvoiceMcpTools(server: McpServer): void {
  // ---------------------------------------------------------------- documents: read
  register(server, "list_invoices", {
    title: "List invoices",
    kind: "read",
    description:
      "List billing documents (invoices, quotations, delivery orders), newest first. Filter by type, statuses, company, client, issue-date range, free-text search, or overdueOnly (ISSUED invoices past due — due date, else Net-N terms, else 30 days — sorted most overdue first). Each row has totals, effectiveDueDate, daysOverdue and an appUrl. Use get_invoice for line items.",
    schema: listDocumentsSchema,
    run: (input) => listDocuments(input),
  });

  register(server, "get_invoice", {
    title: "Get invoice",
    kind: "read",
    description:
      "Full detail of one invoice, quotation or delivery order by id or number (e.g. INV-2026-0007): bill-to, line items, totals, terms, linked parent/children, recurring schedule, appUrl.",
    schema: documentRefSchema,
    run: ({ id }) => getDocument(id),
  });

  register(server, "get_invoice_pdf", {
    title: "Get invoice PDF",
    kind: "read",
    description:
      "Render a document's PDF. Returns a signed download link that works without the app PIN (default 7 days, max 90) and, unless includeFile=false, the PDF itself as an embedded application/pdf resource (base64). Share the link with the client or Ivan to download.",
    schema: pdfSchema,
    run: async ({ id, includeFile, linkTtlDays }) => {
      const doc = await findDocumentRow(id);
      const signed = await signPdfPath(doc.id, {
        download: true,
        ttlSec: Math.round((linkTtlDays ?? 7) * 86_400),
      });
      const meta = {
        id: doc.id,
        number: doc.number,
        filename: `${doc.number}.pdf`,
        downloadUrl: signed ? appUrl(signed.path) : null,
        downloadUrlExpiresAt: signed?.expiresAt.toISOString() ?? null,
        appPdfUrl: appUrl(`/api/pdf/${doc.id}?download=1`),
        note: signed
          ? "downloadUrl needs no PIN until it expires. appPdfUrl needs the app PIN."
          : "No signing secret configured (PDF_LINK_SECRET / APP_GATE_SECRET); only appPdfUrl (PIN) is available.",
      };
      if (includeFile === false) return meta;
      const rendered = await renderDocumentPdf(doc.id);
      if (!rendered) throw new InvoicingError("not_found", `No document "${id}"`);
      if (rendered.pdf.length > MAX_EMBEDDED_PDF_BYTES) {
        return { ...meta, embedded: false, bytes: rendered.pdf.length, reason: "PDF too large to embed; use downloadUrl" };
      }
      return {
        content: [
          { type: "text", text: JSON.stringify({ ...meta, embedded: true, bytes: rendered.pdf.length }) },
          {
            type: "resource",
            resource: {
              uri: meta.downloadUrl ?? meta.appPdfUrl,
              mimeType: "application/pdf",
              blob: rendered.pdf.toString("base64"),
            },
          },
        ],
      } satisfies ToolResult;
    },
  });

  register(server, "get_billing_summary", {
    title: "Get billing summary",
    kind: "read",
    description:
      "Per company profile: invoiced (ISSUED+PAID), collected (PAID), outstanding (ISSUED), overdue amount and count, draft invoices, open quotations; plus active recurring schedules and the next one due. Optional company and issue-date range.",
    schema: billingSummarySchema,
    run: (input) => billingSummary(input),
  });

  // ---------------------------------------------------------------- documents: write
  register(server, "create_invoice", {
    title: "Create invoice",
    kind: "write",
    description:
      "Create an invoice (default), quotation (type=QUOTATION) or delivery order. Biller = companyId / companyName / the default profile; its tax rate and default notes apply unless given. clientName matches a saved client (case- and dot-insensitive) and fills address/email/phone. Status defaults to DRAFT; issueDate to today (Malaysia time). An invoice with Net-N paymentTerms and no dueDate gets dueDate = issueDate + N. Numbers are assigned automatically (INV-YYYY-NNNN).",
    schema: createDocumentSchema,
    run: (input) => createDocument(input),
  });

  register(server, "update_invoice", {
    title: "Update invoice",
    kind: "write",
    description:
      "Patch any field of an invoice / quotation / delivery order by id or number. Only fields you pass change; items, when passed, replace all line items. Totals are recomputed. Passing clientId switches the client and refreshes the bill-to block.",
    schema: updateDocumentSchema,
    run: (input) => updateDocument(input),
  });

  register(server, "set_invoice_status", {
    title: "Set invoice status",
    kind: "write",
    description:
      "Set status DRAFT / ISSUED / PAID / CANCELLED (e.g. mark an invoice paid). Issuing an invoice that has no due date sets one from its Net-N terms.",
    schema: setStatusSchema,
    run: ({ id, status }) => setDocumentStatus(id, status),
  });

  register(server, "convert_invoice", {
    title: "Convert to next stage",
    kind: "write",
    description:
      "Advance the lifecycle: quotation → invoice → delivery order. Creates a new DRAFT document dated today with the same lines, linked to its parent. Returns the new document.",
    schema: documentRefSchema,
    run: ({ id }) => convertDocument(id),
  });

  register(server, "duplicate_invoice", {
    title: "Duplicate invoice",
    kind: "write",
    description:
      "Copy a document as a new one of the same type with a new number (default: DRAFT, dated today; invoices get a due date from Net-N terms). Handy for one-off repeat billing.",
    schema: duplicateDocumentSchema,
    run: ({ id, issueDate, status }) => duplicateDocument(id, { issueDate, status }),
  });

  register(server, "delete_invoice", {
    title: "Delete invoice",
    kind: "destructive",
    description:
      "Permanently delete a document (requires confirm=true). Prefer set_invoice_status CANCELLED to keep a record. Linked child documents are kept.",
    schema: deleteDocumentSchema,
    run: ({ id }) => deleteDocument(id),
  });

  // ---------------------------------------------------------------- clients & billers
  register(server, "list_invoice_clients", {
    title: "List clients",
    kind: "read",
    description: "Saved clients (bill-to profiles) with contact details and how many documents each has.",
    schema: z.object({ search: z.string().optional().describe("Case-insensitive name filter") }),
    run: ({ search }) => listClients(search),
  });

  register(server, "upsert_invoice_client", {
    title: "Create or update client",
    kind: "write",
    description: "Create a saved client, or update one by id. Fields not passed are left unchanged on update.",
    schema: upsertClientSchema,
    run: (input) => upsertClient(input),
  });

  register(server, "list_company_profiles", {
    title: "List company profiles",
    kind: "read",
    description:
      "Billing entities (who invoices are FROM): name, address, currency, tax rate, bank details, default notes, which one is default.",
    schema: z.object({}),
    run: () => listCompanies(),
  });

  register(server, "upsert_company_profile", {
    title: "Create or update company profile",
    kind: "write",
    description:
      "Create a billing entity (name + address required) or update one by id. bankDetails print on invoices; setting isDefault=true clears the flag on the others. Logo upload stays in the app's Settings page.",
    schema: upsertCompanySchema,
    run: (input) => upsertCompany(input),
  });

  // ---------------------------------------------------------------- recurring
  register(server, "list_recurring_invoices", {
    title: "List recurring invoices",
    kind: "read",
    description:
      "Recurring billing schedules: status (ACTIVE / PAUSED / ENDED), frequency, next and last run dates, invoices generated vs total, amount per invoice, last error.",
    schema: listRecurringSchema,
    run: ({ status }) => listRecurringInvoices({ status }),
  });

  register(server, "get_recurring_invoice", {
    title: "Get recurring invoice",
    kind: "read",
    description:
      "One schedule with its invoice template, the next 6 billing dates, and every invoice it has generated.",
    schema: recurringRefSchema,
    run: ({ id }) => getRecurringInvoice(id),
  });

  register(server, "create_recurring_invoice", {
    title: "Create recurring invoice",
    kind: "write",
    description:
      `Schedule an invoice to be generated automatically every interval × frequency (default monthly) from startDate, for maxOccurrences invoices (e.g. 6 for a six-month project), until endDate, or indefinitely if neither is given. dayOfMonth fixes the billing day (29–31 clamp to month end). Invoices are generated around 06:00 Malaysia time on each date, ISSUED with a due date (autoIssue=false → DRAFT). If startDate is today, the first invoice is created immediately. Past startDates start from today unless backfill=true. ${TEMPLATE_HELP}`,
    schema: createRecurringSchema,
    run: (input) => createRecurringInvoice(input),
  });

  register(server, "create_recurring_from_invoice", {
    title: "Make an invoice recurring",
    kind: "write",
    description:
      "Turn an existing invoice into a schedule using it as the template. By default the invoice counts as #1 of the series (so maxOccurrences=6 → 5 more), and the next invoice is dated one period after it on the same day of month. Use update_recurring_invoice afterwards to add {{period}} placeholders to the template lines.",
    schema: recurringFromDocumentSchema,
    run: (input) => createRecurringFromDocument(input),
  });

  register(server, "update_recurring_invoice", {
    title: "Update recurring invoice",
    kind: "write",
    description:
      `Change a schedule's timing, length, template (client, lines, tax, terms…) or status. status=PAUSED stops generation; ACTIVE resumes from the next date on or after today (dates missed while paused are not billed); ENDED stops for good. Changes apply to invoices generated from now on; existing invoices are untouched. ${TEMPLATE_HELP}`,
    schema: updateRecurringSchema,
    run: (input) => updateRecurringInvoice(input),
  });

  register(server, "delete_recurring_invoice", {
    title: "Delete recurring invoice",
    kind: "destructive",
    description:
      "Delete a schedule (requires confirm=true). Invoices it already generated are kept. To stop billing but keep the history, use update_recurring_invoice status=ENDED instead.",
    schema: deleteRecurringSchema,
    run: ({ id }) => deleteRecurringInvoice(id),
  });

  register(server, "run_recurring_invoices", {
    title: "Run due recurring invoices",
    kind: "write",
    description:
      "Generate every invoice that is due now (next date on or before today, Malaysia time) — the same thing the daily 06:00 job does. Safe to repeat: a date is never billed twice. Pass id to run one schedule.",
    schema: runRecurringSchema,
    run: ({ id }) => runDueRecurringInvoices({ scheduleId: id }),
  });
}

export const INVOICE_TOOL_NAMES = [
  "convert_invoice",
  "create_invoice",
  "create_recurring_from_invoice",
  "create_recurring_invoice",
  "delete_invoice",
  "delete_recurring_invoice",
  "duplicate_invoice",
  "get_billing_summary",
  "get_invoice",
  "get_invoice_pdf",
  "get_recurring_invoice",
  "list_company_profiles",
  "list_invoice_clients",
  "list_invoices",
  "list_recurring_invoices",
  "run_recurring_invoices",
  "set_invoice_status",
  "update_invoice",
  "update_recurring_invoice",
  "upsert_company_profile",
  "upsert_invoice_client",
] as const;
