/**
 * Compact, flat billing rows for dashboards and analysis (the `get_billing_report` MCP
 * tool). The business rules — effective due date, days overdue, amount per recurring
 * invoice — come from the same helpers the app's lists and summary use (`dueInfo`,
 * `scheduleAmount`), so a dashboard never re-implements them and can't disagree.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { dueInfo, money } from "@/lib/invoicing/documents";
import type { BillingReportInput } from "@/lib/invoicing/inputs";
import { findSchedules, scheduleAmount } from "@/lib/invoicing/recurring";
import { UNCONFIRMED_EMAIL as UNCONFIRMED } from "@/lib/invoicing/emailAddress";
import { addDays, daysBetween, formatDateOnly, parseDateOnly, todayInTimeZone } from "@/lib/invoicing/schedule";

/** Hard cap per call; `cut: true` says the rows stop short (narrow with issuedFrom/issuedTo). */
export const MAX_REPORT_ROWS = 5000;

function companyFilter(companies: string[] | undefined): Prisma.CompanyProfileWhereInput | undefined {
  // The schema rejects blank names, so a given list is never silently widened to "all".
  if (!companies?.length) return undefined;
  return { OR: companies.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) };
}

export async function billingReport(input: BillingReportInput, now: Date = new Date()) {
  const today = todayInTimeZone(now);
  const company = companyFilter(input.companies);

  if (input.view === "recurring") {
    const rows = await findSchedules(company ? { company } : undefined, MAX_REPORT_ROWS + 1);
    return {
      view: input.view,
      as_of: formatDateOnly(today),
      cut: rows.length > MAX_REPORT_ROWS,
      rows: rows.slice(0, MAX_REPORT_ROWS).map((r) => ({
        id: r.id,
        name: r.name,
        company: r.company?.name ?? null,
        currency: r.company?.currency ?? "USD",
        client: r.clientName,
        status: r.status,
        frequency: r.frequency,
        every: r.interval,
        day_of_month: r.dayOfMonth,
        next_run: r.nextRunDate ? formatDateOnly(r.nextRunDate) : null,
        last_run: r.lastRunDate ? formatDateOnly(r.lastRunDate) : null,
        generated: r.occurrencesGenerated,
        max_invoices: r.maxOccurrences,
        end_date: r.endDate ? formatDateOnly(r.endDate) : null,
        auto_issue: r.autoIssue,
        per_invoice: scheduleAmount(r),
      })),
    };
  }

  const where: Prisma.DocumentWhereInput = company ? { company } : {};
  if (input.issuedFrom || input.issuedTo) {
    where.issueDate = {
      ...(input.issuedFrom ? { gte: parseDateOnly(input.issuedFrom) } : {}),
      ...(input.issuedTo ? { lt: addDays(parseDateOnly(input.issuedTo), 1) } : {}),
    };
  }
  const rows = await prisma.document.findMany({
    where,
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      issueDate: true,
      dueDate: true,
      paymentTerms: true,
      clientName: true,
      projectTitle: true,
      total: true,
      recurringInvoiceId: true,
      paidAt: true,
      emailPending: true,
      emails: { select: { status: true, error: true, createdAt: true }, orderBy: { createdAt: "desc" } },
      company: { select: { name: true, currency: true } },
    },
    orderBy: [{ issueDate: "desc" }, { number: "desc" }],
    take: MAX_REPORT_ROWS + 1,
  });
  return {
    view: input.view,
    as_of: formatDateOnly(today),
    cut: rows.length > MAX_REPORT_ROWS,
    rows: rows.slice(0, MAX_REPORT_ROWS).map((d) => {
      const { due, daysOverdue } = dueInfo(d, today);
      return {
        id: d.id,
        number: d.number,
        company: d.company?.name ?? null,
        currency: d.company?.currency ?? "USD",
        type: d.type,
        status: d.status,
        issue_date: formatDateOnly(d.issueDate),
        due_date: due ? formatDateOnly(due) : null,
        days_overdue: daysOverdue,
        client: d.clientName,
        project: d.projectTitle,
        total: money(d.total),
        recurring: d.recurringInvoiceId != null,
        paid_date: d.status === "PAID" && d.paidAt ? formatDateOnly(d.paidAt) : null,
        days_to_pay: d.status === "PAID" && d.paidAt ? daysBetween(d.issueDate, d.paidAt) : null,
        ...emailState(d),
      };
    }),
  };
}

/**
 * Where a document's email stands, from its latest attempt: SENT, FAILED, UNCONFIRMED (a send
 * whose outcome Resend didn't confirm), PENDING (an auto-email waiting for the next run) or null
 * (never emailed). `emailed_at` is the last successful send, in the billing time zone.
 */
export function emailState(d: {
  emailPending: boolean;
  emails: { status: "SENT" | "FAILED"; error: string | null; createdAt: Date }[];
}): { email_status: string | null; emailed_at: string | null; email_error: string | null } {
  const latest = d.emails[0];
  const lastSent = d.emails.find((e) => e.status === "SENT");
  const status = !latest
    ? d.emailPending
      ? "PENDING"
      : null
    : latest.status === "SENT"
      ? "SENT"
      : latest.error?.startsWith(UNCONFIRMED)
        ? "UNCONFIRMED"
        : "FAILED";
  return {
    email_status: status,
    emailed_at: lastSent ? formatDateOnly(todayInTimeZone(lastSent.createdAt)) : null,
    email_error: latest && latest.status === "FAILED" ? (latest.error ?? "").slice(0, 200) || null : null,
  };
}
