import { config } from "../config.js";
import { EventLogStore } from "../events/EventLogStore.js";
import { truncate } from "../util/text.js";
import { MinecraftService, MinecraftStatus } from "./MinecraftService.js";
import { PebbleHostApi } from "./PebbleHostApi.js";

export type MonitorNotifier = (message: string) => Promise<void>;

export type RecoveryResult = {
  ok: boolean;
  message: string;
};

export class MinecraftMonitor {
  private timer: NodeJS.Timeout | undefined;
  private lastOnline: boolean | undefined;
  private offlineChecks = 0;
  private recoveryTriggeredForOutage = false;

  constructor(
    private readonly minecraft: MinecraftService,
    private readonly events: EventLogStore,
    private readonly notify: MonitorNotifier,
    private readonly pebblehost = new PebbleHostApi()
  ) {}

  start(): void {
    if (!config.minecraft.monitorEnabled) return;

    void this.check("startup").catch((error) => console.error(`Minecraft monitor startup check failed: ${errorMessage(error)}`));

    const intervalMs = config.minecraft.monitorIntervalMinutes * 60 * 1000;
    this.timer = setInterval(() => {
      void this.check("scheduled").catch((error) => console.error(`Minecraft monitor check failed: ${errorMessage(error)}`));
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async check(reason: string): Promise<MinecraftStatus> {
    const status = await this.minecraft.getStatus(false);
    const online = status.tcpOnline || status.rconOnline;

    if (online) {
      if (this.lastOnline === false) {
        await this.events.record("minecraft_online", `${status.serverName} came back online`, undefined, { reason });
        await this.notify(`**Minecraft monitor:** ${status.serverName} is back online.`);
      }

      this.offlineChecks = 0;
      this.recoveryTriggeredForOutage = false;
    } else {
      this.offlineChecks += 1;

      if (this.lastOnline !== false) {
        await this.events.record(
          "minecraft_offline",
          `${status.serverName} appears offline`,
          status.errors.join(" | ") || undefined,
          { reason }
        );
        await this.notify(`**Minecraft monitor:** ${status.serverName} appears offline. I will keep checking.`);
      }

      if (
        config.minecraft.recoveryEnabled &&
        !this.recoveryTriggeredForOutage &&
        this.offlineChecks >= config.minecraft.recoveryOfflineChecks
      ) {
        this.recoveryTriggeredForOutage = true;
        const result = await this.triggerRecovery("automatic offline recovery", status);
        await this.notify(`**Minecraft recovery:** ${result.message}`);
      }
    }

    this.lastOnline = online;
    return status;
  }

  async triggerRecovery(reason: string, status?: MinecraftStatus): Promise<RecoveryResult> {
    if (!config.minecraft.recoveryEnabled) {
      return { ok: false, message: "Recovery is disabled in the add-on config." };
    }

    if (config.pebblehost.enabled) {
      const result = await this.pebblehost.sendPowerSignal(config.pebblehost.recoverySignal);
      await this.events.record(
        "minecraft_recovery",
        result.ok ? "PebbleHost recovery signal sent" : "PebbleHost recovery signal failed",
        result.message,
        { reason, ok: result.ok, provider: "pebblehost", signal: config.pebblehost.recoverySignal }
      );
      return result;
    }

    if (!config.minecraft.recoveryWebhookUrl) {
      return {
        ok: false,
        message: "Recovery is enabled, but neither PebbleHost API nor a recovery webhook URL is configured."
      };
    }

    const payload = {
      event: "minecraft_recovery_requested",
      reason,
      serverName: config.minecraft.serverName,
      timestamp: new Date().toISOString(),
      status
    };

    try {
      const init: RequestInit =
        config.minecraft.recoveryWebhookMethod === "GET"
          ? { method: "GET" }
          : {
              method: config.minecraft.recoveryWebhookMethod,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            };

      const response = await fetch(config.minecraft.recoveryWebhookUrl, init);
      const body = truncate(await response.text().catch(() => ""), 500);

      if (!response.ok) {
        const message = `Recovery webhook failed with HTTP ${response.status}${body ? `: ${body}` : "."}`;
        await this.events.record("minecraft_recovery", "Recovery webhook failed", message, { reason, ok: false });
        return { ok: false, message };
      }

      const message = `Recovery webhook called successfully${body ? `: ${body}` : "."}`;
      await this.events.record("minecraft_recovery", "Recovery webhook called", message, { reason, ok: true });
      return { ok: true, message };
    } catch (error) {
      const message = `Recovery webhook failed: ${errorMessage(error)}`;
      await this.events.record("minecraft_recovery", "Recovery webhook failed", message, { reason, ok: false });
      return { ok: false, message };
    }
  }

  async startServer(reason: string): Promise<RecoveryResult> {
    if (!config.pebblehost.enabled) {
      return {
        ok: false,
        message: "Manual server start requires PebbleHost API support. Set pebblehost_api_enabled, pebblehost_api_token, and pebblehost_server_id."
      };
    }

    const result = await this.pebblehost.sendPowerSignal("start");
    await this.events.record(
      "minecraft_recovery",
      result.ok ? "PebbleHost start signal sent" : "PebbleHost start signal failed",
      result.message,
      { reason, ok: result.ok, provider: "pebblehost", signal: "start" }
    );
    return result;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
