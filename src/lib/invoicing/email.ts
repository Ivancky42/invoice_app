/**
 * Emailing invoices through Resend (https://resend.com), PDF attached.
 *
 * Config: RESEND_API_KEY (env) + a company profile's `emailFrom` on a Resend-verified
 * domain. Replies go to the profile's `email`; `emailCc` is CC'd (default, overridable per
 * send) and `emailBcc` gets a hidden copy. Emailing a DRAFT issues it once the send succeeds.
 * Every attempt — including ones refused before reaching Resend — is an InvoiceEmail row.
 *
 * Auto-email: a schedule with `autoEmail` marks each ISSUED invoice it generates
 * `emailPending`; it is sent right after generation and retried on later daily runs.
 * Never twice: a retry only follows a failure Resend itself reported (so nothing was sent).
 * When the outcome is unknown (timeout, dropped connection, idempotency conflict) the attempt
 * is recorded "[unconfirmed]" and, once Resend's 24h idempotency window has passed, the
 * invoice is flagged for a human to check instead of being re-sent blind. The PDF renders
 * byte-identically, so a retry inside that window is deduplicated by Resend.
 */
import type { CompanyProfile } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DOC_LABELS, formatMoney, type LineItem } from "@/lib/types";
import {
  checkedAddresses,
  companyForDocument,
  findDocumentRow,
  InvoicingError,
  setDocumentStatus,
} from "@/lib/invoicing/documents";
import { parseAddressList } from "@/lib/invoicing/emailAddress";
import { renderDocumentPdf } from "@/lib/invoicing/pdfRender";
import { addDays, effectiveDueDate, formatDateOnly, todayInTimeZone } from "@/lib/invoicing/schedule";

export { parseAddressList };

const RESEND_URL = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 20_000;
/** Resend keeps idempotency keys 24h; an unconfirmed send is never retried after this. */
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
/** Auto-emails for invoices issued longer ago than this are dropped, not sent late. */
export const AUTO_EMAIL_MAX_AGE_DAYS = 7;
/** Give up on an auto-email after this many failed attempts. */
export const AUTO_EMAIL_MAX_ATTEMPTS = 5;
const UNCONFIRMED = "[unconfirmed] ";

export type EmailTrigger = "app" | "agent" | "recurring";

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** Can documents from this profile be emailed right now? (Used by pages and schedule saves.) */
export function canEmailFrom(company: Pick<CompanyProfile, "emailFrom"> | null | undefined): boolean {
  return Boolean(resendConfigured() && company?.emailFrom);
}

/**
 * A Resend failure. `delivered: "no"` — Resend answered with an error, nothing was sent, a retry
 * is safe. `"unknown"` — no usable answer (timeout, network, 409 idempotency conflict).
 */
export class ResendError extends Error {
  constructor(
    message: string,
    public readonly delivered: "no" | "unknown",
  ) {
    super(message);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const longDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);

export type ComposeInput = {
  type: string;
  status?: string;
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
  const paid = isInvoice && d.status === "PAID";
  const due = isInvoice && !paid ? effectiveDueDate(d) : null;
  const amount = formatMoney(d.total, d.currency);
  const subject = `${label} ${d.number} from ${d.companyName}${d.projectTitle ? ` – ${d.projectTitle}` : ""}`;
  const firstLine = d.items[0]?.description;

  const rows: [string, string][] = [
    [label, d.number],
    ["Date", longDate(d.issueDate)],
    ...(due ? ([["Due", longDate(due)]] as [string, string][]) : []),
    ["Amount", amount],
    ...(paid ? ([["Status", "Paid"]] as [string, string][]) : []),
    ...(firstLine ? ([["For", firstLine]] as [string, string][]) : []),
  ];

  const intro = paid
    ? `Here is a copy of invoice ${d.number} for ${amount}, which has been paid. Thank you!`
    : isInvoice
      ? `Please find attached invoice ${d.number} for ${amount}${due ? `, due ${longDate(due)}` : ""}.`
      : `Please find attached ${label.toLowerCase()} ${d.number} for ${amount}.`;
  const showPayment = isInvoice && !paid && Boolean(d.bankDetails);

  const text = [
    `Hi ${d.clientName},`,
    "",
    ...(d.message?.trim() ? [d.message.trim(), ""] : []),
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(showPayment ? ["", "Payment details:", d.bankDetails!] : []),
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
${showPayment ? `<p style="margin:0 0 4px;color:#6b7280;font-size:12px;text-transform:uppercase">Payment details</p>${p(escapeHtml(d.bankDetails!).replace(/\n/g, "<br>"))}` : ""}
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

/** POST to Resend. Returns the email id, or throws a ResendError saying whether it was delivered. */
export async function postToResend(
  payload: ResendPayload,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new ResendError("Email isn't configured: set RESEND_API_KEY in the app's environment", "no");
  let res: Response;
  try {
    res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch (e) {
    // Timed out or the connection dropped: Resend may or may not have sent it.
    throw new ResendError(`Resend didn't answer: ${e instanceof Error ? e.message : String(e)}`, "unknown");
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (res.ok && body.id) return body.id;
  const message = `Resend ${res.status}: ${body.message ?? body.name ?? "send failed"}`;
  // 409 = this idempotency key is in flight or was used with a different body: an earlier
  // attempt may have been sent. A 2xx without an id is equally unreadable.
  throw new ResendError(message, res.status === 409 || res.ok ? "unknown" : "no");
}

/**
 * Email one document to its client (or `to`), PDF attached. Every attempt is recorded,
 * including ones refused before reaching Resend. Manual sends get a fresh idempotency key
 * (a deliberate resend sends again); recurring sends pass a fixed per-invoice key.
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
  const attempt = {
    to: typeof opts.to === "string" ? opts.to : (opts.to ?? []).join(", ") || (doc.clientEmail ?? ""),
    cc: null as string | null,
    bcc: null as string | null,
    subject: `${DOC_LABELS[doc.type] ?? "Document"} ${doc.number}`,
  };
  const record = (status: "SENT" | "FAILED", extra: { providerId?: string; error?: string }) =>
    prisma.invoiceEmail.create({
      data: {
        documentId: doc.id,
        status,
        trigger: opts.trigger,
        to: attempt.to || "(none)",
        cc: attempt.cc,
        bcc: attempt.bcc,
        subject: attempt.subject,
        providerId: extra.providerId ?? null,
        error: extra.error?.slice(0, 1000) ?? null,
      },
    });

  let sent: { providerId: string; to: string[]; cc: string[]; bcc: string[]; subject: string };
  try {
    const company = await companyForDocument(doc);
    if (!company?.emailFrom) {
      throw new InvoicingError(
        "invalid",
        `${company?.name ?? "This company profile"} has no "Email from" address — set it in Settings (e.g. "${company?.name ?? "Company"} <billing@yourdomain>")`,
      );
    }
    if (doc.status === "CANCELLED") throw new InvoicingError("invalid", `${doc.number} is CANCELLED — it can't be emailed`);
    const to = checkedAddresses(opts.to ?? doc.clientEmail);
    if (to.length === 0) throw new InvoicingError("invalid", `${doc.number} has no client email — pass "to"`);
    // CC: what the caller passed (even "" = none), else the profile's default list. A copy
    // address that's already a recipient is dropped so nobody gets it twice.
    const lower = (xs: string[]) => new Set(xs.map((x) => (/<([^>]+)>/.exec(x)?.[1] ?? x).toLowerCase()));
    const toSet = lower(to);
    const cc = checkedAddresses(opts.cc !== undefined && opts.cc !== null ? opts.cc : company.emailCc).filter(
      (a) => !toSet.has((/<([^>]+)>/.exec(a)?.[1] ?? a).toLowerCase()),
    );
    const seen = lower([...to, ...cc]);
    const bcc = checkedAddresses(company.emailBcc).filter((a) => !seen.has((/<([^>]+)>/.exec(a)?.[1] ?? a).toLowerCase()));
    attempt.to = to.join(", ");
    attempt.cc = cc.length ? cc.join(", ") : null;
    attempt.bcc = bcc.length ? bcc.join(", ") : null;

    const { subject, html, text } = composeInvoiceEmail({
      type: doc.type,
      status: doc.status,
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
    attempt.subject = subject;

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
    sent = { providerId, to, cc, bcc, subject };
  } catch (e) {
    const unknown = e instanceof ResendError && e.delivered === "unknown";
    const error = e instanceof Error ? e.message : String(e);
    await record("FAILED", { error: unknown ? UNCONFIRMED + error : error });
    if (e instanceof InvoicingError) throw e;
    throw new InvoicingError(
      "invalid",
      unknown
        ? `Not sure the email went out (${error}). Check Resend before sending again.`
        : `Email not sent: ${error}`,
    );
  }

  // Resend accepted it: the email is out. Bookkeeping below must never turn that into a
  // reported failure (or a FAILED row a retry would act on), so each step is best-effort.
  const bestEffort = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[email] ${doc.number} was sent (${sent.providerId}) but ${what} failed`, e);
    }
  };
  await bestEffort("recording it", () => record("SENT", { providerId: sent.providerId }));
  if (doc.emailPending) {
    await bestEffort("clearing emailPending", () =>
      prisma.document.update({ where: { id: doc.id }, data: { emailPending: false } }),
    );
  }
  // Sending a draft issues it (due date from Net-N terms, as when issuing by hand).
  // Issued stays issued; paid stays paid.
  let status = doc.status;
  if (doc.status === "DRAFT") {
    await bestEffort("issuing the draft", async () => {
      await setDocumentStatus(doc.id, "ISSUED");
      status = "ISSUED";
    });
  }
  return { sent: true as const, number: doc.number, status, ...sent };
}

export type PendingEmailResult = {
  sent: { number: string; to: string[] }[];
  failed: { number: string; error: string }[];
  dropped: { number: string; reason: string }[];
};

/**
 * Send pending auto-emails (all, one schedule's, or only `documentIds`), skipping
 * `skipDocumentIds` (already tried this run). Gives up — clearing pending and flagging the
 * schedule — on invoices issued more than AUTO_EMAIL_MAX_AGE_DAYS ago, after
 * AUTO_EMAIL_MAX_ATTEMPTS failures, or when the last attempt's delivery is unconfirmed and
 * outside Resend's idempotency window (a retry could email the client twice).
 */
export async function sendPendingInvoiceEmails(
  opts: {
    documentIds?: string[];
    scheduleId?: string;
    skipDocumentIds?: string[];
    today?: Date;
    now?: Date;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<PendingEmailResult> {
  const today = opts.today ?? todayInTimeZone();
  const now = opts.now ?? new Date();
  const pending = await prisma.document.findMany({
    where: {
      emailPending: true,
      ...(opts.documentIds ? { id: { in: opts.documentIds } } : {}),
      ...(opts.skipDocumentIds?.length ? { NOT: { id: { in: opts.skipDocumentIds } } } : {}),
      ...(opts.scheduleId ? { recurringInvoiceId: opts.scheduleId } : {}),
    },
    include: {
      recurringInvoice: { select: { id: true, emailTo: true, autoEmail: true } },
      emails: { where: { trigger: "recurring", status: "FAILED" }, orderBy: { createdAt: "desc" } },
      _count: { select: { emails: { where: { trigger: "recurring", status: "SENT" } } } },
    },
    orderBy: { issueDate: "asc" },
  });
  const result: PendingEmailResult = { sent: [], failed: [], dropped: [] };

  for (const doc of pending) {
    if (doc._count.emails > 0) {
      // Already delivered (the flag just wasn't cleared): never send again.
      await prisma.document.update({ where: { id: doc.id }, data: { emailPending: false } });
      continue;
    }
    // Anchor on the FIRST attempt whose delivery is unknown: Resend's dedupe for this key runs
    // 24h from that request, however many retries (or later clean refusals) followed it.
    const firstUnconfirmed = doc.emails.filter((e) => e.error?.startsWith(UNCONFIRMED)).at(-1);
    const unconfirmedExpired =
      firstUnconfirmed !== undefined &&
      now.getTime() - firstUnconfirmed.createdAt.getTime() > IDEMPOTENCY_WINDOW_MS;
    const reason = !doc.recurringInvoice?.autoEmail
      ? "auto-email was switched off"
      : doc.status !== "ISSUED"
        ? `status is ${doc.status}`
        : doc.issueDate < addDays(today, -AUTO_EMAIL_MAX_AGE_DAYS)
          ? `issued ${formatDateOnly(doc.issueDate)}, more than ${AUTO_EMAIL_MAX_AGE_DAYS} days ago`
          : doc.emails.length >= AUTO_EMAIL_MAX_ATTEMPTS
            ? `${AUTO_EMAIL_MAX_ATTEMPTS} failed attempts`
            : unconfirmedExpired
              ? "the last attempt's delivery couldn't be confirmed — check Resend's log before sending it again"
              : null;
    if (reason) {
      await prisma.document.update({ where: { id: doc.id }, data: { emailPending: false } });
      if (doc.recurringInvoice?.autoEmail && doc.status === "ISSUED") {
        await prisma.recurringInvoice.update({
          where: { id: doc.recurringInvoice.id },
          data: { lastError: `${doc.number} was not emailed: ${reason}. Send it from the invoice page if needed.` },
        });
      }
      result.dropped.push({ number: doc.number, reason });
      continue;
    }
    try {
      const r = await sendInvoiceEmail(doc.id, {
        to: doc.recurringInvoice!.emailTo ?? null,
        trigger: "recurring",
        // One key per invoice: inside Resend's 24h window a repeat is deduplicated.
        idempotencyKey: `recurring-invoice/${doc.id}`,
        fetchImpl: opts.fetchImpl,
      });
      result.sent.push({ number: r.number, to: r.to });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.failed.push({ number: doc.number, error });
      await prisma.recurringInvoice.update({
        where: { id: doc.recurringInvoice!.id },
        data: { lastError: `Emailing ${doc.number} failed: ${error}`.slice(0, 1000) },
      });
    }
  }
  return result;
}

export function mergeEmailResults(...parts: (PendingEmailResult | undefined)[]): PendingEmailResult {
  const out: PendingEmailResult = { sent: [], failed: [], dropped: [] };
  for (const p of parts) {
    if (!p) continue;
    out.sent.push(...p.sent);
    out.failed.push(...p.failed);
    out.dropped.push(...p.dropped);
  }
  return out;
}
