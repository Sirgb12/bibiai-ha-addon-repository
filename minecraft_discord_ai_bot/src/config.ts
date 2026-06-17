import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const csv = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const cleanOptional = (value: string | undefined): string | undefined => {
  const cleaned = value?.trim();
  if (!cleaned || cleaned.toLowerCase() === "null") return undefined;
  return cleaned;
};

const defaultPersonaStyle = "Clear, practical Minecraft server operator. Be direct, helpful, and calm.";
const defaultPersonaFile = "/share/bibiai_persona.txt";

const loadPersonaStyle = (style: string | undefined, filePath: string | undefined): string => {
  const fileCandidates = [cleanOptional(filePath), defaultPersonaFile].filter(
    (candidate): candidate is string => Boolean(candidate)
  );

  for (const candidate of fileCandidates) {
    if (existsSync(candidate)) {
      const fileStyle = readFileSync(candidate, "utf8").trim();
      if (fileStyle) return fileStyle;
    }
  }

  return cleanOptional(style) ?? defaultPersonaStyle;
};

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  BOT_PERSONA_STYLE: z.string().max(5000).optional(),
  BOT_PERSONA_FILE: z.string().optional(),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  BOT_ALLOWED_CHANNEL_IDS: z.string().optional(),
  BOT_ADMIN_ROLE_IDS: z.string().optional(),
  MC_SERVER_NAME: z.string().default("Minecraft"),
  MC_RCON_HOST: z.string().default("127.0.0.1"),
  MC_RCON_PORT: z.coerce.number().int().min(1).max(65535).default(25575),
  MC_RCON_PASSWORD: z.string().min(1),
  MC_QUERY_HOST: z.string().optional(),
  MC_QUERY_PORT: z.coerce.number().int().min(1).max(65535).default(25565),
  MC_LOG_PATH: z.string().optional(),
  STATUS_LOG_LINES: z.coerce.number().int().min(0).max(500).default(80),
  AI_AUTO_EXECUTE_SAFE_COMMANDS: z.string().optional(),
  ALLOW_STOP_COMMAND: z.string().optional(),
  BYPASS_RCON_SAFETY: z.string().optional(),
  MAX_COMMANDS_PER_FIX: z.coerce.number().int().min(1).max(12).default(6),
  RCON_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000)
});

const env = envSchema.parse(process.env);

export const config = {
  discord: {
    token: env.DISCORD_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
    guildId: env.DISCORD_GUILD_ID?.trim() || undefined,
    allowedChannelIds: csv(env.BOT_ALLOWED_CHANNEL_IDS),
    adminRoleIds: csv(env.BOT_ADMIN_ROLE_IDS),
    personaStyle: loadPersonaStyle(env.BOT_PERSONA_STYLE, env.BOT_PERSONA_FILE)
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL
  },
  minecraft: {
    serverName: env.MC_SERVER_NAME,
    rconHost: env.MC_RCON_HOST,
    rconPort: env.MC_RCON_PORT,
    rconPassword: env.MC_RCON_PASSWORD,
    queryHost: env.MC_QUERY_HOST?.trim() || env.MC_RCON_HOST,
    queryPort: env.MC_QUERY_PORT,
    logPath: env.MC_LOG_PATH?.trim() || undefined,
    statusLogLines: env.STATUS_LOG_LINES,
    rconTimeoutMs: env.RCON_TIMEOUT_MS,
    maxCommandsPerFix: env.MAX_COMMANDS_PER_FIX
  },
  safety: {
    autoExecuteSafeCommands: boolFromEnv(env.AI_AUTO_EXECUTE_SAFE_COMMANDS, true),
    allowStopCommand: boolFromEnv(env.ALLOW_STOP_COMMAND, false),
    bypassRconSafety: boolFromEnv(env.BYPASS_RCON_SAFETY, false)
  }
} as const;

export type AppConfig = typeof config;
