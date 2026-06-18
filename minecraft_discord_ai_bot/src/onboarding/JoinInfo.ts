import { config } from "../config.js";
import { truncate } from "../util/text.js";

const joinQuestionPatterns = [
  /\bhow\s+do\s+i\s+join\b/i,
  /\bhow\s+to\s+join\b/i,
  /\bjoin\s+(?:the\s+)?(?:server|smp)\b/i,
  /\bserver\s+ip\b/i,
  /\bwhat(?:'s| is)\s+the\s+ip\b/i,
  /\bmod\s*pack\b/i,
  /\bmodpack\b/i,
  /\binstall\s+(?:the\s+)?mods?\b/i,
  /\binstall\s+(?:the\s+)?mod\s*pack\b/i
];

export function looksLikeJoinHelpRequest(text: string): boolean {
  return joinQuestionPatterns.some((pattern) => pattern.test(text));
}

export function formatJoinInfo(): string {
  const lines = [
    `**How to join ${config.minecraft.serverName}**`,
    "",
    `Server IP: ${config.onboarding.serverAddress ? `\`${config.onboarding.serverAddress}\`` : "_Not configured yet. Ask an operator for the IP._"}`,
    "**Modpack downloads**",
    `- Modrinth: ${formatLink(config.onboarding.modpackName, config.onboarding.modrinthModpackUrl ?? config.onboarding.modpackUrl)}`,
    `- CurseForge: ${formatLink(config.onboarding.modpackName, config.onboarding.curseforgeModpackUrl ?? config.onboarding.modpackUrl)}`,
    config.onboarding.minecraftVersion ? `Minecraft version: \`${config.onboarding.minecraftVersion}\`` : undefined,
    `Launchers: ${config.onboarding.modpackLoader}`,
    config.onboarding.installGuideUrl ? `Install guide: ${config.onboarding.installGuideUrl}` : undefined,
    config.onboarding.helpChannelId ? `Need help? Ask in <#${config.onboarding.helpChannelId}>.` : undefined,
    "",
    "**Modrinth install**",
    ...modrinthInstallSteps(),
    "",
    "**CurseForge install**",
    ...curseForgeInstallSteps(),
    config.onboarding.extraNotes ? `\nNotes: ${config.onboarding.extraNotes}` : undefined
  ].filter((line): line is string => Boolean(line));

  return truncate(lines.join("\n"), 1900);
}

export function joinInfoForPrompt(): string {
  return [
    `Server name: ${config.minecraft.serverName}`,
    `Server address: ${config.onboarding.serverAddress || "not configured"}`,
    `Modpack name: ${config.onboarding.modpackName}`,
    `Generic modpack URL: ${config.onboarding.modpackUrl || "not configured"}`,
    `Modrinth modpack URL: ${config.onboarding.modrinthModpackUrl || "not configured"}`,
    `CurseForge modpack URL: ${config.onboarding.curseforgeModpackUrl || "not configured"}`,
    `Minecraft version: ${config.onboarding.minecraftVersion || "not configured"}`,
    `Launcher/modpack loader: ${config.onboarding.modpackLoader}`,
    `Install guide URL: ${config.onboarding.installGuideUrl || "not configured"}`,
    `Help channel ID: ${config.onboarding.helpChannelId || "not configured"}`,
    `Extra notes: ${config.onboarding.extraNotes || "none"}`
  ].join("\n");
}

function modrinthInstallSteps(): string[] {
  return [
    "1. Install the Modrinth App.",
    "2. Download the Modrinth modpack file from the link above.",
    "3. In Modrinth, create/import an instance from the downloaded file.",
    "4. Launch that instance.",
    "5. In Multiplayer, add the server IP above and join."
  ];
}

function curseForgeInstallSteps(): string[] {
  return [
    "1. Install the CurseForge app.",
    "2. Download the CurseForge modpack ZIP from the link above.",
    "3. In CurseForge, go to Minecraft, choose Create Custom Profile, then Import the ZIP.",
    "4. Download the Origins Legacy Classes mod from Modrinth's website.",
    "5. Open the imported pack's folder, drag Origins Legacy Classes into the mods folder, then launch.",
    "6. In Multiplayer, add the server IP above and join."
  ];
}

function formatLink(label: string, url: string | undefined): string {
  if (!url) return `${label} (_link not configured yet_)`;
  return `[${label}](${url})`;
}
