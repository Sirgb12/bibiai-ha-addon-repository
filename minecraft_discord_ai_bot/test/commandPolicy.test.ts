import { describe, expect, it } from "vitest";
import { evaluateCommand } from "../src/minecraft/commandPolicy.js";

const options = { allowStopCommand: false, bypassSafety: false };

describe("command policy", () => {
  it("allows safe status and maintenance commands", () => {
    expect(evaluateCommand("list", options).risk).toBe("read");
    expect(evaluateCommand("/save-all", options).risk).toBe("safe");
    expect(evaluateCommand("weather clear 6000", options).risk).toBe("safe");
  });

  it("requires confirmation for commands that can affect players", () => {
    const evaluation = evaluateCommand("kill @e[type=item]", options);
    expect(evaluation.allowed).toBe(true);
    expect(evaluation.risk).toBe("needs_confirmation");
  });

  it("blocks unknown or high-risk commands", () => {
    expect(evaluateCommand("op Steve", options).allowed).toBe(false);
    expect(evaluateCommand("give Steve diamond 64", options).allowed).toBe(false);
    expect(evaluateCommand("say hi; stop", options).allowed).toBe(false);
  });

  it("keeps stop disabled unless explicitly configured", () => {
    expect(evaluateCommand("stop", options).allowed).toBe(false);
    expect(evaluateCommand("stop", { ...options, allowStopCommand: true }).risk).toBe("needs_confirmation");
  });
});
