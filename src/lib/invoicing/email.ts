/**
 * Emailing invoices through Resend (https://resend.com), PDF attached.
 *
 * Config: RESEND_API_KEY (env) + a company profile's `emailFrom` on a Resend-verified
 * domain. Replies go to the profile's `email`; `emailBcc` gets a copy of every send.
 * Every attempt is recorded as an InvoiceEmail row.
 *
 * Auto-email: a schedule with `autoEmail` marks each ISSUED invoice it generates
 * `emailPending`; `sendPendingInvoiceEmails` sends those (cron + right after generation),
 * retrying on the next run. Recurring sends use an idempotency key per invoice, so a retry
 * or an overlapping run can never email the same invoice twice.
 */
import { prisma } from "@/lib/prisma";
import { DOC_LABELS, formatMoney, type LineItem } from "@/lib/types";
import { InvoicingError, findDocumentRow } from "@/lib/invoicing/documents";
import { renderDocumentPdf } from "@/lib/invoicing/pdfRender";
import { addDays, effectiveDueDate, formatDateOnly, todayInTimeZone } from "@/lib/invoicing/schedule";

const RESEND_URL = "https://api.resend.com/emails";
/** Auto-emails for invoices issued longer ago than this are dropped, not sent late. */
export const AUTO_EMAIL_MAX_AGE_DAYS = 7;
/** Give up on an auto-email after this many failed attempts. */
export const AUTO_EMAIL_MAX_ATTEMPTS = 5;

export type EmailTrigger = "app" | "agent" | "recurring";

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** "a@x.com, b@y.com" → ["a@x.com", "b@y.com"]; drops blanks; validates shape. */
export function parseAddressList(raw: string | string[] | null | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : (raw ?? "").split(/[,;\n]/)).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    // Accept "Name <a@b.c>" or a bare address.
    const addr = /<([^>]+)>\s*$/.exec(p)?.[1] ?? p;
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addr)) {
      throw new InvoicingError("invalid", `Not an email address: "${p}"`);
    }
  }
  return parts;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const longDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);

export type ComposeInput = {
  type: string;
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  paymentTerms: string | null;
  clientName: string;
  projectTitle: string | null;
  items: LineItem[];
  total: number;
  currency: string;
  companyName: string;
  companyEmail: string | null;
  bankDetails: string | null;
  message?: string | null;
};

/** Subject + HTML + text for one document email. Pure, so it is unit-tested. */
export function composeInvoiceEmail(d: ComposeInput) {
  const label = DOC_LABELS[d.type] ?? "Document";
  const isInvoice = d.type === "INVOICE";
  const due = isInvoice ? effectiveDueDate(d) : null;
  const amount = formatMoney(d.total, d.currency);
  const subject = `${label} ${d.number} from ${d.companyName}${d.projectTitle ? ` – ${d.projectTitle}` : ""}`;
  const firstLine = d.items[0]?.description;

  const rows: [string, string][] = [
    [label, d.number],
    ["Date", longDate(d.issueDate)],
    ...(due ? ([["Due", longDate(due)]] as [string, string][]) : []),
    ["Amount", amount],
    ...(firstLine ? ([["For", firstLine]] as [string, string][]) : []),
  ];

  const intro = isInvoice
    ? `Please find attached invoice ${d.number} for ${amount}${due ? `, due ${longDate(due)}` : ""}.`
    : `Please find attached ${label.toLowerCase()} ${d.number} for ${amount}.`;

  const text = [
    `Hi ${d.clientName},`,
    "",
    ...(d.message?.trim() ? [d.message.trim(), ""] : []),
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(isInvoice && d.bankDetails ? ["", "Payment details:", d.bankDetails] : []),
    "",
    "Thank you,",
    d.companyName,
    ...(d.companyEmail ? [d.companyEmail] : []),
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;font-size:14px;line-height:1.5">
${p(`Hi ${escapeHtml(d.clientName)},`)}
${d.message?.trim() ? p(escapeHtml(d.message.trim()).replace(/\n/g, "<br>")) : ""}
${p(escapeHtml(intro))}
<table style="border-collapse:collapse;margin:8px 0 16px;width:100%">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:${k === "Amount" ? 600 : 400}">${escapeHtml(v)}</td></tr>`,
    )
    .join("")}</table>
${isInvoice && d.bankDetails ? `<p style="margin:0 0 4px;color:#6b7280;font-size:12px;text-transform:uppercase">Payment details</p>${p(escapeHtml(d.bankDetails).replace(/\n/g, "<br>"))}` : ""}
${p(`Thank you,<br>${escapeHtml(d.companyName)}${d.companyEmail ? `<br><a href="mailto:${escapeHtml(d.companyEmail)}" style="color:#111827">${escapeHtml(d.companyEmail)}</a>` : ""}`)}
</div></body></html>`;

  return { subject, html, text };
}

type ResendPayload = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; content: string }[];
};

/** POST to Resend. Returns the email id, or throws with Resend's own message. */
export async function postToResend(
  payload: ResendPayload,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new InvoicingError("invalid", "Email isn't configured: set RESEND_API_KEY in the app's environment");
  const res = await fetchImpl(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok || !body.id) {
    throw new Error(`Resend ${res.status}: ${body.message ?? body.name ?? "send failed"}`);
  }
  return body.id;
}

/**
 * Email one document to its client (or `to`), PDF attached. Records the attempt either way.
 * `idempotencyKey` defaults to a fresh one per call (a deliberate resend sends again);
 * recurring sends pass a fixed per-invoice key.
 */
export async function sendInvoiceEmail(
  idOrNumber: string,
  opts: {
    to?: string | string[] | null;
    cc?: string | string[] | null;
    message?: string | null;
    trigger: EmailTrigger;
    idempotencyKey?: string;
    fetchImpl?: typeof fetch;
  },
) {
  const row = await findDocumentRow(idOrNumber);
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: row.id }, include: { company: true } });
  const company =
    doc.company ??
    (await prisma.companyProfile.findFirst({ where: { isDefault: true } })) ??
    (await prisma.companyProfile.findFirst());
  if (!company?.emailFrom) {
    throw new InvoicingError(
      "invalid",
      `${company?.name ?? "This company profile"} has no "Email from" address — set it in Settings (e.g. "${company?.name ?? "Company"} <billing@yourdomain>")`,
    );
  }
  if (doc.status === "DRAFT") {
    throw new InvoicingError("invalid", `${doc.number} is a DRAFT — issue it before emailing it`);
  }
  const to = parseAddressList(opts.to ?? doc.clientEmail);
  if (to.length === 0) throw new InvoicingError("invalid", `${doc.number} has no client email — pass "to"`);
  const cc = parseAddressList(opts.cc ?? null);
  const bcc = parseAddressList(company.emailBcc);

  const { subject, html, text } = composeInvoiceEmail({
    type: doc.type,
    number: doc.number,
    issueDate: doc.issueDate,
    dueDate: doc.dueDate,
    paymentTerms: doc.paymentTerms,
    clientName: doc.clientName,
    projectTitle: doc.projectTitle,
    items: (doc.items as unknown as LineItem[]) ?? [],
    total: doc.total,
    currency: company.currency,
    companyName: company.name,
    companyEmail: company.email,
    bankDetails: company.bankDetails,
    message: opts.message,
  });

  const record = (status: "SENT" | "FAILED", extra: { providerId?: string; error?: string }) =>
    prisma.invoiceEmail.create({
      data: {
        documentId: doc.id,
        status,
        trigger: opts.trigger,
        to: to.join(", "),
        cc: cc.length ? cc.join(", ") : null,
        bcc: bcc.length ? bcc.join(", ") : null,
        subject,
        providerId: extra.providerId ?? null,
        error: extra.error?.slice(0, 1000) ?? null,
      },
    });

  try {
    const rendered = await renderDocumentPdf(doc.id);
    if (!rendered) throw new InvoicingError("not_found", `No document "${idOrNumber}"`);
    const providerId = await postToResend(
      {
        from: company.emailFrom,
        to,
        ...(cc.length ? { cc } : {}),
        ...(bcc.length ? { bcc } : {}),
        ...(company.email ? { reply_to: [company.email] } : {}),
        subject,
        html,
        text,
        attachments: [{ filename: `${doc.number}.pdf`, content: rendered.pdf.toString("base64") }],
      },
      opts.idempotencyKey ?? `invoice/${doc.id}/${crypto.randomUUID()}`,
      opts.fetchImpl,
    );
    await record("SENT", { providerId });
    if (doc.emailPending) await prisma.document.update({ where: { id: doc.id }, data: { emailPending: false } });
    return { sent: true as const, number: doc.number, to, cc, bcc, subject, providerId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await record("FAILED", { error });
    throw e instanceof InvoicingError ? e : new InvoicingError("invalid", `Email not sent: ${error}`);
  }
}

/**
 * Send every auto-email still pending (optionally only these documents). Invoices issued more
 * than AUTO_EMAIL_MAX_AGE_DAYS ago, or that failed AUTO_EMAIL_MAX_ATTEMPTS times, are given up
 * on (pending cleared, schedule.lastError set) so nothing is ever emailed long after the fact.
 */
export async function sendPendingInvoiceEmails(
  opts: { documentIds?: string[]; today?: Date; fetchImpl?: typeof fetch } = {},
) {
  const today = opts.today ?? todayInTimeZone();
  const pending = await prisma.document.findMany({
    where: { emailPending: true, ...(opts.documentIds ? { id: { in: opts.documentIds } } : {}) },
    include: {
      recurringInvoice: { select: { id: true, emailTo: true, autoEmail: true } },
      _count: { select: { emails: { where: { status: "FAILED", trigger: "recurring" } } } },
    },
    orderBy: { issueDate: "asc" },
  });
  const sent: { number: string; to: string[] }[] = [];
  const failed: { number: string; error: string }[] = [];
  const dropped: { number: string; reason: string }[] = [];

  for (const doc of pending) {
    const tooOld = doc.issueDate < addDays(today, -AUTO_EMAIL_MAX_AGE_DAYS);
    const tooManyTries = doc._count.emails >= AUTO_EMAIL_MAX_ATTEMPTS;
    const switchedOff = !doc.recurringInvoice?.autoEmail;
    if (tooOld || tooManyTries || switchedOff || doc.status !== "ISSUED") {
      const reason = switchedOff
        ? "auto-email was switched off"
        : doc.status !== "ISSUED"
          ? `status is ${doc.status}`
          : tooOld
            ? `issued ${formatDateOnly(doc.issueDate)}, more than ${AUTO_EMAIL_MAX_AGE_DAYS} days ago`
            : `${AUTO_EMAIL_MAX_ATTEMPTS} failed attempts`;
      await prisma.document.update({ where: { id: doc.id }, data: { emailPending: false } });
      if (doc.recurringInvoice && !switchedOff && doc.status === "ISSUED") {
        await prisma.recurringInvoice.update({
          where: { id: doc.recurringInvoice.id },
          data: { lastError: `${doc.number} was not emailed: ${reason}. Send it from the invoice page.` },
        });
      }
      dropped.push({ number: doc.number, reason });
      continue;
    }
    try {
      const r = await sendInvoiceEmail(doc.id, {
        to: doc.recurringInvoice?.emailTo ?? null,
        trigger: "recurring",
        // One key per invoice: a retry after a timeout can't send it twice.
        idempotencyKey: `recurring-invoice/${doc.id}`,
        fetchImpl: opts.fetchImpl,
      });
      sent.push({ number: r.number, to: r.to });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failed.push({ number: doc.number, error });
      if (doc.recurringInvoice) {
        await prisma.recurringInvoice.update({
          where: { id: doc.recurringInvoice.id },
          data: { lastError: `Emailing ${doc.number} failed (will retry): ${error}`.slice(0, 1000) },
        });
      }
    }
  }
  return { sent, failed, dropped };
}

export async function listInvoiceEmails(documentId: string) {
  const rows = await prisma.invoiceEmail.findMany({ where: { documentId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    status: r.status,
    trigger: r.trigger,
    to: r.to,
    cc: r.cc,
    bcc: r.bcc,
    subject: r.subject,
    error: r.error,
    at: r.createdAt.toISOString(),
  }));
}
