import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config.js";

export type MemoryCategory = "general" | "server" | "community" | "user" | "ops";

export type MemoryEntry = {
  id: string;
  text: string;
  category: MemoryCategory;
  createdAt: string;
  createdBy: string;
};

type MemoryFile = {
  version: 1;
  entries: MemoryEntry[];
};

const memoryCategories = new Set<MemoryCategory>(["general", "server", "community", "user", "ops"]);

const secretPatterns = [
  /token/i,
  /api[_ -]?key/i,
  /password/i,
  /secret/i,
  /bearer\s+[a-z0-9._-]+/i,
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/
];

export class MemoryStore {
  constructor(private readonly filePath = config.memory.path) {}

  async list(): Promise<MemoryEntry[]> {
    const file = await this.read();
    return file.entries.slice(-config.memory.maxItems);
  }

  async add(text: string, createdBy: string, category: string = "general"): Promise<MemoryEntry> {
    if (!config.memory.enabled) {
      throw new Error("Memory is disabled.");
    }

    const cleaned = text.trim().replace(/\s+/g, " ");
    if (!cleaned) {
      throw new Error("Memory text is empty.");
    }

    if (cleaned.length > config.memory.maxEntryLength) {
      throw new Error(`Memory is too long. Max length is ${config.memory.maxEntryLength} characters.`);
    }

    if (this.looksSecret(cleaned)) {
      throw new Error("Refusing to store something that looks like a token, key, password, or secret.");
    }

    const file = await this.read();
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      text: cleaned,
      category: memoryCategories.has(category as MemoryCategory) ? (category as MemoryCategory) : "general",
      createdAt: new Date().toISOString(),
      createdBy
    };

    file.entries.push(entry);
    file.entries = file.entries.slice(-config.memory.maxItems);
    await this.write(file);
    return entry;
  }

  async remove(id: string): Promise<boolean> {
    const file = await this.read();
    const before = file.entries.length;
    file.entries = file.entries.filter((entry) => entry.id !== id);
    await this.write(file);
    return file.entries.length !== before;
  }

  async clear(): Promise<number> {
    const file = await this.read();
    const count = file.entries.length;
    await this.write({ version: 1, entries: [] });
    return count;
  }

  async formatForPrompt(): Promise<string> {
    if (!config.memory.enabled) return "Memory is disabled.";

    const entries = await this.list();
    if (entries.length === 0) return "No persistent memories yet.";

    return entries
      .map((entry, index) => `${index + 1}. [${entry.category}] ${entry.text} (id: ${entry.id})`)
      .join("\n");
  }

  looksSecret(text: string): boolean {
    return secretPatterns.some((pattern) => pattern.test(text));
  }

  private async read(): Promise<MemoryFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<MemoryFile>;
      return {
        version: 1,
        entries: Array.isArray(parsed.entries) ? parsed.entries.filter(this.isEntry) : []
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { version: 1, entries: [] };
      }
      throw error;
    }
  }

  private async write(file: MemoryFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  private isEntry(value: unknown): value is MemoryEntry {
    if (!value || typeof value !== "object") return false;

    const entry = value as Partial<MemoryEntry>;
    return (
      typeof entry.id === "string" &&
      typeof entry.text === "string" &&
      typeof entry.category === "string" &&
      memoryCategories.has(entry.category as MemoryCategory) &&
      typeof entry.createdAt === "string" &&
      typeof entry.createdBy === "string"
    );
  }
}
