import { createConnection } from "node:net";
import { open, stat } from "node:fs/promises";
import { Rcon } from "rcon-client";
import { config } from "../config.js";
import { codeBlock, truncate } from "../util/text.js";
import {
  CommandEvaluation,
  evaluateCommand,
  normalizeCommand
} from "./commandPolicy.js";

export type CommandRun = {
  command: string;
  risk: CommandEvaluation["risk"];
  ok: boolean;
  output: string;
};

export type MinecraftStatus = {
  serverName: string;
  tcpOnline: boolean;
  rconOnline: boolean;
  players?: string;
  tps?: string;
  mspt?: string;
  version?: string;
  recentLogs?: string;
  errors: string[];
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export class MinecraftService {
  private readonly policyOptions = {
    allowStopCommand: config.safety.allowStopCommand,
    bypassSafety: config.safety.bypassRconSafety
  };

  evaluate(command: string): CommandEvaluation {
    return evaluateCommand(command, this.policyOptions);
  }

  async execute(command: string, options: { confirmed?: boolean } = {}): Promise<CommandRun> {
    const evaluation = this.evaluate(command);

    if (!evaluation.allowed) {
      return {
        command: evaluation.command,
        risk: evaluation.risk,
        ok: false,
        output: evaluation.reason
      };
    }

    if (evaluation.risk === "needs_confirmation" && !options.confirmed) {
      return {
        command: evaluation.command,
        risk: evaluation.risk,
        ok: false,
        output: "This command requires explicit Discord confirmation."
      };
    }

    try {
      const output = await this.sendRcon(evaluation.command);
      return {
        command: evaluation.command,
        risk: evaluation.risk,
        ok: true,
        output: output || "(no output)"
      };
    } catch (error) {
      return {
        command: evaluation.command,
        risk: evaluation.risk,
        ok: false,
        output: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async runCommands(commands: string[], options: { confirmed?: boolean } = {}): Promise<CommandRun[]> {
    const limited = commands.slice(0, config.minecraft.maxCommandsPerFix);
    const results: CommandRun[] = [];

    for (const command of limited) {
      results.push(await this.execute(command, options));
    }

    return results;
  }

  async getStatus(includeRecentLogs: boolean): Promise<MinecraftStatus> {
    const errors: string[] = [];
    const status: MinecraftStatus = {
      serverName: config.minecraft.serverName,
      tcpOnline: await this.pingTcp(config.minecraft.queryHost, config.minecraft.queryPort),
      rconOnline: false,
      errors
    };

    const diagnosticCommands = [
      ["players", "list"],
      ["tps", "tps"],
      ["mspt", "mspt"],
      ["version", "version"]
    ] as const;

    for (const [field, command] of diagnosticCommands) {
      const evaluation = this.evaluate(command);
      if (!evaluation.allowed) continue;

      try {
        const output = await this.sendRcon(command);
        status.rconOnline = true;
        status[field] = output || "(no output)";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (field === "players") {
          errors.push(`RCON check failed: ${message}`);
        }
      }
    }

    if (includeRecentLogs && config.minecraft.logPath) {
      try {
        status.recentLogs = await this.tailLog(config.minecraft.logPath, config.minecraft.statusLogLines);
      } catch (error) {
        errors.push(`Could not read logs: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return status;
  }

  formatStatus(status: MinecraftStatus): string {
    const lines = [
      `**${status.serverName} status**`,
      `TCP: ${status.tcpOnline ? "online" : "offline"}`,
      `RCON: ${status.rconOnline ? "online" : "offline"}`
    ];

    if (status.players) lines.push(`Players: ${status.players}`);
    if (status.tps) lines.push(`TPS: ${status.tps}`);
    if (status.mspt) lines.push(`MSPT: ${status.mspt}`);
    if (status.version) lines.push(`Version: ${status.version}`);
    if (status.errors.length) lines.push(`Errors: ${status.errors.join(" | ")}`);

    return lines.join("\n");
  }

  formatDiagnostics(status: MinecraftStatus): string {
    const sections = [
      this.formatStatus(status),
      "",
      "**Diagnostics**",
      `Query target: ${config.minecraft.queryHost}:${config.minecraft.queryPort}`,
      `RCON target: ${config.minecraft.rconHost}:${config.minecraft.rconPort}`,
      `Recent logs configured: ${config.minecraft.logPath ? "yes" : "no"}`
    ];

    if (status.recentLogs) {
      sections.push("", "**Recent logs**", codeBlock(truncate(status.recentLogs, 1000), "log"));
    }

    return truncate(sections.join("\n"), 1900);
  }

  private async sendRcon(command: string): Promise<string> {
    const normalized = normalizeCommand(command);
    const task = async () => {
      const rcon = await Rcon.connect({
        host: config.minecraft.rconHost,
        port: config.minecraft.rconPort,
        password: config.minecraft.rconPassword
      });

      try {
        return await rcon.send(normalized);
      } finally {
        rcon.end();
      }
    };

    return withTimeout(task(), config.minecraft.rconTimeoutMs, `RCON command "${normalized}"`);
  }

  private async pingTcp(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host, port, timeout: 2000 }, () => {
        socket.destroy();
        resolve(true);
      });

      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => resolve(false));
    });
  }

  private async tailLog(path: string, lines: number): Promise<string> {
    if (lines === 0) return "";

    const fileStat = await stat(path);
    const bytesToRead = Math.min(fileStat.size, 128 * 1024);
    const start = Math.max(0, fileStat.size - bytesToRead);
    const handle = await open(path, "r");

    try {
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, start);
      return buffer
        .toString("utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-lines)
        .join("\n");
    } finally {
      await handle.close();
    }
  }
}
