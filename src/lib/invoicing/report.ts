/**
 * Compact, flat billing rows for dashboards and analysis (the `get_billing_report` MCP
 * tool). Business rules — effective due date, days overdue, amount per recurring invoice —
 * are computed here, once, so a dashboard never re-implements them in SQL.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { calcTotals, type DiscountType, type LineItem } from "@/lib/types";
import type { BillingReportInput } from "@/lib/invoicing/inputs";
import { daysBetween, effectiveDueDate, formatDateOnly, todayInTimeZone } from "@/lib/invoicing/schedule";

/** Hard cap per call; `cut: true` says the rows stop short. */
export const MAX_REPORT_ROWS = 5000;

const money = (n: number) => Math.round(n * 100) / 100;

function companyFilter(companies: string[] | undefined) {
  const names = (companies ?? []).map((c) => c.trim()).filter(Boolean);
  if (names.length === 0) return undefined;
  return { OR: names.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) };
}

export async function billingReport(input: BillingReportInput, now: Date = new Date()) {
  const today = todayInTimeZone(now);
  const company = companyFilter(input.companies);

  if (input.view === "recurring") {
    const rows = await prisma.recurringInvoice.findMany({
      where: company ? { company } : undefined,
      include: { company: { select: { name: true, currency: true } } },
      orderBy: [{ status: "asc" }, { nextRunDate: "asc" }, { name: "asc" }],
      take: MAX_REPORT_ROWS + 1,
    });
    return {
      view: input.view,
      as_of: formatDateOnly(today),
      cut: rows.length > MAX_REPORT_ROWS,
      rows: rows.slice(0, MAX_REPORT_ROWS).map((r) => {
        const items = (r.items as unknown as LineItem[]) ?? [];
        const t = calcTotals(items, r.taxRate, (r.discountType as DiscountType) ?? "PERCENT", r.discountValue);
        return {
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
          per_invoice: money(t.total),
        };
      }),
    };
  }

  const where: Prisma.DocumentWhereInput = company ? { company } : {};
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
      const due = d.type === "INVOICE" ? effectiveDueDate(d) : null;
      return {
        id: d.id,
        number: d.number,
        company: d.company?.name ?? null,
        currency: d.company?.currency ?? "USD",
        type: d.type,
        status: d.status,
        issue_date: formatDateOnly(d.issueDate),
        due_date: due ? formatDateOnly(due) : null,
        days_overdue: due && d.status === "ISSUED" ? Math.max(0, daysBetween(due, today)) : null,
        client: d.clientName,
        project: d.projectTitle,
        total: money(d.total),
        recurring: d.recurringInvoiceId != null,
      };
    }),
  };
}
