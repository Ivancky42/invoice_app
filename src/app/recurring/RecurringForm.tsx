"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import AppSelect from "@/components/AppSelect";
import { calcTotals, formatMoney, PAYMENT_TERMS_PRESETS, type DiscountType, type LineItem } from "@/lib/types";
import {
  addDays,
  formatDateOnly,
  parseDateOnly,
  previewOccurrences,
  renderTemplate,
  todayInTimeZone,
  type Frequency,
} from "@/lib/invoicing/schedule";
import { saveRecurring } from "./actions";

type CompanyOption = { id: string; name: string; currency: string; taxRate: number; canEmail?: boolean };
type ClientOption = { id: string; name: string; address?: string | null; email?: string | null; phone?: string | null };

export type RecurringFormInitial = {
  id?: string;
  name: string;
  frequency: Frequency;
  interval: number;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  autoIssue: boolean;
  autoEmail: boolean;
  emailTo: string;
  dueInDays: number | null;
  companyId: string | null;
  clientId: string | null;
  clientName: string;
  clientAddress: string;
  clientEmail: string;
  clientPhone: string;
  shipToAttn: string;
  shipToAddress: string;
  poNumber: string;
  projectTitle: string;
  projectDescription: string;
  items: LineItem[];
  taxRate: number;
  discountType: DiscountType;
  discountValue: number;
  paymentTerms: string;
  notes: string;
  terms: string;
  occurrencesGenerated?: number;
  /** Edit mode: last date already billed; the preview starts after it. */
  lastRunDate?: string | null;
};

const FREQ_OPTIONS = [
  { value: "WEEKLY", label: "Week(s)" },
  { value: "MONTHLY", label: "Month(s)" },
  { value: "QUARTERLY", label: "Quarter(s)" },
  { value: "YEARLY", label: "Year(s)" },
];

type EndMode = "never" | "count" | "date";

export default function RecurringForm({
  mode,
  initial,
  companies,
  clients,
  linkDocument,
}: {
  mode: "create" | "edit";
  initial: RecurringFormInitial;
  companies: CompanyOption[];
  clients: ClientOption[];
  /** Invoice the new schedule starts from (counted as #1 when `link` is ticked). */
  linkDocument?: { id: string; number: string; issueDate: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(initial);
  const [endMode, setEndMode] = useState<EndMode>(
    initial.maxOccurrences != null ? "count" : initial.endDate ? "date" : "never",
  );
  const [linkAsFirst, setLinkAsFirst] = useState(Boolean(linkDocument));
  const set = <K extends keyof RecurringFormInitial>(k: K, v: RecurringFormInitial[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const currency = companies.find((c) => c.id === f.companyId)?.currency ?? "USD";
  const totals = calcTotals(f.items, f.taxRate, f.discountType, f.discountValue);
  const already = (initial.occurrencesGenerated ?? 0) + (linkAsFirst && mode === "create" ? 1 : 0);

  const preview = useMemo(() => {
    try {
      const shape = {
        frequency: f.frequency,
        interval: Math.max(1, f.interval || 1),
        dayOfMonth: f.frequency === "WEEKLY" ? null : f.dayOfMonth,
        startDate: parseDateOnly(f.startDate),
        endDate: endMode === "date" && f.endDate ? parseDateOnly(f.endDate) : null,
        maxOccurrences: endMode === "count" ? f.maxOccurrences : null,
      };
      const today = todayInTimeZone(new Date(), "Asia/Kuala_Lumpur");
      // A series continued from a linked invoice bills passed slots on save; otherwise
      // dates before today are skipped.
      const continuing = mode === "create" && Boolean(linkDocument) && linkAsFirst;
      const afterLast = initial.lastRunDate ? addDays(parseDateOnly(initial.lastRunDate), 1) : null;
      const from =
        mode === "edit" && afterLast
          ? afterLast > today
            ? afterLast
            : today
          : continuing || shape.startDate >= today
            ? shape.startDate
            : today;
      const dates = previewOccurrences(shape, from, already, 4);
      return dates.map((d, i) => ({
        date: formatDateOnly(d),
        line: f.items[0]
          ? renderTemplate(f.items[0].description, {
              frequency: shape.frequency,
              interval: shape.interval,
              date: d,
              n: already + i + 1,
              of: shape.maxOccurrences ?? null,
            })
          : "",
      }));
    } catch {
      return [];
    }
  }, [f, endMode, already, mode, linkDocument, linkAsFirst, initial.lastRunDate]);

  function selectClient(id: string) {
    const c = clients.find((x) => x.id === id);
    setF((prev) => ({
      ...prev,
      clientId: id || null,
      ...(c
        ? { clientName: c.name, clientAddress: c.address ?? "", clientEmail: c.email ?? "", clientPhone: c.phone ?? "" }
        : {}),
    }));
  }

  function updateItem(i: number, patch: Partial<LineItem>) {
    set("items", f.items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  function submit() {
    setError(null);
    if (endMode === "count" && !(Number(f.maxOccurrences) >= 1)) {
      setError("Enter how many invoices in total, or choose “Never”.");
      return;
    }
    if (endMode === "date" && !f.endDate) {
      setError("Pick an end date, or choose “Never”.");
      return;
    }
    if (!f.name.trim() || !f.clientName.trim()) {
      setError("Name and client name are required.");
      return;
    }
    start(async () => {
      const payload: Record<string, unknown> = {
        ...(f.id ? { id: f.id } : {}),
        ...(mode === "create" && linkDocument && linkAsFirst ? { linkDocumentId: linkDocument.id } : {}),
        name: f.name,
        frequency: f.frequency,
        interval: Math.max(1, Number(f.interval) || 1),
        dayOfMonth: f.frequency === "WEEKLY" ? null : f.dayOfMonth || null,
        startDate: f.startDate,
        endDate: endMode === "date" ? f.endDate || null : null,
        maxOccurrences: endMode === "count" ? Number(f.maxOccurrences) || null : null,
        autoIssue: f.autoIssue,
        autoEmail: f.autoEmail && f.autoIssue && Boolean(companies.find((c) => c.id === f.companyId)?.canEmail),
        emailTo: f.emailTo.trim() || null,
        dueInDays: f.dueInDays == null || Number.isNaN(f.dueInDays) ? null : f.dueInDays,
        ...(f.companyId ? { companyId: f.companyId } : {}),
        clientId: f.clientId || (mode === "edit" ? null : undefined),
        clientName: f.clientName,
        clientAddress: f.clientAddress,
        clientEmail: f.clientEmail,
        clientPhone: f.clientPhone,
        shipToAttn: f.shipToAttn,
        shipToAddress: f.shipToAddress,
        poNumber: f.poNumber,
        projectTitle: f.projectTitle,
        projectDescription: f.projectDescription,
        items: f.items.filter((i) => i.description.trim()),
        taxRate: Number(f.taxRate) || 0,
        discountType: f.discountType,
        discountValue: Number(f.discountValue) || 0,
        paymentTerms: f.paymentTerms,
        notes: f.notes,
        terms: f.terms,
      };
      if (payload.clientId === undefined) delete payload.clientId;
      const res = await saveRecurring(payload as Parameters<typeof saveRecurring>[0]);
      if (res.error && !res.id) {
        setError(res.error);
        return;
      }
      router.push(`/recurring/${res.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold">{mode === "create" ? "New recurring invoice" : `Edit “${initial.name}”`}</h1>
        <div className="flex gap-2">
          <button className="btn" onClick={() => router.back()} disabled={pending}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Save schedule"}</button>
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-red-700 bg-red-50 border-red-200">{error}</div>}

      <div className="card p-5 space-y-4">
        <h2 className="font-medium">Schedule</h2>
        {linkDocument && mode === "create" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={linkAsFirst} onChange={(e) => setLinkAsFirst(e.target.checked)} />
            Count {linkDocument.number} ({linkDocument.issueDate}) as invoice #1 of this series
          </label>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="label">Name *</label>
            <input className="input" placeholder="e.g. Acme monthly retainer" value={f.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <label className="label">Bill every</label>
            <div className="flex gap-2">
              <input type="number" min={1} className="input w-20!" value={f.interval} onChange={(e) => set("interval", parseInt(e.target.value) || 1)} />
              <AppSelect value={f.frequency} onValueChange={(v) => set("frequency", v as Frequency)} options={FREQ_OPTIONS} />
            </div>
          </div>
          {f.frequency !== "WEEKLY" && (
            <div>
              <label className="label">On day of month</label>
              <input
                type="number"
                min={1}
                max={31}
                className="input"
                placeholder="start date's day"
                value={f.dayOfMonth ?? ""}
                onChange={(e) => set("dayOfMonth", e.target.value ? Math.min(31, Math.max(1, parseInt(e.target.value))) : null)}
              />
              <p className="text-xs text-gray-500 mt-1">29–31 bill on the last day in shorter months.</p>
            </div>
          )}
          <div>
            <label className="label">{mode === "edit" ? "Anchor / start date" : "First invoice date"}</label>
            <input type="date" className="input" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <label className="label">Ends</label>
            <div className="flex flex-wrap gap-4 items-center text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={endMode === "never"} onChange={() => setEndMode("never")} /> Never (indefinite)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={endMode === "count"} onChange={() => setEndMode("count")} /> After
                <input
                  type="number"
                  min={1}
                  className="input w-20!"
                  value={f.maxOccurrences ?? ""}
                  onFocus={() => setEndMode("count")}
                  onChange={(e) => set("maxOccurrences", e.target.value ? parseInt(e.target.value) : null)}
                />
                invoices in total
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={endMode === "date"} onChange={() => setEndMode("date")} /> On
                <input type="date" className="input w-auto!" value={f.endDate ?? ""} onFocus={() => setEndMode("date")} onChange={(e) => set("endDate", e.target.value || null)} />
              </label>
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-sm mt-6">
              <input type="checkbox" checked={f.autoIssue} onChange={(e) => set("autoIssue", e.target.checked)} />
              Issue automatically (unticked: create as Draft for review)
            </label>
          </div>
          <div className="md:col-span-4 border-t pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.autoEmail && f.autoIssue && Boolean(companies.find((c) => c.id === f.companyId)?.canEmail)}
                disabled={!f.autoIssue || !companies.find((c) => c.id === f.companyId)?.canEmail}
                onChange={(e) => set("autoEmail", e.target.checked)}
              />
              Email each invoice to the client automatically (PDF attached, via Resend)
            </label>
            {!companies.find((c) => c.id === f.companyId)?.canEmail ? (
              <p className="text-xs text-gray-500 mt-1">
                Set “Email from” on this company profile in Settings (and RESEND_API_KEY on the server) to turn this on.
              </p>
            ) : !f.autoIssue ? (
              <p className="text-xs text-gray-500 mt-1">Only issued invoices are emailed; drafts wait for you.</p>
            ) : f.autoEmail ? (
              <div className="mt-2 max-w-md">
                <label className="label">Send to <span className="text-gray-400 font-normal">(comma-separated; blank = client email{f.clientEmail ? ` ${f.clientEmail}` : ""})</span></label>
                <input className="input" value={f.emailTo} onChange={(e) => set("emailTo", e.target.value)} />
              </div>
            ) : null}
          </div>
          <div>
            <label className="label">Due after (days)</label>
            <input
              type="number"
              min={0}
              className="input"
              placeholder="from payment terms"
              value={f.dueInDays ?? ""}
              onChange={(e) => set("dueInDays", e.target.value === "" ? null : parseInt(e.target.value))}
            />
          </div>
        </div>
        <div className="text-sm bg-gray-50 rounded-md p-3">
          <div className="text-gray-500 mb-1">
            Next invoices (generated ~06:00 Malaysia time on each date{already ? `; ${already} already in the series` : ""}
            {preview.some((p) => p.date < formatDateOnly(todayInTimeZone(new Date(), "Asia/Kuala_Lumpur")))
              ? "; dates already passed are billed as soon as you save"
              : ""}):
          </div>
          {preview.length === 0 ? (
            <div className="text-gray-500">No dates — check the start and end settings.</div>
          ) : (
            <ul className="space-y-0.5">
              {preview.map((p) => (
                <li key={p.date}>
                  <span className="font-medium">{p.date}</span>
                  {p.line && <span className="text-gray-500"> · {p.line}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-medium">Invoice template</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">From (company profile)</label>
            <AppSelect
              value={f.companyId ?? ""}
              onValueChange={(id) => {
                set("companyId", id || null);
                const c = companies.find((x) => x.id === id);
                if (c && mode === "create") set("taxRate", c.taxRate);
              }}
              options={companies.map((c) => ({ value: c.id, label: `${c.name} (${c.currency})` }))}
              placeholder="Default profile"
            />
          </div>
          <div>
            <label className="label">Client</label>
            <AppSelect
              value={f.clientId ?? ""}
              onValueChange={selectClient}
              options={[{ value: "", label: "Enter manually" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              placeholder="Enter manually"
            />
          </div>
          <div>
            <label className="label">Client name *</label>
            <input className="input" value={f.clientName} onChange={(e) => set("clientName", e.target.value)} />
          </div>
          <div>
            <label className="label">Client email</label>
            <input className="input" value={f.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Client address</label>
            <textarea className="input" rows={2} value={f.clientAddress} onChange={(e) => set("clientAddress", e.target.value)} />
          </div>
          <div>
            <label className="label">Ship to attn <span className="text-gray-400 font-normal">(optional)</span></label>
            <input className="input" value={f.shipToAttn} onChange={(e) => set("shipToAttn", e.target.value)} />
          </div>
          <div>
            <label className="label">Ship to address <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea className="input" rows={2} value={f.shipToAddress} onChange={(e) => set("shipToAddress", e.target.value)} />
          </div>
          <div>
            <label className="label">Project title</label>
            <input className="input" placeholder="e.g. Social media management — {{period}}" value={f.projectTitle} onChange={(e) => set("projectTitle", e.target.value)} />
          </div>
          <div>
            <label className="label">PO number</label>
            <input className="input" value={f.poNumber} onChange={(e) => set("poNumber", e.target.value)} />
          </div>
          <div>
            <label className="label">Payment terms</label>
            <input className="input" list="rec-terms" placeholder="e.g. Net 30" value={f.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
            <datalist id="rec-terms">{PAYMENT_TERMS_PRESETS.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="label">Line items</label>
            <button className="btn" onClick={() => set("items", [...f.items, { description: "", quantity: 1, unitPrice: 0 }])}>+ Add item</button>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Placeholders: <code>{"{{period}}"}</code> (e.g. November 2026), <code>{"{{month}}"}</code>, <code>{"{{year}}"}</code>,{" "}
            <code>{"{{n}}"}</code> / <code>{"{{of}}"}</code> (e.g. 2 of 6), <code>{"{{date}}"}</code>.
          </p>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {f.items.map((it, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2"><input className="input" placeholder="Monthly retainer — {{period}}" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} /></td>
                  <td className="py-1.5 pr-2 w-24"><input type="number" step="0.01" className="input" value={it.quantity} onChange={(e) => updateItem(i, { quantity: parseFloat(e.target.value) || 0 })} /></td>
                  <td className="py-1.5 pr-2 w-32"><input type="number" step="0.01" className="input" value={it.unitPrice} onChange={(e) => updateItem(i, { unitPrice: parseFloat(e.target.value) || 0 })} /></td>
                  <td className="py-1.5 w-28 text-right">{formatMoney(it.quantity * it.unitPrice, currency)}</td>
                  <td className="py-1.5 w-8 text-right"><button className="text-red-600" onClick={() => set("items", f.items.filter((_, j) => j !== i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end mt-3">
            <div className="w-full md:w-80 space-y-1.5 text-sm">
              <div className="flex justify-between items-center gap-2">
                <span className="text-gray-500">Discount</span>
                <div className="flex gap-1">
                  <input type="number" step="0.01" className="input w-24" value={f.discountValue} onChange={(e) => set("discountValue", parseFloat(e.target.value) || 0)} />
                  <AppSelect value={f.discountType} onValueChange={(v) => set("discountType", v as DiscountType)} options={[{ value: "PERCENT", label: "%" }, { value: "AMOUNT", label: currency }]} triggerClassName="w-20" />
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Tax rate (%)</span>
                <input type="number" step="0.01" className="input w-24" value={f.taxRate} onChange={(e) => set("taxRate", parseFloat(e.target.value) || 0)} />
              </div>
              <div className="flex justify-between font-semibold border-t pt-2"><span>Each invoice</span><span>{formatMoney(totals.total, currency)}</span></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div>
            <label className="label">Terms</label>
            <textarea className="input" rows={3} value={f.terms} onChange={(e) => set("terms", e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}
