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
    `Modpack: ${formatLink(config.onboarding.modpackName, config.onboarding.modpackUrl)}`,
    config.onboarding.minecraftVersion ? `Minecraft version: \`${config.onboarding.minecraftVersion}\`` : undefined,
    `Launcher: ${config.onboarding.modpackLoader}`,
    config.onboarding.installGuideUrl ? `Install guide: ${config.onboarding.installGuideUrl}` : undefined,
    config.onboarding.helpChannelId ? `Need help? Ask in <#${config.onboarding.helpChannelId}>.` : undefined,
    "",
    "**Install steps**",
    ...installSteps(),
    config.onboarding.extraNotes ? `\nNotes: ${config.onboarding.extraNotes}` : undefined
  ].filter((line): line is string => Boolean(line));

  return truncate(lines.join("\n"), 1900);
}

export function joinInfoForPrompt(): string {
  return [
    `Server name: ${config.minecraft.serverName}`,
    `Server address: ${config.onboarding.serverAddress || "not configured"}`,
    `Modpack name: ${config.onboarding.modpackName}`,
    `Modpack URL: ${config.onboarding.modpackUrl || "not configured"}`,
    `Minecraft version: ${config.onboarding.minecraftVersion || "not configured"}`,
    `Launcher/modpack loader: ${config.onboarding.modpackLoader}`,
    `Install guide URL: ${config.onboarding.installGuideUrl || "not configured"}`,
    `Help channel ID: ${config.onboarding.helpChannelId || "not configured"}`,
    `Extra notes: ${config.onboarding.extraNotes || "none"}`
  ].join("\n");
}

function installSteps(): string[] {
  const loader = config.onboarding.modpackLoader.toLowerCase();

  if (loader.includes("curse")) {
    return [
      "1. Install the CurseForge app.",
      "2. Open the modpack link, or import the modpack ZIP/profile if an operator gave you one.",
      "3. Click Install, then Play from CurseForge.",
      "4. In Multiplayer, add the server IP above and join."
    ];
  }

  if (loader.includes("modrinth")) {
    return [
      "1. Install the Modrinth app.",
      "2. Open the modpack link and install the profile.",
      "3. Launch the profile from Modrinth.",
      "4. In Multiplayer, add the server IP above and join."
    ];
  }

  if (loader.includes("prism")) {
    return [
      "1. Install Prism Launcher.",
      "2. Add Instance, then import the modpack from the link or ZIP.",
      "3. Launch the imported instance.",
      "4. In Multiplayer, add the server IP above and join."
    ];
  }

  return [
    "1. Install the launcher or mod loader listed above.",
    "2. Install/import the modpack from the link.",
    "3. Launch the modpack profile.",
    "4. In Multiplayer, add the server IP above and join."
  ];
}

function formatLink(label: string, url: string | undefined): string {
  if (!url) return `${label} (_link not configured yet_)`;
  return `[${label}](${url})`;
}
