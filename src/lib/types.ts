export type LineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export const DOC_LABELS: Record<string, string> = {
  QUOTATION: "Quotation",
  INVOICE: "Invoice",
  DELIVERY_ORDER: "Delivery Order",
};

export const DOC_PREFIX: Record<string, string> = {
  QUOTATION: "QUO",
  INVOICE: "INV",
  DELIVERY_ORDER: "DO",
};

export const NEXT_STAGE: Record<string, string | null> = {
  QUOTATION: "INVOICE",
  INVOICE: "DELIVERY_ORDER",
  DELIVERY_ORDER: null,
};

/** Every document status, in the order pickers show them. */
export const DOCUMENT_STATUSES = ["DRAFT", "ISSUED", "ACCEPTED", "DECLINED", "PAID", "CANCELLED"] as const;
export type DocumentStatusValue = (typeof DOCUMENT_STATUSES)[number];

/** A quotation's outcome: the client said yes (ACCEPTED) or no (DECLINED). Not for invoices or DOs. */
export const QUOTATION_ONLY_STATUSES: readonly string[] = ["ACCEPTED", "DECLINED"];

/** The statuses a document of this type can have. */
export function statusesForType(type: string): DocumentStatusValue[] {
  return DOCUMENT_STATUSES.filter((s) => type === "QUOTATION" || !QUOTATION_ONLY_STATUSES.includes(s));
}

/** Why this status can't go on this type of document, or null when it can. */
export function statusTypeError(type: string, status: string): string | null {
  if (type !== "QUOTATION" && QUOTATION_ONLY_STATUSES.includes(status)) {
    const label = DOC_LABELS[type]?.toLowerCase() ?? type;
    return `${status} is for quotations only (this is ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label})`;
  }
  return null;
}

export type DiscountType = "PERCENT" | "AMOUNT";

export function calcTotals(
  items: LineItem[],
  taxRate: number,
  discountType: DiscountType = "PERCENT",
  discountValue = 0,
) {
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const dv = Number(discountValue) || 0;
  const rawDiscount = discountType === "PERCENT" ? subtotal * (dv / 100) : dv;
  const discountAmount = Math.min(Math.max(rawDiscount, 0), subtotal);
  const taxable = subtotal - discountAmount;
  const taxAmount = taxable * (Number(taxRate) || 0) / 100;
  const total = taxable + taxAmount;
  return { subtotal, discountAmount, taxAmount, total };
}

export const PAYMENT_TERMS_PRESETS = [
  "Due on receipt",
  "Net 7",
  "Net 14",
  "Net 30",
  "Net 60",
  "Net 90",
  "50% upfront, 50% on delivery",
];

export function formatMoney(n: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n || 0);
  } catch {
    return `${currency} ${(n || 0).toFixed(2)}`;
  }
}
