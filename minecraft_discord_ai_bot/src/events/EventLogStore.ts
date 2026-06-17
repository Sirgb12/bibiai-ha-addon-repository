import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config.js";

export type EventLogType =
  | "minecraft_offline"
  | "minecraft_online"
  | "minecraft_recovery"
  | "minecraft_diagnostics"
  | "moderation"
  | "weekly_report";

export type StoredEvent = {
  id: string;
  type: EventLogType;
  title: string;
  details?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

type EventLogFile = {
  version: 1;
  lastWeeklyReportKey?: string;
  events: StoredEvent[];
};

const emptyLog = (): EventLogFile => ({ version: 1, events: [] });

export class EventLogStore {
  constructor(private readonly filePath = config.events.path) {}

  async record(
    type: EventLogType,
    title: string,
    details?: string,
    metadata?: Record<string, unknown>
  ): Promise<StoredEvent> {
    const file = await this.read();
    const event: StoredEvent = {
      id: crypto.randomUUID(),
      type,
      title,
      details,
      createdAt: new Date().toISOString(),
      metadata
    };

    file.events.push(event);
    file.events = this.prune(file.events);
    await this.write(file);
    return event;
  }

  async since(timestampMs: number): Promise<StoredEvent[]> {
    const file = await this.read();
    return file.events.filter((event) => Date.parse(event.createdAt) >= timestampMs);
  }

  async recent(limit = 20): Promise<StoredEvent[]> {
    const file = await this.read();
    return file.events.slice(-limit);
  }

  async getLastWeeklyReportKey(): Promise<string | undefined> {
    const file = await this.read();
    return file.lastWeeklyReportKey;
  }

  async setLastWeeklyReportKey(key: string): Promise<void> {
    const file = await this.read();
    file.lastWeeklyReportKey = key;
    await this.write(file);
  }

  private prune(events: StoredEvent[]): StoredEvent[] {
    const cutoff = Date.now() - config.events.retentionDays * 24 * 60 * 60 * 1000;
    return events
      .filter((event) => Date.parse(event.createdAt) >= cutoff)
      .slice(-config.events.maxItems);
  }

  private async read(): Promise<EventLogFile> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<EventLogFile>;
      return {
        version: 1,
        lastWeeklyReportKey: typeof raw.lastWeeklyReportKey === "string" ? raw.lastWeeklyReportKey : undefined,
        events: Array.isArray(raw.events) ? raw.events.filter(isStoredEvent) : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLog();
      throw error;
    }
  }

  private async write(file: EventLogFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

function isStoredEvent(value: unknown): value is StoredEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.type === "string" &&
    typeof event.title === "string" &&
    typeof event.createdAt === "string"
  );
}
