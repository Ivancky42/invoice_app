import { describe, expect, it } from "vitest";
import { RULE_FILE_NAMES } from "@/lib/rules/resolve";
import {
  buildPublishedActivePayload,
  buildRebasedCandidateClone,
  decidePublish,
  earlyKillPublishDetail,
  publishGapfixDetail,
} from "@/lib/rules/publish";

function corpus(partial: Partial<Record<(typeof RULE_FILE_NAMES)[number], string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of RULE_FILE_NAMES) out[name] = partial[name] ?? `# ${name}\n`;
  return out;
}

const ACTIVE = corpus({
  "_shared.md": [
    "## 2. Write contract",
    "old write",
    "",
    "## 11. Decision Review",
    "candidate territory",
    "",
    "## 16. Ledger",
    "old ledger",
    "",
  ].join("\n"),
});

const DISK = corpus({
  "_shared.md": [
    "## 2. Write contract",
    "new write for Ivan",
    "",
    "## 11. Decision Review",
    "candidate territory",
    "",
    "## 16. Ledger",
    "Run check one-liner",
    "",
  ].join("\n"),
});

const CANDIDATE = corpus({
  "_shared.md": [
    "## 2. Write contract",
    "old write",
    "",
    "## 11. Decision Review",
    "v6 decision review wording",
    "",
    "## 16. Ledger",
    "old ledger",
    "",
  ].join("\n"),
});

describe("decidePublish", () => {
  it("is a noop when disk matches ACTIVE", () => {
    expect(
      decidePublish({
        diskFiles: ACTIVE,
        activeFiles: ACTIVE,
        candidateChangedPaths: ["prompts:_shared#11"],
      }),
    ).toEqual({ action: "noop" });
  });

  it("aborts when the publish touches a section the candidate also rewrote", () => {
    const overlappingDisk = corpus({
      "_shared.md": [
        "## 2. Write contract",
        "old write",
        "",
        "## 11. Decision Review",
        "human also edited 11",
        "",
        "## 16. Ledger",
        "old ledger",
        "",
      ].join("\n"),
    });
    const decision = decidePublish({
      diskFiles: overlappingDisk,
      activeFiles: ACTIVE,
      candidateChangedPaths: ["prompts:_shared#11"],
    });
    expect(decision.action).toBe("abort");
    if (decision.action !== "abort") return;
    expect(decision.reason).toBe("conflict");
    expect(decision.publishChangedPaths).toContain("prompts:_shared#11");
    expect(decision.candidateChangedPaths).toContain("prompts:_shared#11");
  });

  it("proceeds with rebase when the candidate's sections are disjoint", () => {
    const decision = decidePublish({
      diskFiles: DISK,
      activeFiles: ACTIVE,
      candidateChangedPaths: ["prompts:_shared#11"],
    });
    expect(decision).toMatchObject({
      action: "proceed",
      rebase: true,
    });
    if (decision.action !== "proceed") return;
    expect(decision.publishChangedPaths).toEqual(["prompts:_shared#16", "prompts:_shared#2"]);
    expect(decision.changedFiles).toEqual(["_shared.md"]);
    expect(decision.diffLineCount).toBeGreaterThan(0);
  });
});

describe("buildRebasedCandidateClone", () => {
  it("sets parentId to the new ACTIVE and keeps the candidate's §11 hunk", () => {
    const clone = buildRebasedCandidateClone({
      newActiveId: 7,
      newActiveFiles: DISK,
      candidateFiles: CANDIDATE,
      candidateChangedPaths: ["prompts:_shared#11"],
      changeSummary: "Tighten decision-review wording",
    });
    expect(clone.parentId).toBe(7);
    expect(clone.changeSummary).toBe(
      "Tighten decision-review wording (rebased onto v7)",
    );
    expect(clone.files["_shared.md"]).toContain("v6 decision review wording");
    expect(clone.files["_shared.md"]).toContain("new write for Ivan");
    expect(clone.files["_shared.md"]).toContain("Run check one-liner");
    expect(clone.changedPaths).toEqual(["prompts:_shared#11"]);
  });
});

describe("buildPublishedActivePayload", () => {
  it("stamps HUMAN / ACTIVE with parentId and disk files", () => {
    const payload = buildPublishedActivePayload({
      parentId: 5,
      files: DISK,
      changeSummary: "Human edit: plain-language output format",
      changedPaths: ["prompts:_shared#2", "prompts:_shared#16"],
    });
    expect(payload).toMatchObject({
      status: "ACTIVE",
      actor: "HUMAN",
      parentId: 5,
      lane: null,
      direction: "NEUTRAL",
      changeSummary: "Human edit: plain-language output format",
    });
    expect(payload.files).toBe(DISK);
    expect(payload.fileShas["_shared.md"]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("publish event details", () => {
  it("EARLY_KILL detail matches the gap-fix rebase shape (human)", () => {
    expect(
      earlyKillPublishDetail({
        publishChangedPaths: ["prompts:_shared#2"],
        candidateChangedPaths: ["prompts:_shared#11"],
        newActiveId: 7,
        newCandidateId: 8,
      }),
    ).toEqual({
      reason: "rebased",
      publishChangedPaths: ["prompts:_shared#2"],
      candidateChangedPaths: ["prompts:_shared#11"],
      newActiveId: 7,
      newCandidateId: 8,
      human: true,
    });
  });

  it("GAPFIX detail is rebased when a candidate clone exists, none otherwise", () => {
    expect(
      publishGapfixDetail({
        fromVersionId: 5,
        toVersionId: 7,
        rebasedCandidate: { from: 6, to: 8 },
      }),
    ).toEqual({
      human: true,
      fromVersionId: 5,
      toVersionId: 7,
      rebasedCandidate: { from: 6, to: 8 },
      candidateAction: "rebased",
    });
    expect(
      publishGapfixDetail({
        fromVersionId: 5,
        toVersionId: 7,
        rebasedCandidate: null,
      }),
    ).toMatchObject({ candidateAction: "none", rebasedCandidate: null });
  });
});
