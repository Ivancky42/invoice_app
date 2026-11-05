/**
 * Zod input schemas for the invoicing service — shared by the MCP tools and any HTTP
 * caller. Dates are `YYYY-MM-DD` strings (business-timezone calendar days).
 */
import { z } from "zod";

export const DOCUMENT_TYPES = ["QUOTATION", "INVOICE", "DELIVERY_ORDER"] as const;
export const DOCUMENT_STATUSES = ["DRAFT", "ISSUED", "PAID", "CANCELLED"] as const;
export const FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export const RECURRING_STATUSES = ["ACTIVE", "PAUSED", "ENDED"] as const;

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, "expected YYYY-MM-DD")
  .describe("Calendar date YYYY-MM-DD");

const optionalText = z.string().max(5000).nullable().optional();

export const lineItemSchema = z.object({
  description: z.string().min(1).max(2000),
  quantity: z.number().finite(),
  unitPrice: z.number().finite(),
});

export const documentFieldsSchema = z.object({
  type: z.enum(DOCUMENT_TYPES).optional().describe("Default INVOICE"),
  status: z.enum(DOCUMENT_STATUSES).optional().describe("Default DRAFT"),
  issueDate: dateString.optional().describe("Default: today (Asia/Kuala_Lumpur)"),
  dueDate: dateString
    .nullable()
    .optional()
    .describe("Omit on an invoice to derive it from Net-N payment terms; null for none"),
  companyId: z.string().optional().describe("Company profile (biller) id"),
  companyName: z
    .string()
    .optional()
    .describe("Company profile name, matched case-insensitively, when companyId is unknown. Default: the default profile"),
  clientId: z.string().nullable().optional().describe("Saved client id; fills client fields not given"),
  clientName: z
    .string()
    .optional()
    .describe("Client name. Matches a saved client case-insensitively and fills its address/email/phone"),
  clientAddress: optionalText,
  clientEmail: optionalText,
  clientPhone: optionalText,
  shipToAttn: optionalText,
  shipToAddress: optionalText,
  poNumber: optionalText,
  projectTitle: optionalText,
  projectDescription: optionalText,
  items: z.array(lineItemSchema).max(200).optional(),
  taxRate: z.number().min(0).max(100).optional().describe("Percent. Default: company profile's rate"),
  discountType: z.enum(["PERCENT", "AMOUNT"]).optional(),
  discountValue: z.number().min(0).optional(),
  paymentTerms: optionalText.describe('e.g. "Net 30", "Due on receipt"'),
  notes: optionalText,
  terms: optionalText,
});

export const createDocumentSchema = documentFieldsSchema.extend({
  items: z.array(lineItemSchema).min(1).max(200),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = documentFieldsSchema
  .omit({ companyName: true })
  .extend({ id: z.string().min(1).describe("Document id or number (e.g. INV-2026-0007)") });
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const documentRefSchema = z.object({
  id: z.string().min(1).describe("Document id or number (e.g. INV-2026-0007)"),
});

export const listDocumentsSchema = z.object({
  type: z.enum(DOCUMENT_TYPES).optional(),
  status: z.array(z.enum(DOCUMENT_STATUSES)).optional().describe("Any of these statuses"),
  companyId: z.string().optional(),
  clientId: z.string().optional(),
  search: z
    .string()
    .optional()
    .describe("Case-insensitive match on number, client name, project title or PO number"),
  issuedFrom: dateString.optional(),
  issuedTo: dateString.optional(),
  overdueOnly: z
    .boolean()
    .optional()
    .describe("Only ISSUED invoices past their due date (due date, else Net-N terms, else 30 days)"),
  recurringInvoiceId: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional().describe("Default 50"),
  offset: z.number().int().min(0).optional(),
});
export type ListDocumentsInput = z.infer<typeof listDocumentsSchema>;

export const setStatusSchema = z.object({
  id: z.string().min(1).describe("Document id or number"),
  status: z.enum(DOCUMENT_STATUSES),
});

export const duplicateDocumentSchema = z.object({
  id: z.string().min(1).describe("Document id or number to copy"),
  issueDate: dateString.optional().describe("Default today"),
  status: z.enum(DOCUMENT_STATUSES).optional().describe("Default DRAFT"),
});

export const deleteDocumentSchema = z.object({
  id: z.string().min(1).describe("Document id or number"),
  confirm: z.literal(true).describe("Must be true — deletion is permanent"),
});

export const pdfSchema = z.object({
  id: z.string().min(1).describe("Document id or number"),
  includeFile: z
    .boolean()
    .optional()
    .describe("Embed the PDF itself (base64) in the result. Default true"),
  linkTtlDays: z.number().min(1).max(90).optional().describe("Signed link lifetime, default 7"),
});

export const billingSummarySchema = z.object({
  companyId: z.string().optional(),
  issuedFrom: dateString.optional(),
  issuedTo: dateString.optional(),
});

export const upsertClientSchema = z.object({
  id: z.string().optional().describe("Update this client; omit to create"),
  name: z.string().min(1).max(500),
  address: optionalText,
  email: optionalText,
  phone: optionalText,
  shipToAttn: optionalText,
  shipToAddress: optionalText,
});

export const upsertCompanySchema = z.object({
  id: z.string().optional().describe("Update this profile; omit to create"),
  name: z.string().min(1).max(500).optional().describe("Required when creating"),
  address: z.string().max(5000).optional().describe("Required when creating"),
  email: optionalText,
  phone: optionalText,
  registration: optionalText,
  taxId: optionalText,
  bankDetails: optionalText.describe("Printed on invoices as payment details"),
  currency: z.string().length(3).optional().describe("ISO code, e.g. MYR"),
  taxRate: z.number().min(0).max(100).optional(),
  notes: optionalText.describe("Default notes for new documents"),
  isDefault: z.boolean().optional(),
});

const scheduleFields = {
  name: z.string().min(1).max(300).describe('e.g. "Acme monthly retainer"'),
  frequency: z.enum(FREQUENCIES).optional().describe("Default MONTHLY"),
  interval: z.number().int().min(1).max(36).optional().describe("Every N periods. Default 1"),
  dayOfMonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .nullable()
    .optional()
    .describe("Day the invoice is dated (29–31 clamp to month end). Default: the start date's day. Ignored for WEEKLY"),
  startDate: dateString.describe("First billing date"),
  endDate: dateString.nullable().optional().describe("Last date an invoice may be dated. Omit/null = no end date"),
  maxOccurrences: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .nullable()
    .optional()
    .describe("Total invoices in the series, e.g. 6 for a six-month project. Omit/null with no endDate = indefinite"),
  autoIssue: z.boolean().optional().describe("true (default): generated invoices are ISSUED; false: DRAFT"),
  dueInDays: z
    .number()
    .int()
    .min(0)
    .max(365)
    .nullable()
    .optional()
    .describe("Days after issue that each invoice is due. Default: from Net-N payment terms"),
  backfill: z
    .boolean()
    .optional()
    .describe("When startDate is in the past, also generate the missed past invoices. Default false: start from today"),
};

export const createRecurringSchema = documentFieldsSchema
  .omit({ type: true, status: true, issueDate: true, dueDate: true })
  .extend({ ...scheduleFields, items: z.array(lineItemSchema).min(1).max(200) })
  .describe(
    "Line item descriptions, project title/description and notes may use {{period}} (e.g. November 2026), {{month}}, {{year}}, {{date}}, {{n}} and {{of}}",
  );
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;

export const recurringFromDocumentSchema = z.object({
  documentId: z.string().min(1).describe("Invoice id or number to use as the template"),
  name: z.string().min(1).max(300).optional().describe("Default: project title or client name"),
  frequency: z.enum(FREQUENCIES).optional(),
  interval: z.number().int().min(1).max(36).optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  startDate: dateString
    .optional()
    .describe("First generated invoice's date. Default: the next slot after the template invoice's issue date"),
  endDate: dateString.nullable().optional(),
  maxOccurrences: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .nullable()
    .optional()
    .describe("Total invoices in the series INCLUDING the template invoice when it is counted as #1"),
  countTemplateAsFirst: z
    .boolean()
    .optional()
    .describe("Link the template invoice to the schedule as invoice #1 (default true)"),
  autoIssue: z.boolean().optional(),
  dueInDays: z.number().int().min(0).max(365).nullable().optional(),
});
export type RecurringFromDocumentInput = z.infer<typeof recurringFromDocumentSchema>;

export const updateRecurringSchema = createRecurringSchema
  .partial()
  .omit({ backfill: true })
  .extend({
    id: z.string().min(1),
    status: z
      .enum(RECURRING_STATUSES)
      .optional()
      .describe("PAUSED stops generation; ACTIVE resumes from the next date on/after today (missed dates are skipped); ENDED stops for good"),
  });
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;

export const recurringRefSchema = z.object({ id: z.string().min(1) });

export const listRecurringSchema = z.object({
  status: z.array(z.enum(RECURRING_STATUSES)).optional(),
});

export const deleteRecurringSchema = z.object({
  id: z.string().min(1),
  confirm: z.literal(true).describe("Must be true. Invoices already generated are kept"),
});

export const runRecurringSchema = z.object({
  id: z.string().optional().describe("Only this schedule. Omit for every due schedule"),
});

export const billingReportSchema = z.object({
  view: z
    .enum(["documents", "recurring"])
    .describe("documents: one row per invoice/quotation/DO; recurring: one row per schedule"),
  companies: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(50)
    .optional()
    .describe("Only these company profiles (names, case-insensitive). Omit for all"),
  issuedFrom: dateString.optional().describe("documents view: only documents issued on/after this date"),
  issuedTo: dateString.optional().describe("documents view: only documents issued on/before this date"),
});
export type BillingReportInput = z.infer<typeof billingReportSchema>;
