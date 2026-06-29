import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { config } from "../config.js";

export type ConversationSource = "mention" | "slash" | "auto_reply" | "observed_chat" | "chime" | "revive" | "grudge";

export type ConversationTurn = {
  id: string;
  createdAt: string;
  source: ConversationSource;
  userId: string;
  userLabel: string;
  channelId?: string;
  prompt: string;
  response: string;
  mediaCount: number;
};

type ConversationFile = {
  version: 1;
  turns: ConversationTurn[];
};

type RecordTurnInput = {
  source: ConversationSource;
  userId: string;
  userLabel: string;
  channelId?: string | null;
  prompt: string;
  response?: string;
  mediaCount?: number;
};

const secretPatterns = [
  /token/i,
  /api[_ -]?key/i,
  /password/i,
  /secret/i,
  /bearer\s+[a-z0-9._-]+/i,
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/
];

export class ConversationMemoryStore {
  constructor(private readonly filePath = config.conversationMemory.path) {}

  async record(input: RecordTurnInput): Promise<ConversationTurn | null> {
    if (!config.conversationMemory.enabled) return null;

    const prompt = cleanText(input.prompt);
    const response = cleanText(input.response ?? "");
    if (!prompt) return null;
    if (!response && input.source !== "observed_chat") return null;

    if (this.looksSecret(prompt) || this.looksSecret(response)) {
      console.warn("Conversation memory skipped a turn that looked like it contained a secret.");
      return null;
    }

    const file = await this.read();
    const turn: ConversationTurn = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      source: input.source,
      userId: input.userId,
      userLabel: cleanText(input.userLabel).slice(0, 120),
      channelId: input.channelId ?? undefined,
      prompt: truncate(prompt, config.conversationMemory.maxEntryLength),
      response: truncate(response, config.conversationMemory.maxEntryLength),
      mediaCount: input.mediaCount ?? 0
    };

    file.turns.push(turn);
    file.turns = file.turns.slice(-config.conversationMemory.maxTurns);
    await this.write(file);
    return turn;
  }

  async recent(limit = config.conversationMemory.recentTurns): Promise<ConversationTurn[]> {
    const file = await this.read();
    return file.turns.slice(-limit);
  }

  async formatForPrompt(query: string, userId?: string, channelId?: string | null): Promise<string> {
    if (!config.conversationMemory.enabled) return "Conversation memory is disabled.";

    const file = await this.read();
    if (file.turns.length === 0) return "No prior conversations saved yet.";

    const recent = file.turns.slice(-config.conversationMemory.recentTurns);
    const recentIds = new Set(recent.map((turn) => turn.id));
    const relevant = this.relevantTurns(file.turns, query, userId, channelId)
      .filter((turn) => !recentIds.has(turn.id))
      .slice(0, config.conversationMemory.relevantTurns);

    const sections = [
      recent.length > 0 ? `Recent conversation turns:\n${formatTurns(recent)}` : undefined,
      relevant.length > 0 ? `Relevant older conversation turns:\n${formatTurns(relevant)}` : undefined
    ].filter(Boolean);

    return truncate(sections.join("\n\n"), config.conversationMemory.maxPromptChars);
  }

  looksSecret(text: string): boolean {
    return secretPatterns.some((pattern) => pattern.test(text));
  }

  private relevantTurns(
    turns: ConversationTurn[],
    query: string,
    userId: string | undefined,
    channelId: string | null | undefined
  ): ConversationTurn[] {
    const queryTokens = tokenSet(query);

    return turns
      .map((turn, index) => {
        const turnTokens = tokenSet(`${turn.prompt} ${turn.response}`);
        const overlap = [...queryTokens].filter((token) => turnTokens.has(token)).length;
        const sameUser = userId && turn.userId === userId ? 2 : 0;
        const sameChannel = channelId && turn.channelId === channelId ? 1 : 0;
        const recency = index / Math.max(1, turns.length) / 4;
        return { turn, score: overlap + sameUser + sameChannel, recency };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.recency - a.recency)
      .map((item) => item.turn);
  }

  private async read(): Promise<ConversationFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ConversationFile>;
      return {
        version: 1,
        turns: Array.isArray(parsed.turns) ? parsed.turns.filter(isTurn) : []
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { version: 1, turns: [] };
      }
      throw error;
    }
  }

  private async write(file: ConversationFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

function isTurn(value: unknown): value is ConversationTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Partial<ConversationTurn>;
  return (
    typeof turn.id === "string" &&
    typeof turn.createdAt === "string" &&
    typeof turn.source === "string" &&
    typeof turn.userId === "string" &&
    typeof turn.userLabel === "string" &&
    typeof turn.prompt === "string" &&
    typeof turn.response === "string" &&
    typeof turn.mediaCount === "number"
  );
}

function formatTurns(turns: ConversationTurn[]): string {
  return turns
    .map((turn, index) => {
      const media = turn.mediaCount > 0 ? ` [${turn.mediaCount} media attachment(s)]` : "";
      return [
        `${index + 1}. ${turn.createdAt} ${turn.userLabel}${media}`,
        `${turn.source === "observed_chat" ? "Observed chat" : "User"}: ${truncate(turn.prompt, 700)}`,
        turn.response ? `BibiAI: ${truncate(turn.response, 700)}` : undefined
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function cleanText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
