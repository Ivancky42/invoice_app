/**
 * Which RuleVersion each branch was running at a point in time — pure, for
 * `repair-rule-version-attribution.ts`.
 *
 * LIVE runs the ACTIVE version: the one whose [activatedAt, retiredAt) covers `t`.
 * CANDIDATE runs an experimental version (lane set — gap-fix / human rows carry none)
 * while one is in flight over [createdAt, retiredAt); otherwise the idle challenger book
 * resolves to ACTIVE, same as `getRuleSet("CANDIDATE")` does.
 *
 * Deposed-champion revert series (a RETIRED version back on the CANDIDATE book after a
 * PROMOTE) are NOT modelled — callers must refuse to run once any PROMOTE event exists.
 */
export type TimelineVersion = {
  id: number;
  lane: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  retiredAt: Date | null;
};

function covers(start: Date, end: Date | null, t: Date): boolean {
  return start.getTime() <= t.getTime() && (end === null || t.getTime() < end.getTime());
}

export function activeVersionAt(versions: TimelineVersion[], t: Date): number | null {
  const hit = versions
    .filter((v) => v.activatedAt !== null && covers(v.activatedAt, v.retiredAt, t))
    .sort((a, b) => b.activatedAt!.getTime() - a.activatedAt!.getTime())[0];
  return hit?.id ?? null;
}

export function branchVersionAt(
  versions: TimelineVersion[],
  branch: "LIVE" | "CANDIDATE",
  t: Date,
): number | null {
  if (branch === "CANDIDATE") {
    const challenger = versions
      .filter((v) => v.lane !== null && covers(v.createdAt, v.retiredAt, t))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (challenger) return challenger.id;
  }
  return activeVersionAt(versions, t);
}
