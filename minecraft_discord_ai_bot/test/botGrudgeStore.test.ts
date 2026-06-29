import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "bibiai-grudge-test-"));
  process.env.DISCORD_TOKEN = "discord-token";
  process.env.DISCORD_CLIENT_ID = "discord-client-id";
  process.env.GEMINI_API_KEY = "gemini-key";
  process.env.MC_RCON_PASSWORD = "rcon-password";
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("BotGrudgeStore", () => {
  it("detects insults aimed at BibiAI", async () => {
    const { detectBotDisrespect } = await import("../src/social/BotGrudgeStore.js");

    expect(detectBotDisrespect("<@123> fatass", "123")?.insult).toBe("fatass");
    expect(detectBotDisrespect("BibiAI is trash", "123")?.insult).toBe("trash");
    expect(detectBotDisrespect("do not call BibiAI a fatass", "123")).toBeNull();
    expect(detectBotDisrespect("that player is trash", "123")).toBeNull();
  });

  it("remembers repeat disrespect and formats prompt context", async () => {
    const { BotGrudgeStore } = await import("../src/social/BotGrudgeStore.js");
    const grudges = new BotGrudgeStore(join(tempDir, "grudges.json"));

    await grudges.recordDisrespect({
      userId: "user-1",
      userLabel: "Tester",
      insult: "fatass"
    });
    await grudges.recordDisrespect({
      userId: "user-1",
      userLabel: "Tester",
      insult: "trash"
    });
    const entry = await grudges.recordDisrespect({
      userId: "user-1",
      userLabel: "Tester",
      insult: "useless"
    });

    expect(entry?.count).toBe(3);
    expect(entry?.resentmentLevel).toBe("offended");

    const promptContext = await grudges.formatForPrompt("user-1");
    expect(promptContext).toContain("Disrespect count: 3");
    expect(promptContext).toContain("Resentment level: offended");
    expect(promptContext).toContain("useless");
  });
});
