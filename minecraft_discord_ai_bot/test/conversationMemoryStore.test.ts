import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "bibiai-conversation-memory-test-"));
  process.env.DISCORD_TOKEN = "discord-token";
  process.env.DISCORD_CLIENT_ID = "discord-client-id";
  process.env.GEMINI_API_KEY = "gemini-key";
  process.env.MC_RCON_PASSWORD = "rcon-password";
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("ConversationMemoryStore", () => {
  it("formats recent and relevant older conversation turns", async () => {
    const { ConversationMemoryStore } = await import("../src/memory/ConversationMemoryStore.js");
    const memory = new ConversationMemoryStore(join(tempDir, "conversations.json"));

    await memory.record({
      source: "mention",
      userId: "user-2",
      userLabel: "RailPlanner",
      channelId: "channel-2",
      prompt: "The nether rail plan needs blue ice and obsidian.",
      response: "BibiAI will remember the nether rail logistics.",
      mediaCount: 1
    });

    for (let index = 0; index < 13; index += 1) {
      await memory.record({
        source: "slash",
        userId: "user-1",
        userLabel: "Tester",
        channelId: "channel-1",
        prompt: `General chat turn ${index}`,
        response: `General response ${index}`
      });
    }

    const promptContext = await memory.formatForPrompt("what was the nether rail plan?", "user-2", "channel-2");

    expect(promptContext).toContain("Recent conversation turns");
    expect(promptContext).toContain("Relevant older conversation turns");
    expect(promptContext).toContain("nether rail plan");
    expect(promptContext).toContain("[1 media attachment(s)]");
  });

  it("does not store obvious secrets", async () => {
    const { ConversationMemoryStore } = await import("../src/memory/ConversationMemoryStore.js");
    const memory = new ConversationMemoryStore(join(tempDir, "secret-conversations.json"));

    const turn = await memory.record({
      source: "mention",
      userId: "user-1",
      userLabel: "Tester",
      channelId: "channel-1",
      prompt: "my api key is definitely not for memory",
      response: "I will not save that."
    });

    expect(turn).toBeNull();
    expect(await memory.recent()).toEqual([]);
  });

  it("stores observed chat without a bot response", async () => {
    const { ConversationMemoryStore } = await import("../src/memory/ConversationMemoryStore.js");
    const memory = new ConversationMemoryStore(join(tempDir, "observed-conversations.json"));

    const turn = await memory.record({
      source: "observed_chat",
      userId: "user-3",
      userLabel: "Builder",
      channelId: "channel-1",
      prompt: "I am building the courthouse out of copper."
    });

    expect(turn?.response).toBe("");

    const promptContext = await memory.formatForPrompt("what was Builder making?", "user-3", "channel-1");
    expect(promptContext).toContain("Observed chat");
    expect(promptContext).toContain("courthouse out of copper");
  });
});
