import { describe, expect, it } from "vitest";
import { signPdfPath, verifyPdfLink } from "@/lib/invoicing/pdfLink";

const secret = "test-secret-at-least-16";

async function parts(id: string, nowMs = 1_800_000_000_000) {
  const signed = await signPdfPath(id, { secret, nowMs, ttlSec: 3600 });
  const url = new URL(signed!.path, "http://x");
  return { exp: url.searchParams.get("exp"), sig: url.searchParams.get("sig"), url };
}

describe("signed PDF links", () => {
  it("verifies its own signature before expiry", async () => {
    const { exp, sig } = await parts("doc1");
    expect(await verifyPdfLink("doc1", exp, sig, { secret, nowMs: 1_800_000_000_000 })).toBe(true);
  });

  it("rejects another document, a tampered expiry, expiry, and a wrong secret", async () => {
    const { exp, sig } = await parts("doc1");
    const now = 1_800_000_000_000;
    expect(await verifyPdfLink("doc2", exp, sig, { secret, nowMs: now })).toBe(false);
    expect(await verifyPdfLink("doc1", String(Number(exp) + 999), sig, { secret, nowMs: now })).toBe(false);
    expect(await verifyPdfLink("doc1", exp, sig, { secret, nowMs: now + 3601_000 })).toBe(false);
    expect(await verifyPdfLink("doc1", exp, sig, { secret: "another-secret-123456", nowMs: now })).toBe(false);
    expect(await verifyPdfLink("doc1", null, sig, { secret, nowMs: now })).toBe(false);
  });

  it("returns null without a usable secret", async () => {
    expect(await signPdfPath("doc1", { secret: "short" })).toBeNull();
  });
});
