/**
 * The COMPLETE registry of the ruleset's numeric rails, and the JSON-pointer plumbing for
 * it. PURE — no prisma, no Config.
 *
 * EVERY numeric leaf in {@link LimitsConfig} must have an entry here. A limits pointer with
 * no entry is REFUSED at propose time (`unknown_limits_path`), because an unregistered
 * pointer used to sail past hardRange, the drift rails and the loosening bar and land
 * straight in Config.LIMITS on promotion — e.g. `/tierBands/TEST_STARTER/0 = 0.9` would
 * neuter logTrade's band check on the real book. `parameters.test.ts` asserts completeness
 * against DEFAULT_LIMITS so a new limits key cannot silently reopen that hole.
 *
 * `hardRange` is an absolute wall applied by {@link driftGuard} before any relative drift
 * rail, and `looseningDirection` says which way of moving the number takes MORE risk (so
 * the loosening ratchet and the extra evidence bar know which is which).
 *
 * `lane` is the FAST-lane whitelist: a proposal takes the FAST lane (a 10-session promotion
 * horizon) only when it changes nothing but numbers whose entries are lane FAST. Anything
 * touching a SLOW-lane number — or any prose — takes the full evidence horizon.
 *
 * Ranges are deliberately narrower than "whatever validates" — they are the outer bound of
 * what the system may ever walk to WITHOUT a human commit.
 */
import type { LimitsConfig } from "@/lib/stocks/config";

export type LimitsParam = {
  /** JSON pointer into RuleVersion.limits, e.g. "/tierBands/CONVICTION/1". */
  path: string;
  hardRange: [number, number];
  /** Which direction of movement loosens the rail (takes more risk). */
  looseningDirection: "UP" | "DOWN";
  lane: "FAST" | "SLOW";
};

/** Back-compat alias: the FAST entries are the same shape as every other entry. */
export type FastLaneParam = LimitsParam;

export const LIMITS_PARAMS: readonly LimitsParam[] = [
  // --- FAST lane: sizing / cadence rails the shadow book can settle in ~10 sessions ---
  { path: "/singlePositionPct", hardRange: [0.05, 0.25], looseningDirection: "UP", lane: "FAST" },
  { path: "/cashFloorPct", hardRange: [0.0, 0.2], looseningDirection: "DOWN", lane: "FAST" },
  { path: "/maxAverageDowns", hardRange: [0, 4], looseningDirection: "UP", lane: "FAST" },
  {
    path: "/breadthMarketThreshold",
    hardRange: [0.35, 0.7],
    looseningDirection: "DOWN",
    lane: "FAST",
  },
  { path: "/themePct", hardRange: [0.15, 0.5], looseningDirection: "UP", lane: "FAST" },
  { path: "/speculativeSleevePct", hardRange: [0.05, 0.3], looseningDirection: "UP", lane: "FAST" },
  { path: "/stopDistancePct", hardRange: [0.05, 0.3], looseningDirection: "UP", lane: "FAST" },
  { path: "/earningsBlackoutDays", hardRange: [0, 15], looseningDirection: "DOWN", lane: "FAST" },
  { path: "/evidenceRecencyDays", hardRange: [7, 90], looseningDirection: "UP", lane: "FAST" },
  { path: "/evidenceStaleDays", hardRange: [30, 365], looseningDirection: "UP", lane: "FAST" },
  // Tier band TOPS (index 1) are FAST; the FLOORS below are not.
  {
    path: "/tierBands/TEST_STARTER/1",
    hardRange: [0.01, 0.05],
    looseningDirection: "UP",
    lane: "FAST",
  },
  {
    path: "/tierBands/CONFIRMATION/1",
    hardRange: [0.03, 0.1],
    looseningDirection: "UP",
    lane: "FAST",
  },
  {
    path: "/tierBands/CONVICTION/1",
    hardRange: [0.04, 0.15],
    looseningDirection: "UP",
    lane: "FAST",
  },

  // --- SLOW lane: prose-adjacent rails. Registered so they are RANGE-CHECKED, not so they
  //     can move quickly. Each floor's ceiling sits strictly below its own band's top
  //     ceiling, so raising a floor can never invert the band it belongs to.
  //     Raising a MINIMUM position size forces bigger positions → UP loosens.
  { path: "/tierBands/TEST_STARTER/0", hardRange: [0, 0.04], looseningDirection: "UP", lane: "SLOW" },
  { path: "/tierBands/CONFIRMATION/0", hardRange: [0, 0.08], looseningDirection: "UP", lane: "SLOW" },
  { path: "/tierBands/CONVICTION/0", hardRange: [0, 0.12], looseningDirection: "UP", lane: "SLOW" },
  // A wider entry zone accepts entries further from the planned level → UP loosens.
  { path: "/entryZoneWidthPct", hardRange: [0.01, 0.15], looseningDirection: "UP", lane: "SLOW" },
  // A LOWER breadth bar lets a theme qualify on thinner participation → DOWN loosens.
  {
    path: "/themeBreadthThreshold",
    hardRange: [0.35, 0.8],
    looseningDirection: "DOWN",
    lane: "SLOW",
  },
  // A LOWER excess-move bar calls more moves stock-specific (rather than market/theme
  // driven), which admits more single-name conviction → DOWN loosens.
  {
    path: "/excessMoveIdiosyncratic",
    hardRange: [0.03, 0.3],
    looseningDirection: "DOWN",
    lane: "SLOW",
  },
];

const BY_PATH = new Map(LIMITS_PARAMS.map((p) => [p.path, p]));

/** Kept as an export for callers/UI that render the fast-lane whitelist. */
export const FAST_LANE_PARAMS: readonly FastLaneParam[] = LIMITS_PARAMS.filter(
  (p) => p.lane === "FAST",
);

/** Registry entry for a pointer, or undefined when the pointer is not a known rail. */
export function limitsParam(path: string): LimitsParam | undefined {
  return BY_PATH.get(path);
}

export function isKnownLimitsPath(path: string): boolean {
  return BY_PATH.has(path);
}

export function fastLaneParam(path: string): FastLaneParam | undefined {
  const param = BY_PATH.get(path);
  return param?.lane === "FAST" ? param : undefined;
}

export function isFastLaneParam(path: string): boolean {
  return BY_PATH.get(path)?.lane === "FAST";
}

/** RFC-6901-ish token decode (only ~1 and ~0 matter for our keys). */
function decodeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function splitPointer(path: string): string[] {
  if (path === "" || path === "/") throw new Error(`invalid pointer: ${path}`);
  if (!path.startsWith("/")) throw new Error(`invalid pointer: ${path}`);
  return path.slice(1).split("/").map(decodeToken);
}

/**
 * Read a numeric pointer out of a limits object. Throws on an unknown / non-numeric
 * target rather than returning undefined: a silent miss would let a proposal claim it
 * changed a rail it never touched.
 */
export function resolvePointer(limits: unknown, path: string): number {
  const tokens = splitPointer(path);
  let node: unknown = limits;
  for (const token of tokens) {
    if (node === null || typeof node !== "object") {
      throw new Error(`unknown_limits_path: ${path}`);
    }
    node = Array.isArray(node)
      ? (node as unknown[])[Number(token)]
      : (node as Record<string, unknown>)[token];
  }
  if (typeof node !== "number" || !Number.isFinite(node)) {
    throw new Error(`unknown_limits_path: ${path}`);
  }
  return node;
}

/**
 * Return a COPY of `limits` with `path` set to `value`. Pure — the input is never mutated,
 * so a rejected proposal cannot leave a half-applied limits object behind. Only existing
 * numeric slots may be written; creating new keys would smuggle unvalidated config in.
 */
export function applyPointer<T>(limits: T, path: string, value: number): T {
  if (!Number.isFinite(value)) throw new Error(`invalid_limits_value: ${path}=${value}`);
  const tokens = splitPointer(path);
  // Verifies existence AND numeric-ness of the target before any copying happens.
  resolvePointer(limits, path);

  const clone = (node: unknown, depth: number): unknown => {
    const token = tokens[depth];
    const last = depth === tokens.length - 1;
    if (Array.isArray(node)) {
      const copy = [...(node as unknown[])];
      copy[Number(token)] = last ? value : clone(copy[Number(token)], depth + 1);
      return copy;
    }
    const copy = { ...(node as Record<string, unknown>) };
    copy[token] = last ? value : clone(copy[token], depth + 1);
    return copy;
  };

  return clone(limits, 0) as T;
}

/** Every one of `paths` whose value differs between two limits objects. */
export function changedLimitsPaths(
  before: LimitsConfig,
  after: LimitsConfig,
  paths: readonly string[],
): string[] {
  return paths.filter((path) => {
    try {
      return resolvePointer(before, path) !== resolvePointer(after, path);
    } catch {
      return false;
    }
  });
}
