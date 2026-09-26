import { describe, expect, it } from "vitest";
import {
  COUNTERFACTUAL_HORIZON_SESSIONS,
  insideRefusalEpisode,
} from "@/lib/fitness/counterfactuals";

// 200 consecutive "sessions" — only their order matters to the episode test.
const SESSIONS = Array.from({ length: 200 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
);
const day = (i: number) => SESSIONS[i]!;

describe("insideRefusalEpisode", () => {
  it("opens an episode when the ticker has none", () => {
    expect(insideRefusalEpisode(SESSIONS, [], day(10))).toBe(false);
  });

  it("drops a same-session repeat (two runs refusing the same close)", () => {
    expect(insideRefusalEpisode(SESSIONS, [day(10)], day(10))).toBe(true);
  });

  it("drops daily re-refusals inside the full-horizon window", () => {
    expect(insideRefusalEpisode(SESSIONS, [day(10)], day(11))).toBe(true);
    expect(
      insideRefusalEpisode(SESSIONS, [day(10)], day(10 + COUNTERFACTUAL_HORIZON_SESSIONS - 1)),
    ).toBe(true);
  });

  it("starts the next episode at the previous one's horizon session", () => {
    expect(
      insideRefusalEpisode(SESSIONS, [day(10)], day(10 + COUNTERFACTUAL_HORIZON_SESSIONS)),
    ).toBe(false);
  });

  it("also blocks a back-dated refusal that falls inside a later episode's window", () => {
    expect(insideRefusalEpisode(SESSIONS, [day(80)], day(60))).toBe(true);
    expect(insideRefusalEpisode(SESSIONS, [day(80)], day(10))).toBe(false);
  });

  it("checks every existing episode, not just the latest", () => {
    expect(insideRefusalEpisode(SESSIONS, [day(10), day(150)], day(40))).toBe(true);
    expect(insideRefusalEpisode(SESSIONS, [day(10), day(150)], day(80))).toBe(false);
  });
});
