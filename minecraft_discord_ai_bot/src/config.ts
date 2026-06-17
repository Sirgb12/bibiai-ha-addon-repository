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
  MEMORY_ENABLED: z.string().optional(),
  MEMORY_PATH: z.string().default("/data/bibiai-memory.json"),
  MAX_MEMORY_ITEMS: z.coerce.number().int().min(1).max(200).default(40),
  MAX_MEMORY_ENTRY_LENGTH: z.coerce.number().int().min(80).max(2000).default(500),
  VISION_ENABLED: z.string().optional(),
  MAX_IMAGE_BYTES: z.coerce.number().int().min(1024).max(20 * 1024 * 1024).default(8 * 1024 * 1024),
  MODERATION_ENABLED: z.string().optional(),
  MODERATION_LOG_CHANNEL_ID: z.string().optional(),
  MODERATION_MIN_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(5).default(1),
  MODERATION_MAX_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(5).default(5),
  MODERATION_RULE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(5).default(5),
  MODERATION_OFFENSE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(5).default(1),
  MODERATION_SPAM_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(5).default(2),
  SPAM_BIBIAI_WINDOW_MS: z.coerce.number().int().min(5000).max(300000).default(30000),
  SPAM_BIBIAI_LIMIT: z.coerce.number().int().min(2).max(20).default(4),
  EVENT_LOG_PATH: z.string().default("/data/bibiai-events.json"),
  EVENT_LOG_RETENTION_DAYS: z.coerce.number().int().min(7).max(365).default(60),
  EVENT_LOG_MAX_ITEMS: z.coerce.number().int().min(50).max(5000).default(500),
  MC_MONITOR_ENABLED: z.string().optional(),
  MC_MONITOR_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
  MC_RECOVERY_ENABLED: z.string().optional(),
  MC_RECOVERY_WEBHOOK_URL: z.string().optional(),
  MC_RECOVERY_WEBHOOK_METHOD: z.enum(["POST", "GET"]).default("POST"),
  MC_RECOVERY_OFFLINE_CHECKS: z.coerce.number().int().min(1).max(20).default(2),
  PEBBLEHOST_API_ENABLED: z.string().optional(),
  PEBBLEHOST_API_TOKEN: z.string().optional(),
  PEBBLEHOST_SERVER_ID: z.string().optional(),
  PEBBLEHOST_RECOVERY_SIGNAL: z.enum(["start", "restart"]).default("start"),
  PEBBLEHOST_API_BASE_URL: z.string().default("https://panel.pebblehost.com"),
  JOIN_SERVER_ADDRESS: z.string().optional(),
  JOIN_MODPACK_NAME: z.string().default("Server modpack"),
  JOIN_MODPACK_URL: z.string().optional(),
  JOIN_MODPACK_LOADER: z.string().default("CurseForge"),
  JOIN_MINECRAFT_VERSION: z.string().optional(),
  JOIN_INSTALL_GUIDE_URL: z.string().optional(),
  JOIN_HELP_CHANNEL_ID: z.string().optional(),
  JOIN_EXTRA_NOTES: z.string().max(1000).optional(),
  JOIN_AUTO_REPLY_ENABLED: z.string().optional(),
  MINECRAFT_REPORT_CHANNEL_ID: z.string().optional(),
  WEEKLY_REPORT_ENABLED: z.string().optional(),
  WEEKLY_REPORT_DAY: z
    .enum(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"])
    .default("sunday"),
  WEEKLY_REPORT_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(18),
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
    maxCommandsPerFix: env.MAX_COMMANDS_PER_FIX,
    monitorEnabled: boolFromEnv(env.MC_MONITOR_ENABLED, true),
    monitorIntervalMinutes: env.MC_MONITOR_INTERVAL_MINUTES,
    recoveryEnabled: boolFromEnv(env.MC_RECOVERY_ENABLED, false),
    recoveryWebhookUrl: cleanOptional(env.MC_RECOVERY_WEBHOOK_URL),
    recoveryWebhookMethod: env.MC_RECOVERY_WEBHOOK_METHOD,
    recoveryOfflineChecks: env.MC_RECOVERY_OFFLINE_CHECKS,
    reportChannelId: cleanOptional(env.MINECRAFT_REPORT_CHANNEL_ID)
  },
  pebblehost: {
    enabled: boolFromEnv(env.PEBBLEHOST_API_ENABLED, false),
    apiToken: cleanOptional(env.PEBBLEHOST_API_TOKEN),
    serverId: cleanOptional(env.PEBBLEHOST_SERVER_ID),
    recoverySignal: env.PEBBLEHOST_RECOVERY_SIGNAL,
    apiBaseUrl: env.PEBBLEHOST_API_BASE_URL
  },
  onboarding: {
    serverAddress: cleanOptional(env.JOIN_SERVER_ADDRESS),
    modpackName: cleanOptional(env.JOIN_MODPACK_NAME) ?? "Server modpack",
    modpackUrl: cleanOptional(env.JOIN_MODPACK_URL),
    modpackLoader: cleanOptional(env.JOIN_MODPACK_LOADER) ?? "CurseForge",
    minecraftVersion: cleanOptional(env.JOIN_MINECRAFT_VERSION),
    installGuideUrl: cleanOptional(env.JOIN_INSTALL_GUIDE_URL),
    helpChannelId: cleanOptional(env.JOIN_HELP_CHANNEL_ID),
    extraNotes: cleanOptional(env.JOIN_EXTRA_NOTES),
    autoReplyEnabled: boolFromEnv(env.JOIN_AUTO_REPLY_ENABLED, true)
  },
  memory: {
    enabled: boolFromEnv(env.MEMORY_ENABLED, true),
    path: env.MEMORY_PATH,
    maxItems: env.MAX_MEMORY_ITEMS,
    maxEntryLength: env.MAX_MEMORY_ENTRY_LENGTH
  },
  vision: {
    enabled: boolFromEnv(env.VISION_ENABLED, true),
    maxImageBytes: env.MAX_IMAGE_BYTES
  },
  moderation: {
    enabled: boolFromEnv(env.MODERATION_ENABLED, true),
    logChannelId: cleanOptional(env.MODERATION_LOG_CHANNEL_ID),
    minTimeoutMinutes: env.MODERATION_MIN_TIMEOUT_MINUTES,
    maxTimeoutMinutes: env.MODERATION_MAX_TIMEOUT_MINUTES,
    ruleTimeoutMinutes: env.MODERATION_RULE_TIMEOUT_MINUTES,
    offenseTimeoutMinutes: env.MODERATION_OFFENSE_TIMEOUT_MINUTES,
    spamTimeoutMinutes: env.MODERATION_SPAM_TIMEOUT_MINUTES,
    spamWindowMs: env.SPAM_BIBIAI_WINDOW_MS,
    spamMentionLimit: env.SPAM_BIBIAI_LIMIT
  },
  events: {
    path: env.EVENT_LOG_PATH,
    retentionDays: env.EVENT_LOG_RETENTION_DAYS,
    maxItems: env.EVENT_LOG_MAX_ITEMS
  },
  weeklyReport: {
    enabled: boolFromEnv(env.WEEKLY_REPORT_ENABLED, true),
    day: env.WEEKLY_REPORT_DAY,
    hourUtc: env.WEEKLY_REPORT_HOUR_UTC
  },
  safety: {
    autoExecuteSafeCommands: boolFromEnv(env.AI_AUTO_EXECUTE_SAFE_COMMANDS, true),
    allowStopCommand: boolFromEnv(env.ALLOW_STOP_COMMAND, false),
    bypassRconSafety: boolFromEnv(env.BYPASS_RCON_SAFETY, false)
  }
} as const;

export type AppConfig = typeof config;
