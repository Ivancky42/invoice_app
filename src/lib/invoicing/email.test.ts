import { afterEach, describe, expect, it, vi } from "vitest";
import { composeInvoiceEmail, parseAddressList, postToResend } from "@/lib/invoicing/email";

const base = {
  type: "INVOICE",
  number: "INV-2026-0018",
  issueDate: new Date("2026-11-01T00:00:00Z"),
  dueDate: new Date("2026-12-01T00:00:00Z"),
  paymentTerms: "Net 30",
  clientName: "Person Edge Sdn. Bhd.",
  projectTitle: "Monthly SEO Campaign Management – ATC College",
  items: [{ description: "Monthly Retainer (Month 2 of 6)", quantity: 1, unitPrice: 2000 }],
  total: 2000,
  currency: "MYR",
  companyName: "Grumpy Pixels",
  companyEmail: "hello@grumpypixels.my",
  bankDetails: "Bank: AmBank\nAccount: 123",
};

describe("composeInvoiceEmail", () => {
  it("builds subject, summary and payment details", () => {
    const e = composeInvoiceEmail(base);
    expect(e.subject).toBe("Invoice INV-2026-0018 from Grumpy Pixels – Monthly SEO Campaign Management – ATC College");
    expect(e.text).toContain("Hi Person Edge Sdn. Bhd.,");
    expect(e.text).toContain("Due: 1 December 2026");
    expect(e.text).toMatch(/Amount: MYR\s?2,000\.00/);
    expect(e.text).toContain("Payment details:\nBank: AmBank");
    expect(e.html).toContain("Bank: AmBank<br>Account: 123");
  });

  it("ends with a small system-generated note pointing replies at the company email", () => {
    const e = composeInvoiceEmail(base);
    expect(e.text).toMatch(/--\nThis is a system-generated email from Grumpy Pixels\. If you have any questions, reply to this email or write to [^\s]+@[^\s]+\.$/);
    expect(e.html).toContain("font-size:11px");
    expect(e.html).toContain("This is a system-generated email from Grumpy Pixels.");
  });

  it("escapes client-controlled text in the HTML", () => {
    const e = composeInvoiceEmail({ ...base, clientName: '<img src=x onerror="x">', message: "Hi & <b>thanks</b>" });
    expect(e.html).not.toContain("<img");
    expect(e.html).toContain("&lt;img src=x onerror=&quot;x&quot;&gt;");
    expect(e.html).toContain("Hi &amp; &lt;b&gt;thanks&lt;/b&gt;");
  });

  it("a paid invoice reads as a copy for their records, without due date or bank details", () => {
    const e = composeInvoiceEmail({ ...base, status: "PAID" });
    expect(e.text).toContain("which has been paid");
    expect(e.text).not.toContain("Due:");
    expect(e.text).not.toContain("Payment details");
  });

  it("quotations have no due date or payment block", () => {
    const e = composeInvoiceEmail({ ...base, type: "QUOTATION", number: "QUO-2026-0002" });
    expect(e.subject.startsWith("Quotation QUO-2026-0002")).toBe(true);
    expect(e.text).not.toContain("Due:");
    expect(e.text).not.toContain("Payment details");
  });
});

describe("parseAddressList", () => {
  it("splits and validates", () => {
    expect(parseAddressList("a@x.com, b@y.co ;c@z.my")).toEqual(["a@x.com", "b@y.co", "c@z.my"]);
    expect(parseAddressList("Grumpy Pixels <billing@grumpypixels.my>")).toEqual(["Grumpy Pixels <billing@grumpypixels.my>"]);
    expect(parseAddressList(null)).toEqual([]);
    expect(() => parseAddressList("not-an-email")).toThrow(/Not an email/);
  });
});

describe("postToResend", () => {
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  const payload = { from: "A <a@x.com>", to: ["b@y.com"], subject: "s", html: "h", text: "t", attachments: [] };

  it("refuses without an API key", async () => {
    await expect(postToResend(payload, "k")).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("sends auth + idempotency headers and returns the id", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    expect(await postToResend(payload, "recurring-invoice/doc1", fetchImpl as unknown as typeof fetch)).toBe("em_1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("recurring-invoice/doc1");
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ["b@y.com"], subject: "s" });
  });

  it("marks timeouts and 409s as unknown delivery, other errors as not delivered", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const timeout = vi.fn(async () => {
      throw new Error("aborted");
    });
    await expect(postToResend(payload, "k", timeout as unknown as typeof fetch)).rejects.toMatchObject({ delivered: "unknown" });
    const conflict = vi.fn(async () => new Response(JSON.stringify({ message: "idempotency" }), { status: 409 }));
    await expect(postToResend(payload, "k", conflict as unknown as typeof fetch)).rejects.toMatchObject({ delivered: "unknown" });
    const refused = vi.fn(async () => new Response(JSON.stringify({ message: "bad" }), { status: 422 }));
    await expect(postToResend(payload, "k", refused as unknown as typeof fetch)).rejects.toMatchObject({ delivered: "no" });
  });

  it("surfaces Resend's error message", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ name: "validation_error", message: "domain not verified" }), { status: 403 }));
    await expect(postToResend(payload, "k", fetchImpl as unknown as typeof fetch)).rejects.toThrow("Resend 403: domain not verified");
  });
});
