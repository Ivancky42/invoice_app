import { describe, expect, it } from "vitest";
import {
  SCORE_HELPED_THRESHOLD,
  SCORE_HURT_THRESHOLD,
  SCORE_MIN_SESSIONS,
  checkMetric,
  classifyOutcome,
  parseSuccessMetric,
} from "@/lib/evolution/scoring";

describe("classifyOutcome", () => {
  it("HELPED above the positive threshold", () => {
    expect(classifyOutcome({ deltaPerSession: 0.001, sessions: 30, metricCheck: "MET" })).toBe(
      "HELPED",
    );
  });

  it("HURT at or below the negative threshold", () => {
    expect(
      classifyOutcome({ deltaPerSession: SCORE_HURT_THRESHOLD, sessions: 30, metricCheck: "MET" }),
    ).toBe("HURT");
  });

  it("NEUTRAL inside the dead band", () => {
    expect(classifyOutcome({ deltaPerSession: 0.0001, sessions: 30, metricCheck: "MET" })).toBe(
      "NEUTRAL",
    );
    expect(classifyOutcome({ deltaPerSession: -0.0001, sessions: 30, metricCheck: "MET" })).toBe(
      "NEUTRAL",
    );
  });

  it("thresholds are inclusive at the boundary", () => {
    expect(
      classifyOutcome({
        deltaPerSession: SCORE_HELPED_THRESHOLD,
        sessions: 30,
        metricCheck: "UNKNOWN",
      }),
    ).toBe("HELPED");
  });

  it("a thin series is NEUTRAL no matter how good it looks", () => {
    expect(
      classifyOutcome({
        deltaPerSession: 0.05,
        sessions: SCORE_MIN_SESSIONS - 1,
        metricCheck: "MET",
      }),
    ).toBe("NEUTRAL");
  });

  it("a HURT verdict still lands even on a thin-but-sufficient series", () => {
    expect(
      classifyOutcome({ deltaPerSession: -0.01, sessions: SCORE_MIN_SESSIONS, metricCheck: "MET" }),
    ).toBe("HURT");
  });

  it("a missed self-declared metric downgrades HELPED to NEUTRAL", () => {
    expect(classifyOutcome({ deltaPerSession: 0.001, sessions: 30, metricCheck: "MISSED" })).toBe(
      "NEUTRAL",
    );
  });

  it("UNKNOWN metric does not block HELPED", () => {
    expect(classifyOutcome({ deltaPerSession: 0.001, sessions: 30, metricCheck: "UNKNOWN" })).toBe(
      "HELPED",
    );
  });

  it("a non-finite delta is NEUTRAL, never a verdict", () => {
    expect(
      classifyOutcome({ deltaPerSession: Number.NaN, sessions: 30, metricCheck: "MET" }),
    ).toBe("NEUTRAL");
  });
});

describe("parseSuccessMetric", () => {
  it("pulls the first number and the metric term", () => {
    expect(parseSuccessMetric("fitness beats live by 0.002 per session")).toEqual({
      term: "fitness",
      target: 0.002,
    });
  });

  it("null when there is no number or no term", () => {
    expect(parseSuccessMetric("fitness goes up")).toBeNull();
    expect(parseSuccessMetric("goes up by 0.002")).toBeNull();
    expect(parseSuccessMetric(null)).toBeNull();
  });
});

describe("checkMetric", () => {
  it("MET when the cumulative edge reaches the claim", () => {
    expect(checkMetric({ term: "fitness", target: 0.02 }, 0.001, 30)).toBe("MET");
  });

  it("MISSED when it does not", () => {
    expect(checkMetric({ term: "fitness", target: 0.05 }, 0.001, 30)).toBe("MISSED");
  });

  it("UNKNOWN for unparseable or non-comparable claims", () => {
    expect(checkMetric(null, 0.001, 30)).toBe("UNKNOWN");
    expect(checkMetric({ term: "drawdown", target: 0.08 }, 0.001, 30)).toBe("UNKNOWN");
    // A target ≥ 1 is stated in units we cannot safely reinterpret as a NAV fraction.
    expect(checkMetric({ term: "return", target: 5 }, 0.001, 30)).toBe("UNKNOWN");
  });
});
