import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { displayContact, pdfAmount, pdfDate, pdfQty, renderDocPDF } from "./pdf";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

const company = {
  name: "Grumpy Pixels",
  address: "",
  email: "hello@grumpypixels.my",
  phone: "https://grumpypixels.my/",
  registration: null,
  taxId: null,
  bankDetails: "Bank: AMBANK\r\nAccount: 8881053001229",
  logoPath: null,
  currency: "MYR",
};

const invoice = {
  type: "INVOICE",
  status: "ISSUED",
  number: "INV-2026-0018",
  issueDate: day("2026-11-01"),
  dueDate: day("2026-12-01"),
  clientName: "Person Edge Sdn. Bhd.",
  clientAddress: "Plaza Damas\r\nKuala Lumpur",
  clientEmail: "ben@personedge.com",
  clientPhone: null,
  shipToAttn: null,
  shipToAddress: null,
  poNumber: null,
  projectTitle: "SEO retainer",
  projectDescription: null,
  items: [{ description: "Monthly Retainer (Month 2 of 6)", quantity: 1, unitPrice: 2000 }],
  subtotal: 2000,
  discountType: "PERCENT",
  discountValue: 0,
  discountAmount: 0,
  taxRate: 0,
  taxAmount: 0,
  total: 2000,
  paymentTerms: "Net 30",
  notes: null,
  terms: null,
};

function hasPdftotext(): boolean {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function text(pdf: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pdf-test-"));
  const file = path.join(dir, "doc.pdf");
  writeFileSync(file, pdf);
  return execFileSync("pdftotext", ["-layout", file, "-"]).toString();
}

describe("pdf formatting helpers", () => {
  test("dates print day-first and unambiguously, on the stored calendar day", () => {
    expect(pdfDate(day("2026-11-01"))).toBe("1 November 2026");
    expect(pdfDate(day("2026-12-31"))).toBe("31 December 2026");
  });

  test("amounts and quantities", () => {
    expect(pdfAmount(2000)).toBe("2,000.00");
    expect(pdfAmount(0.5)).toBe("0.50");
    expect(pdfQty(1)).toBe("1");
    expect(pdfQty(2.5)).toBe("2.5");
  });

  test("website contacts drop the protocol", () => {
    expect(displayContact("https://grumpypixels.my/")).toBe("grumpypixels.my");
    expect(displayContact("03-6206 3320")).toBe("03-6206 3320");
  });
});

describe("renderDocPDF", () => {
  test("is byte-for-byte deterministic (email retries resend the same attachment)", async () => {
    const a = await renderDocPDF(invoice, company);
    const b = await renderDocPDF(invoice, company);
    expect(a.subarray(0, 5).toString()).toBe("%PDF-");
    expect(a.equals(b)).toBe(true);
  });

  test.runIf(hasPdftotext())("prints the key facts, the footer and page numbers", async () => {
    const out = text(await renderDocPDF(invoice, company));
    expect(out).toContain("INVOICE");
    expect(out).toContain("1 November 2026");
    expect(out).toContain("1 December 2026");
    expect(out).not.toContain("11/1/2026");
    expect(out).toContain("MYR 2,000.00");
    expect(out).toContain("Please quote INV-2026-0018 as the payment reference.");
    expect(out).toContain("grumpypixels.my");
    expect(out).not.toContain("https://");
    expect(out).toContain("Page 1 of 1");
    expect(out).not.toMatch(/Tax \(0%\)/);
  });

  test.runIf(hasPdftotext())("long documents paginate with numbered pages", async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ description: `Item ${i + 1}`, quantity: 1, unitPrice: 10 }));
    const out = text(await renderDocPDF({ ...invoice, items, subtotal: 600, total: 600 }, company));
    expect(out).toMatch(/Page 1 of [2-9]/);
    expect(out).toContain("Item 60");
  });

  test.runIf(hasPdftotext())("paid invoices are marked and don't ask for payment", async () => {
    const out = text(await renderDocPDF({ ...invoice, status: "PAID" }, company));
    expect(out).toMatch(/P\s*A\s*I\s*D/); // letter-spaced badge
    expect(out).toContain("Total paid");
    expect(out).not.toContain("payment reference");
  });

  test.runIf(hasPdftotext())("delivery orders have no prices and a receipt signature block", async () => {
    const out = text(await renderDocPDF({ ...invoice, type: "DELIVERY_ORDER", number: "DO-2026-0003" }, company));
    expect(out).toContain("DELIVERY ORDER");
    expect(out).not.toContain("2,000.00");
    expect(out).toContain("Received in good order and condition");
  });
});
