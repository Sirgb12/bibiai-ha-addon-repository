import { config } from "../config.js";
import { EventLogStore, StoredEvent } from "../events/EventLogStore.js";
import { MinecraftService } from "../minecraft/MinecraftService.js";
import { truncate } from "../util/text.js";

export type VacationReportSender = (message: string) => Promise<void>;

const vacationHelpPatterns = [
  /\bwhere(?:'s| is)\s+(?:ben|owner|admin|staff|mod)\b/i,
  /\bwho(?:'s| is)\s+(?:in charge|running|watching|moderating)\b/i,
  /\b(?:ben|owner|admin|staff|mod)\s+(?:away|vacation|gone|offline)\b/i,
  /\bwhat(?:'s| is)\s+(?:the\s+)?rules?\b/i,
  /\bdiscord\s+rules?\b/i,
  /\bi\s+need\s+(?:help|staff|admin|mod)\b/i,
  /\bhelp\s+(?:me|pls|please|with discord|with the server)\b/i,
  /\bserver\s+(?:down|offline|broken|not working)\b/i
];

export class VacationManager {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly minecraft: MinecraftService,
    private readonly events: EventLogStore,
    private readonly send: VacationReportSender
  ) {}

  start(): void {
    if (!config.vacation.enabled || !config.vacation.dailyReportEnabled) return;

    void this.tick(new Date()).catch((error) => console.error(`Vacation report startup check failed: ${errorMessage(error)}`));

    this.timer = setInterval(() => {
      void this.tick(new Date()).catch((error) => console.error(`Vacation report check failed: ${errorMessage(error)}`));
    }, 15 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  looksLikeVacationHelpRequest(text: string): boolean {
    return vacationHelpPatterns.some((pattern) => pattern.test(text));
  }

  formatAutoReply(): string {
    return truncate(
      [
        "**Vacation mode is active.**",
        config.vacation.ownerNote,
        returnLine(),
        "",
        `Rules while Ben is away: ${config.vacation.rulesSummary}`,
        "",
        "Useful commands:",
        "- `/join` for the IP, modpack links, and install steps.",
        "- `/mc status` to check whether the Minecraft server is online.",
        "- Ask BibiAI basic questions in an enabled channel.",
        "",
        "If something is actually on fire, tag a real operator. BibiAI can help with routine stuff, not human judgment."
      ]
        .filter(Boolean)
        .join("\n"),
      1900
    );
  }

  async formatStatus(): Promise<string> {
    const status = await this.minecraft.getStatus(false);
    const recent = await this.events.recent(8);

    return truncate(
      [
        `**Vacation mode:** ${config.vacation.enabled ? "enabled" : "disabled"}`,
        config.vacation.ownerNote,
        returnLine(),
        `Rules: ${config.vacation.rulesSummary}`,
        "",
        `Minecraft now: TCP ${status.tcpOnline ? "online" : "offline"}, RCON ${status.rconOnline ? "online" : "offline"}`,
        status.players ? `Players: ${status.players}` : undefined,
        status.errors.length ? `Errors: ${status.errors.join(" | ")}` : undefined,
        "",
        recent.length ? `Recent bot-observed events:\n${recent.map(formatEvent).join("\n")}` : "Recent bot-observed events: none"
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
      1900
    );
  }

  async tick(now: Date): Promise<void> {
    if (!config.vacation.enabled || !config.vacation.dailyReportEnabled) return;
    if (now.getUTCHours() < config.vacation.reportHourUtc) return;

    const reportKey = now.toISOString().slice(0, 10);
    if ((await this.events.getLastVacationReportKey()) === reportKey) return;

    const report = await this.buildDailyReport(now);
    await this.send(report);
    await this.events.setLastVacationReportKey(reportKey);
    await this.events.record("vacation_report", "Vacation daily report sent", reportKey);
  }

  private async buildDailyReport(now: Date): Promise<string> {
    const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
    const [status, events] = await Promise.all([
      this.minecraft.getStatus(false),
      this.events.since(dayAgo)
    ]);

    const visibleEvents = events.filter((event) => event.type !== "weekly_report" && event.type !== "vacation_report");
    const counts = countEvents(visibleEvents);
    const notable = visibleEvents.slice(-10).map(formatEvent).join("\n");

    return truncate(
      [
        `**Vacation daily report: ${config.minecraft.serverName}**`,
        returnLine(),
        `Minecraft now: TCP ${status.tcpOnline ? "online" : "offline"}, RCON ${status.rconOnline ? "online" : "offline"}`,
        `Events in the last 24h: ${visibleEvents.length}`,
        `Moderation actions: ${counts.moderation ?? 0}`,
        `Offline alerts: ${counts.minecraft_offline ?? 0}`,
        `Recovery/start attempts: ${counts.minecraft_recovery ?? 0}`,
        `Diagnostics requests: ${counts.minecraft_diagnostics ?? 0}`,
        "",
        notable ? `Notable events:\n${notable}` : "Notable events: none recorded.",
        "",
        `Rules reminder: ${config.vacation.rulesSummary}`
      ]
        .filter(Boolean)
        .join("\n"),
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

function returnLine(): string | undefined {
  return config.vacation.returnDate ? `Expected return: ${config.vacation.returnDate}` : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
