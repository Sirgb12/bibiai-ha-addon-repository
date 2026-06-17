import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "bibiai-memory-test-"));
  process.env.DISCORD_TOKEN = "discord-token";
  process.env.DISCORD_CLIENT_ID = "discord-client-id";
  process.env.GEMINI_API_KEY = "gemini-key";
  process.env.MC_RCON_PASSWORD = "rcon-password";
  process.env.MEMORY_PATH = join(tempDir, "memory.json");
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("MemoryStore", () => {
  it("persists memories", async () => {
    const { MemoryStore } = await import("../src/memory/MemoryStore.js");
    const memory = new MemoryStore();

    const entry = await memory.add("The Honda Fit Republic prefers decisive briefings.", "tester", "community");

    expect(entry.id).toBeTruthy();
    expect(await memory.list()).toEqual([entry]);
  });

  it("refuses obvious secrets", async () => {
    const { MemoryStore } = await import("../src/memory/MemoryStore.js");
    const memory = new MemoryStore();

    await expect(memory.add("The API key is definitely secret", "tester", "ops")).rejects.toThrow(/secret/i);
  });
});
