"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LineItem, calcTotals, formatMoney, DOC_LABELS, DiscountType, PAYMENT_TERMS_PRESETS } from "@/lib/types";

type CompanyOption = { id: string; name: string; currency: string; taxRate: number };

type Props = {
  mode: "create" | "edit";
  initial: {
    id?: string;
    type: string;
    number?: string;
    status?: string;
    issueDate?: string;
    dueDate?: string | null;
    companyId?: string | null;
    clientName?: string;
    clientAddress?: string;
    clientEmail?: string;
    clientPhone?: string;
    shipToAttn?: string;
    shipToAddress?: string;
    poNumber?: string;
    projectTitle?: string;
    projectDescription?: string;
    items: LineItem[];
    taxRate: number;
    discountType?: DiscountType;
    discountValue?: number;
    paymentTerms?: string;
    notes?: string;
    terms?: string;
  };
  companies: CompanyOption[];
  saveAction: (data: any) => Promise<{ id: string }>;
};

export default function DocumentForm({ mode, initial, companies, saveAction }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [type, setType] = useState(initial.type);
  const [companyId, setCompanyId] = useState<string>(initial.companyId ?? companies[0]?.id ?? "");
  const currentCompany = companies.find((c) => c.id === companyId);
  const currency = currentCompany?.currency || "USD";
  const [items, setItems] = useState<LineItem[]>(
    initial.items.length ? initial.items : [{ description: "", quantity: 1, unitPrice: 0 }]
  );
  const [taxRate, setTaxRate] = useState<number>(initial.taxRate);
  const [discountType, setDiscountType] = useState<DiscountType>(initial.discountType ?? "PERCENT");
  const [discountValue, setDiscountValue] = useState<number>(initial.discountValue ?? 0);
  const [form, setForm] = useState({
    status: initial.status ?? "DRAFT",
    issueDate: initial.issueDate ?? new Date().toISOString().slice(0, 10),
    dueDate: initial.dueDate ?? "",
    clientName: initial.clientName ?? "",
    clientAddress: initial.clientAddress ?? "",
    clientEmail: initial.clientEmail ?? "",
    clientPhone: initial.clientPhone ?? "",
    shipToAttn: initial.shipToAttn ?? "",
    shipToAddress: initial.shipToAddress ?? "",
    poNumber: initial.poNumber ?? "",
    projectTitle: initial.projectTitle ?? "",
    projectDescription: initial.projectDescription ?? "",
    paymentTerms: initial.paymentTerms ?? "",
    notes: initial.notes ?? "",
    terms: initial.terms ?? "",
  });

  const totals = calcTotals(items, taxRate, discountType, discountValue);

  function updateItem(idx: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function addItem() {
    setItems((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0 }]);
  }

  function submit() {
    start(async () => {
      const res = await saveAction({
        id: initial.id,
        type,
        companyId: companyId || null,
        ...form,
        items,
        taxRate: Number(taxRate) || 0,
        discountType,
        discountValue: Number(discountValue) || 0,
      });
      router.push(`/documents/${res.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {mode === "create" ? "New" : "Edit"} {DOC_LABELS[type]}
        </h1>
        <div className="flex gap-2">
          <button className="btn" onClick={() => router.back()} disabled={pending}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="label">From (company profile) *</label>
            {companies.length === 0 ? (
              <div className="text-sm text-red-600">No profiles. Create one in <a href="/settings/new" className="underline">Settings</a>.</div>
            ) : (
              <select
                className="input"
                value={companyId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCompanyId(id);
                  const c = companies.find((x) => x.id === id);
                  if (c && mode === "create") setTaxRate(c.taxRate);
                }}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="QUOTATION">Quotation</option>
              <option value="INVOICE">Invoice</option>
              <option value="DELIVERY_ORDER">Delivery Order</option>
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option>DRAFT</option><option>ISSUED</option><option>PAID</option><option>CANCELLED</option>
            </select>
          </div>
          <div>
            <label className="label">Issue date</label>
            <input type="date" className="input" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
          </div>
          <div>
            <label className="label">Due date</label>
            <input type="date" className="input" value={form.dueDate ?? ""} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Payment terms</label>
            <input
              className="input"
              list="payment-terms-presets"
              placeholder="e.g. Net 30"
              value={form.paymentTerms}
              onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
            />
            <datalist id="payment-terms-presets">
              {PAYMENT_TERMS_PRESETS.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
          <div className="md:col-span-2">
            <label className="label">Project title <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              className="input"
              placeholder="e.g. Website redesign — phase 2"
              value={form.projectTitle}
              onChange={(e) => setForm({ ...form, projectTitle: e.target.value })}
            />
          </div>
          <div className="md:col-span-4">
            <label className="label">Project description <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              className="input"
              rows={3}
              placeholder="Scope, deliverables, or other project context"
              value={form.projectDescription}
              onChange={(e) => setForm({ ...form, projectDescription: e.target.value })}
            />
          </div>
          {(type === "INVOICE" || type === "DELIVERY_ORDER") && (
            <div className="md:col-span-2">
              <label className="label">PO number <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                className="input"
                placeholder="Customer purchase order reference"
                value={form.poNumber}
                onChange={(e) => setForm({ ...form, poNumber: e.target.value })}
              />
            </div>
          )}
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-medium">Bill to</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Client name *</label>
            <input className="input" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Address</label>
            <textarea className="input" rows={3} value={form.clientAddress} onChange={(e) => setForm({ ...form, clientAddress: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-medium">Ship to <span className="text-gray-400 font-normal text-sm">(optional)</span></h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Attn</label>
            <input
              className="input"
              placeholder="Contact or department"
              value={form.shipToAttn}
              onChange={(e) => setForm({ ...form, shipToAttn: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label">Address</label>
            <textarea
              className="input"
              rows={3}
              placeholder="Delivery address"
              value={form.shipToAddress}
              onChange={(e) => setForm({ ...form, shipToAddress: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Line items</h2>
          <button className="btn" onClick={addItem}>+ Add item</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-2">Description</th>
                <th className="py-2 w-24">Qty</th>
                <th className="py-2 w-32">Unit price</th>
                <th className="py-2 w-32 text-right">Amount</th>
                <th className="py-2 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="py-2 pr-2"><input className="input" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} /></td>
                  <td className="py-2 pr-2"><input type="number" step="0.01" className="input" value={it.quantity} onChange={(e) => updateItem(i, { quantity: parseFloat(e.target.value) || 0 })} /></td>
                  <td className="py-2 pr-2"><input type="number" step="0.01" className="input" value={it.unitPrice} onChange={(e) => updateItem(i, { unitPrice: parseFloat(e.target.value) || 0 })} /></td>
                  <td className="py-2 text-right">{formatMoney((it.quantity || 0) * (it.unitPrice || 0), currency)}</td>
                  <td className="py-2 text-right"><button className="text-red-600 text-sm" onClick={() => removeItem(i)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <div className="w-full md:w-96 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatMoney(totals.subtotal, currency)}</span></div>
            <div className="flex justify-between items-center gap-2">
              <span className="text-gray-500">Discount</span>
              <div className="flex gap-1">
                <input type="number" step="0.01" className="input w-24" value={discountValue} onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)} />
                <select className="input w-20" value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)}>
                  <option value="PERCENT">%</option>
                  <option value="AMOUNT">{currency}</option>
                </select>
              </div>
            </div>
            {totals.discountAmount > 0 && (
              <div className="flex justify-between text-gray-500"><span>Discount applied</span><span>− {formatMoney(totals.discountAmount, currency)}</span></div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Tax rate (%)</span>
              <input type="number" step="0.01" className="input w-24" value={taxRate} onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="flex justify-between"><span className="text-gray-500">Tax</span><span>{formatMoney(totals.taxAmount, currency)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-2"><span>Total</span><span>{formatMoney(totals.total, currency)}</span></div>
          </div>
        </div>
      </div>

      <div className="card p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div>
          <label className="label">Terms</label>
          <textarea className="input" rows={3} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
