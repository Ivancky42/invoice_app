import { describe, expect, it } from "vitest";
import { challengerLegitimacy, isLegitimateChallenger } from "@/lib/rules/challenger";

const ACTIVE = { id: 7, parentId: 5 };

describe("challengerLegitimacy", () => {
  it("a status-CANDIDATE target is the running experiment", () => {
    expect(challengerLegitimacy({ id: 9, status: "CANDIDATE" }, ACTIVE)).toEqual({
      ok: true,
      kind: "CANDIDATE",
    });
  });

  it("the immediately-deposed champion is legitimate (the revert series)", () => {
    // ACTIVE.parentId === 5: version 5 is the ruleset version 7 replaced.
    expect(challengerLegitimacy({ id: 5, status: "RETIRED" }, ACTIVE)).toEqual({
      ok: true,
      kind: "DEPOSED_CHAMPION",
    });
  });

  it("an older RETIRED version is NOT the deposed champion", () => {
    expect(challengerLegitimacy({ id: 3, status: "RETIRED" }, ACTIVE)).toEqual({
      ok: false,
      reason: "stale_retired",
      inconsistent: true,
    });
  });

  it("a KILLED target is an inconsistency", () => {
    expect(challengerLegitimacy({ id: 9, status: "KILLED" }, ACTIVE)).toEqual({
      ok: false,
      reason: "killed",
      inconsistent: true,
    });
  });

  it("the pointer parked on the incumbent is IDLE, not an error", () => {
    expect(challengerLegitimacy({ id: 7, status: "ACTIVE" }, ACTIVE)).toEqual({
      ok: false,
      reason: "is_active",
      inconsistent: false,
    });
  });

  it("idle wins over status: even a stale ACTIVE-status row on id === active.id is idle", () => {
    expect(challengerLegitimacy({ id: 7, status: "RETIRED" }, ACTIVE).ok).toBe(false);
    expect(
      challengerLegitimacy({ id: 7, status: "RETIRED" }, ACTIVE),
    ).toMatchObject({ reason: "is_active", inconsistent: false });
  });

  it("a missing pointer target or a missing incumbent is benign", () => {
    expect(challengerLegitimacy(null, ACTIVE)).toEqual({
      ok: false,
      reason: "missing",
      inconsistent: false,
    });
    expect(challengerLegitimacy({ id: 9, status: "CANDIDATE" }, null)).toEqual({
      ok: false,
      reason: "no_active",
      inconsistent: false,
    });
  });

  it("an ACTIVE-status row that is not the incumbent is an inconsistency", () => {
    expect(challengerLegitimacy({ id: 9, status: "ACTIVE" }, ACTIVE)).toEqual({
      ok: false,
      reason: "unexpected_status",
      inconsistent: true,
    });
  });

  it("a first-generation incumbent (parentId null) has no deposed champion", () => {
    const v1 = { id: 1, parentId: null };
    expect(challengerLegitimacy({ id: 2, status: "RETIRED" }, v1).ok).toBe(false);
    expect(challengerLegitimacy({ id: 2, status: "CANDIDATE" }, v1).ok).toBe(true);
  });

  it("isLegitimateChallenger agrees with the full verdict", () => {
    expect(isLegitimateChallenger({ id: 5, status: "RETIRED" }, ACTIVE)).toBe(true);
    expect(isLegitimateChallenger({ id: 3, status: "RETIRED" }, ACTIVE)).toBe(false);
  });
});
