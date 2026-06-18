import { describe, expect, it } from "vitest";
import { evaluateSnitchReport } from "../src/snitch/SnitchEvaluator.js";

const baseInput = {
  previousReports: [],
  minTimeoutMinutes: 1,
  defaultTimeoutMinutes: 3,
  maxTimeoutMinutes: 5,
  escalateRepeatReports: true
};

describe("evaluateSnitchReport", () => {
  it("uses a low timeout for mild reports", () => {
    const result = evaluateSnitchReport({
      ...baseInput,
      reason: "they were rude and insulting BibiAI"
    });

    expect(result.severity).toBe("low");
    expect(result.timeoutMinutes).toBe(1);
  });

  it("uses the default timeout for spam and edating reports", () => {
    const result = evaluateSnitchReport({
      ...baseInput,
      reason: "spamming BibiAI over and over"
    });

    expect(result.severity).toBe("medium");
    expect(result.timeoutMinutes).toBe(3);
  });

  it("uses a higher timeout when evidence contains severe rule language", () => {
    const result = evaluateSnitchReport({
      ...baseInput,
      reason: "look at this message",
      evidence: "message link says they posted nsfw porn"
    });

    expect(result.severity).toBe("high");
    expect(result.timeoutMinutes).toBe(4);
  });

  it("uses the max timeout for critical reports", () => {
    const result = evaluateSnitchReport({
      ...baseInput,
      reason: "they threatened to dox someone and leak their IP"
    });

    expect(result.severity).toBe("critical");
    expect(result.timeoutMinutes).toBe(5);
  });

  it("escalates repeat snitch reports in the lookback window", () => {
    const result = evaluateSnitchReport({
      ...baseInput,
      reason: "they were rude",
      previousReports: [
        { createdAt: new Date().toISOString(), reason: "spamming" },
        { createdAt: new Date().toISOString(), reason: "edating" },
        { createdAt: new Date().toISOString(), reason: "insults" }
      ]
    });

    expect(result.baseSeverity).toBe("low");
    expect(result.severity).toBe("high");
    expect(result.timeoutMinutes).toBe(4);
    expect(result.recentReasons).toHaveLength(3);
  });
});
