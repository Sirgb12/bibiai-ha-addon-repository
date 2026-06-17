import { config } from "../config.js";
import { truncate } from "../util/text.js";

export type PebbleHostPowerSignal = "start" | "restart";

export type PebbleHostPowerResult = {
  ok: boolean;
  message: string;
};

export class PebbleHostApi {
  isConfigured(): boolean {
    return Boolean(config.pebblehost.enabled && config.pebblehost.apiToken && config.pebblehost.serverId);
  }

  missingConfigMessage(): string {
    const missing = [];
    if (!config.pebblehost.enabled) missing.push("pebblehost_api_enabled");
    if (!config.pebblehost.apiToken) missing.push("pebblehost_api_token");
    if (!config.pebblehost.serverId) missing.push("pebblehost_server_id");
    return `PebbleHost recovery is not configured. Missing: ${missing.join(", ")}.`;
  }

  async sendPowerSignal(signal: PebbleHostPowerSignal): Promise<PebbleHostPowerResult> {
    if (!this.isConfigured()) {
      return { ok: false, message: this.missingConfigMessage() };
    }

    const baseUrl = config.pebblehost.apiBaseUrl.replace(/\/+$/, "");
    const serverId = encodeURIComponent(config.pebblehost.serverId!);
    const response = await fetch(`${baseUrl}/api/client/servers/${serverId}/power`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.pebblehost.apiToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ signal })
    });

    if (response.status === 204) {
      return { ok: true, message: `PebbleHost accepted power signal "${signal}".` };
    }

    const body = truncate(await response.text().catch(() => ""), 500);
    return {
      ok: false,
      message: `PebbleHost power signal "${signal}" failed with HTTP ${response.status}${body ? `: ${body}` : "."}`
    };
  }
}
