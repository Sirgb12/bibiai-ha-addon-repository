import { config } from "../config.js";
import { EventLogStore, StoredEvent } from "../events/EventLogStore.js";
import { MinecraftService } from "../minecraft/MinecraftService.js";
import { truncate } from "../util/text.js";

export type ReportSender = (message: string) => Promise<void>;

const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export class WeeklyReporter {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly minecraft: MinecraftService,
    private readonly events: EventLogStore,
    private readonly send: ReportSender
  ) {}

  start(): void {
    if (!config.weeklyReport.enabled) return;

    void this.tick(new Date()).catch((error) => console.error(`Weekly report startup check failed: ${errorMessage(error)}`));

    this.timer = setInterval(() => {
      void this.tick(new Date()).catch((error) => console.error(`Weekly report check failed: ${errorMessage(error)}`));
    }, 15 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now: Date): Promise<void> {
    if (!this.shouldSend(now)) return;

    const reportKey = this.reportKey(now);
    if ((await this.events.getLastWeeklyReportKey()) === reportKey) return;

    const report = await this.buildReport(now);
    await this.send(report);
    await this.events.setLastWeeklyReportKey(reportKey);
    await this.events.record("weekly_report", "Weekly server report sent", reportKey);
  }

  private shouldSend(now: Date): boolean {
    const dayIndex = dayNames.indexOf(config.weeklyReport.day);
    return now.getUTCDay() === dayIndex && now.getUTCHours() >= config.weeklyReport.hourUtc;
  }

  private reportKey(now: Date): string {
    return now.toISOString().slice(0, 10);
  }

  private async buildReport(now: Date): Promise<string> {
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const [status, events] = await Promise.all([
      this.minecraft.getStatus(false),
      this.events.since(weekAgo)
    ]);

    const counts = countEvents(events);
    const notable = events
      .filter((event) => event.type !== "weekly_report")
      .slice(-10)
      .map(formatEvent)
      .join("\n");

    return truncate(
      [
        `**Weekly ${status.serverName} report**`,
        `Status now: TCP ${status.tcpOnline ? "online" : "offline"}, RCON ${status.rconOnline ? "online" : "offline"}`,
        `Bot-observed events this week: ${events.filter((event) => event.type !== "weekly_report").length}`,
        `Offline alerts: ${counts.minecraft_offline ?? 0}`,
        `Recovery attempts: ${counts.minecraft_recovery ?? 0}`,
        `Moderation actions: ${counts.moderation ?? 0}`,
        "",
        notable ? `Notable events:\n${notable}` : "Notable events: None recorded this week."
      ].join("\n"),
      1900
    );
  }
}

function countEvents(events: StoredEvent[]): Partial<Record<StoredEvent["type"], number>> {
  const counts: Partial<Record<StoredEvent["type"], number>> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
}

function formatEvent(event: StoredEvent): string {
  const date = new Date(event.createdAt).toISOString().replace("T", " ").slice(0, 16);
  return `- ${date} UTC: ${event.title}${event.details ? ` - ${truncate(event.details, 120)}` : ""}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
