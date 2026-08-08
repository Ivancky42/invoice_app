import { describe, expect, it } from "vitest";
import { checkEvidence, type CheckEvidenceInput, type EvidenceInputItem } from "@/lib/evidence/rules";

const NOW = new Date("2026-08-08T00:00:00.000Z");
const LIMITS = { evidenceRecencyDays: 30, evidenceStaleDays: 90 };

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

function item(overrides: Partial<EvidenceInputItem> = {}): EvidenceInputItem {
  return {
    tier: "T1",
    kind: "FILING",
    observedAt: daysAgo(1),
    ...overrides,
  };
}

function baseInput(overrides: Partial<CheckEvidenceInput> = {}): CheckEvidenceInput {
  return {
    decisionType: "HOLD",
    thesisState: null,
    priorThesisState: null,
    moveClass: null,
    evidence: [],
    now: NOW,
    limits: LIMITS,
    enforcement: "warn",
    ...overrides,
  };
}

describe("checkEvidence", () => {
  it("HOLD with no evidence is clean", () => {
    const result = checkEvidence(baseInput());
    expect(result.warnings).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("exposure decision with only T3 evidence fails T12_REQUIRED_FOR_ACTION", () => {
    const result = checkEvidence(
      baseInput({
        decisionType: "BUY",
        evidence: [item({ tier: "T3", kind: "SOCIAL_SENTIMENT" })],
      }),
    );
    expect(result.warnings).toContain("T12_REQUIRED_FOR_ACTION");
  });

  it("thesis change without a T1 item fails T1_REQUIRED_FOR_THESIS_CHANGE", () => {
    const result = checkEvidence(
      baseInput({
        thesisState: "WEAKENING",
        priorThesisState: "INTACT",
        evidence: [item({ tier: "T2", kind: "NEWS_REPORT" })],
      }),
    );
    expect(result.warnings).toContain("T1_REQUIRED_FOR_THESIS_CHANGE");
  });

  it("T4-only evidence fails T4_NEVER_SUFFICIENT", () => {
    const result = checkEvidence(
      baseInput({
        decisionType: "BUY",
        evidence: [item({ tier: "T4", kind: "OTHER" })],
      }),
    );
    expect(result.warnings).toContain("T4_NEVER_SUFFICIENT");
    // Also fails the exposure requirement — T4 cannot satisfy it either.
    expect(result.warnings).toContain("T12_REQUIRED_FOR_ACTION");
  });

  it("HOLD citing a single T4 context item requires nothing and stays clean", () => {
    const result = checkEvidence(
      baseInput({
        decisionType: "HOLD",
        evidence: [item({ tier: "T4", kind: "OTHER" })],
      }),
    );
    expect(result.warnings).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("price-action-only support emits PRICE_NOT_EVIDENCE alongside the failed requirement", () => {
    const offConvention = checkEvidence(
      baseInput({
        decisionType: "BUY",
        evidence: [item({ tier: "T1", kind: "PRICE_ACTION" })],
      }),
    );
    expect(offConvention.warnings).toContain("T12_REQUIRED_FOR_ACTION");
    expect(offConvention.warnings).toContain("PRICE_NOT_EVIDENCE");

    // Conventional tier for PRICE_ACTION is T4 — the common case must emit the same
    // specific code, not just the generic tier failure.
    const conventional = checkEvidence(
      baseInput({
        decisionType: "BUY",
        evidence: [item({ tier: "T4", kind: "PRICE_ACTION" })],
      }),
    );
    expect(conventional.warnings).toContain("T12_REQUIRED_FOR_ACTION");
    expect(conventional.warnings).toContain("PRICE_NOT_EVIDENCE");
  });

  it("inference-only support emits INFERENCE_NOT_EVIDENCE alongside the failed requirement", () => {
    const offConvention = checkEvidence(
      baseInput({
        decisionType: "BUY",
        evidence: [item({ tier: "T2", kind: "INFERENCE" })],
      }),
    );
    expect(offConvention.warnings).toContain("T12_REQUIRED_FOR_ACTION");
    expect(offConvention.warnings).toContain("INFERENCE_NOT_EVIDENCE");

    // Conventional tier for INFERENCE is T4 — same specific code expected.
    const conventional = checkEvidence(
      baseInput({
        decisionType: "BUY",
        evidence: [item({ tier: "T4", kind: "INFERENCE" })],
      }),
    );
    expect(conventional.warnings).toContain("T12_REQUIRED_FOR_ACTION");
    expect(conventional.warnings).toContain("INFERENCE_NOT_EVIDENCE");
  });

  it("evidence older than evidenceStaleDays satisfies nothing (requirement still fails)", () => {
    const result = checkEvidence(
      baseInput({
        decisionType: "BUY",
        evidence: [item({ tier: "T1", kind: "FILING", observedAt: daysAgo(120) })],
      }),
    );
    expect(result.warnings).toContain("T12_REQUIRED_FOR_ACTION");
    expect(result.warnings).not.toContain("STALE_EVIDENCE");
  });

  it("evidence within the recency→stale window satisfies but warns STALE_EVIDENCE", () => {
    const result = checkEvidence(
      baseInput({
        decisionType: "BUY",
        evidence: [item({ tier: "T1", kind: "FILING", observedAt: daysAgo(60) })],
      }),
    );
    expect(result.warnings).not.toContain("T12_REQUIRED_FOR_ACTION");
    expect(result.warnings).toContain("STALE_EVIDENCE");
  });

  it("MARKET_MOVE thesis change with a fresh T1 item does NOT block on move class", () => {
    const result = checkEvidence(
      baseInput({
        thesisState: "BROKEN",
        priorThesisState: "INTACT",
        moveClass: "MARKET_MOVE",
        evidence: [item({ tier: "T1", kind: "FILING", observedAt: daysAgo(1) })],
      }),
    );
    // The T1 item satisfies T1_REQUIRED_FOR_THESIS_CHANGE (fresh, within recency window)
    // and, being inside the recency window, plausibly post-dates the move — so the
    // move-class block does not fire either.
    expect(result.warnings).not.toContain("T1_REQUIRED_FOR_THESIS_CHANGE");
    expect(result.warnings).not.toContain("MOVE_CLASS_BLOCKS_THESIS_CHANGE");
  });

  it("MARKET_MOVE thesis change with only an OLD (pre-recency-window) T1 item blocks", () => {
    const result = checkEvidence(
      baseInput({
        thesisState: "BROKEN",
        priorThesisState: "INTACT",
        moveClass: "MARKET_MOVE",
        evidence: [item({ tier: "T1", kind: "FILING", observedAt: daysAgo(45) })],
      }),
    );
    expect(result.warnings).toContain("MOVE_CLASS_BLOCKS_THESIS_CHANGE");

    // ...and in strict mode it is a hard failure, not just feedback.
    const strict = checkEvidence(
      baseInput({
        thesisState: "BROKEN",
        priorThesisState: "INTACT",
        moveClass: "MARKET_MOVE",
        evidence: [item({ tier: "T1", kind: "FILING", observedAt: daysAgo(45) })],
        enforcement: "strict",
      }),
    );
    expect(strict.failures).toContain("MOVE_CLASS_BLOCKS_THESIS_CHANGE");
  });

  it("MARKET_MOVE thesis change with only a stale T1 item still blocks on move class", () => {
    const result = checkEvidence(
      baseInput({
        thesisState: "BROKEN",
        priorThesisState: "INTACT",
        moveClass: "MARKET_MOVE",
        evidence: [item({ tier: "T1", kind: "FILING", observedAt: daysAgo(60) })],
      }),
    );
    expect(result.warnings).toContain("MOVE_CLASS_BLOCKS_THESIS_CHANGE");
  });

  it("warn mode routes every code to warnings, never failures", () => {
    const result = checkEvidence(
      baseInput({
        decisionType: "BUY",
        thesisState: "BROKEN",
        priorThesisState: "INTACT",
        moveClass: "MARKET_MOVE",
        evidence: [],
        enforcement: "warn",
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("strict mode routes hard codes to failures and keeps STALE_EVIDENCE a warning", () => {
    const hard = checkEvidence(
      baseInput({
        decisionType: "BUY",
        evidence: [item({ tier: "T3", kind: "SOCIAL_SENTIMENT" })],
        enforcement: "strict",
      }),
    );
    expect(hard.failures).toContain("T12_REQUIRED_FOR_ACTION");
    expect(hard.warnings).not.toContain("T12_REQUIRED_FOR_ACTION");

    const stale = checkEvidence(
      baseInput({
        decisionType: "BUY",
        evidence: [item({ tier: "T1", kind: "FILING", observedAt: daysAgo(60) })],
        enforcement: "strict",
      }),
    );
    expect(stale.failures).toEqual([]);
    expect(stale.warnings).toContain("STALE_EVIDENCE");
  });
});
