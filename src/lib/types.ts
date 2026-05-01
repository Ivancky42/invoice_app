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
