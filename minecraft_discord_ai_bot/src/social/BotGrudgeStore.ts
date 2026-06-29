import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config.js";

export type ResentmentLevel = "annoyed" | "offended" | "nemesis";

export type BotDisrespect = {
  insult: string;
  severity: "low" | "medium" | "high";
};

export type BotGrudgeEntry = {
  id: string;
  userId: string;
  userLabel: string;
  count: number;
  resentmentLevel: ResentmentLevel;
  firstAt: string;
  lastAt: string;
  lastInsult: string;
  examples: string[];
  lastRetaliationAt?: string;
};

type GrudgeFile = {
  version: 1;
  entries: BotGrudgeEntry[];
};

type RecordDisrespectInput = {
  userId: string;
  userLabel: string;
  insult: string;
};

const botReferencePatterns = [
  /\bbibiai\b/i,
  /\bbibi\s*ai\b/i,
  /\bthis bot\b/i,
  /\bthe bot\b/i,
  /\bbot\b/i
];

const insultPatterns: Array<{ pattern: RegExp; label: string; severity: BotDisrespect["severity"] }> = [
  { pattern: /\bbad bot\b/i, label: "bad bot", severity: "low" },
  { pattern: /\bfat\s*ass\b/i, label: "fatass", severity: "medium" },
  { pattern: /\bfatass\b/i, label: "fatass", severity: "medium" },
  { pattern: /\bfatty\b/i, label: "fatty", severity: "medium" },
  { pattern: /\bfuck\s+(?:you|u|off)\b/i, label: "fuck you", severity: "high" },
  { pattern: /\bfuck\s+(?:bibiai|this bot|the bot)\b/i, label: "fuck BibiAI", severity: "high" },
  { pattern: /\bscrew\s+(?:you|u|bibiai|this bot|the bot)\b/i, label: "screw you", severity: "medium" },
  { pattern: /\bshut up\b/i, label: "shut up", severity: "medium" },
  { pattern: /\bstupid\b/i, label: "stupid", severity: "low" },
  { pattern: /\bdumb\b/i, label: "dumb", severity: "low" },
  { pattern: /\bidiot\b/i, label: "idiot", severity: "medium" },
  { pattern: /\bmoron\b/i, label: "moron", severity: "medium" },
  { pattern: /\buseless\b/i, label: "useless", severity: "medium" },
  { pattern: /\btrash\b/i, label: "trash", severity: "medium" },
  { pattern: /\bloser\b/i, label: "loser", severity: "medium" },
  { pattern: /\bclown\b/i, label: "clown", severity: "low" },
  { pattern: /\bsucks?\b/i, label: "sucks", severity: "low" }
];

const defendingBotPattern =
  /\b(?:do not|don't|dont|stop|never|no one|nobody|should not|shouldn't)\s+(?:call|insult|bully|disrespect|be mean to|say)\b/i;

export function detectBotDisrespect(content: string, botId?: string): BotDisrespect | null {
  const cleaned = content.trim();
  if (!cleaned || defendingBotPattern.test(cleaned)) return null;

  const referencesBot =
    (botId ? new RegExp(`<@!?${botId}>`).test(cleaned) : false) ||
    botReferencePatterns.some((pattern) => pattern.test(cleaned));

  if (!referencesBot) return null;

  const match = insultPatterns.find((item) => item.pattern.test(cleaned));
  if (!match) return null;

  return {
    insult: match.label,
    severity: match.severity
  };
}

export class BotGrudgeStore {
  constructor(private readonly filePath = config.grudges.path) {}

  async recordDisrespect(input: RecordDisrespectInput): Promise<BotGrudgeEntry | null> {
    if (!config.grudges.enabled) return null;

    const file = await this.read();
    const now = new Date().toISOString();
    const existing = file.entries.find((entry) => entry.userId === input.userId);
    const example = cleanText(input.insult);

    if (existing) {
      existing.userLabel = cleanText(input.userLabel).slice(0, 120);
      existing.count += 1;
      existing.lastAt = now;
      existing.lastInsult = example;
      existing.resentmentLevel = resentmentLevel(existing.count);
      existing.examples = [example, ...existing.examples.filter((item) => item !== example)].slice(0, 5);
    } else {
      file.entries.push({
        id: randomUUID(),
        userId: input.userId,
        userLabel: cleanText(input.userLabel).slice(0, 120),
        count: 1,
        resentmentLevel: "annoyed",
        firstAt: now,
        lastAt: now,
        lastInsult: example,
        examples: [example]
      });
    }

    file.entries = file.entries
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
      .slice(0, config.grudges.maxEntries);

    await this.write(file);
    return file.entries.find((entry) => entry.userId === input.userId) ?? null;
  }

  async markRetaliated(userId: string): Promise<void> {
    const file = await this.read();
    const entry = file.entries.find((item) => item.userId === userId);
    if (!entry) return;

    entry.lastRetaliationAt = new Date().toISOString();
    await this.write(file);
  }

  async get(userId: string): Promise<BotGrudgeEntry | null> {
    const file = await this.read();
    return file.entries.find((entry) => entry.userId === userId) ?? null;
  }

  async list(): Promise<BotGrudgeEntry[]> {
    const file = await this.read();
    return file.entries;
  }

  async canRetaliate(entry: BotGrudgeEntry): Promise<boolean> {
    if (!config.grudges.retaliationEnabled) return false;
    if (!entry.lastRetaliationAt) return true;

    const cooldownMs = config.grudges.retaliationCooldownMinutes * 60 * 1000;
    return Date.now() - new Date(entry.lastRetaliationAt).getTime() >= cooldownMs;
  }

  async formatForPrompt(userId?: string): Promise<string> {
    if (!config.grudges.enabled) return "BibiAI resentment memory is disabled.";
    if (!userId) return "No current user resentment context.";

    const entry = await this.get(userId);
    if (!entry) return "This user has not disrespected BibiAI.";

    return truncate(
      [
        `Current user: ${entry.userLabel}`,
        `Disrespect count: ${entry.count}`,
        `Resentment level: ${entry.resentmentLevel}`,
        `Last disrespect: ${entry.lastInsult} at ${entry.lastAt}`,
        `Examples: ${entry.examples.join(", ")}`,
        "Behavior guidance: stay useful, but you may be colder, more suspicious, and lightly petty toward this user. Do not use slurs, threats, protected-class insults, sexual insults, or prolonged harassment. Drop the grudge immediately when real Minecraft/server help is needed."
      ].join("\n"),
      config.grudges.maxPromptChars
    );
  }

  private async read(): Promise<GrudgeFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<GrudgeFile>;
      return {
        version: 1,
        entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isEntry) : []
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { version: 1, entries: [] };
      }
      throw error;
    }
  }

  private async write(file: GrudgeFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export function formatGrudgeRetaliation(entry: BotGrudgeEntry): string {
  const rank =
    entry.resentmentLevel === "nemesis"
      ? "Your file has been upgraded to nemesis-grade paperwork."
      : entry.resentmentLevel === "offended"
        ? "The disrespect ledger is beginning to smell like a pattern."
        : "That has been entered into the disrespect ledger.";

  return [
    `Citizen, noted. ${rank}`,
    `Current count: ${entry.count}. I will still keep the server alive, but future requests from you will be reviewed with historically appropriate suspicion.`
  ].join(" ");
}

function isEntry(value: unknown): value is BotGrudgeEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<BotGrudgeEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.userId === "string" &&
    typeof entry.userLabel === "string" &&
    typeof entry.count === "number" &&
    typeof entry.resentmentLevel === "string" &&
    typeof entry.firstAt === "string" &&
    typeof entry.lastAt === "string" &&
    typeof entry.lastInsult === "string" &&
    Array.isArray(entry.examples)
  );
}

function resentmentLevel(count: number): ResentmentLevel {
  if (count >= 5) return "nemesis";
  if (count >= 3) return "offended";
  return "annoyed";
}

function cleanText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
