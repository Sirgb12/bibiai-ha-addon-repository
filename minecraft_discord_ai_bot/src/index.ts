import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  Interaction,
  Message,
  PermissionsBitField,
  REST,
  Routes
} from "discord.js";
import type { Part } from "@google/genai";
import { config } from "./config.js";
import { GeminiMinecraftAgent, FixPlan } from "./ai/GeminiMinecraftAgent.js";
import { commands } from "./discord/commands.js";
import { EventLogStore } from "./events/EventLogStore.js";
import { MemoryStore } from "./memory/MemoryStore.js";
import { ModerationAction, ModerationService } from "./moderation/ModerationService.js";
import { MinecraftMonitor } from "./minecraft/MinecraftMonitor.js";
import { MinecraftService } from "./minecraft/MinecraftService.js";
import { formatJoinInfo, looksLikeJoinHelpRequest } from "./onboarding/JoinInfo.js";
import { WeeklyReporter } from "./reports/WeeklyReporter.js";
import { splitDiscordText, truncate } from "./util/text.js";

type PendingPlan = {
  id: string;
  ownerId: string;
  title: string;
  commands: FixPlan["commands"];
  createdAt: number;
};

const minecraft = new MinecraftService();
const memory = new MemoryStore();
const events = new EventLogStore();
const moderation = new ModerationService();
const agent = new GeminiMinecraftAgent(minecraft, memory);
const pendingPlans = new Map<string, PendingPlan>();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const minecraftMonitor = new MinecraftMonitor(minecraft, events, sendMinecraftNotice);
const weeklyReporter = new WeeklyReporter(minecraft, events, sendWeeklyReport);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
  console.log(`Persona style loaded: ${config.discord.personaStyle}`);
  await registerSlashCommands();
  minecraftMonitor.start();
  weeklyReporter.start();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error(error);
    await replySafely(interaction, `Something broke while handling that: ${errorMessage(error)}`);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !client.user) return;
    if (!isAllowedChannel(message.channelId)) return;

    const moderationAction = await moderation.moderate(message, client.user.id, hasOperatorAccess(message.member));
    if (moderationAction) {
      await events.record(
        "moderation",
        `Timed out ${moderationAction.username}`,
        `${moderationAction.rule}: ${moderationAction.reason}`,
        {
          userId: moderationAction.userId,
          timeoutMinutes: moderationAction.timeoutMinutes
        }
      );
      await sendModerationNotice(message, moderationAction);
      return;
    }

    if (!message.mentions.has(client.user)) return;

    if (config.onboarding.autoReplyEnabled && looksLikeJoinHelpRequest(message.content)) {
      await message.reply(formatJoinInfo());
      return;
    }

    const prompt = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
      .trim();

    const imageParts = await imagePartsFromAttachments([...message.attachments.values()]);

    if (!prompt && imageParts.length === 0) {
      await message.reply("Tell me what is broken on the server and I will take a look.");
      return;
    }

    await message.channel.sendTyping();
    const answer = await agent.ask(prompt || "Describe the attached image.", {
      allowCommandExecution: hasOperatorAccess(message.member),
      userLabel: userLabel(message.author.id, message.author.username),
      imageParts
    });
    await replyInChunks(message, answer);
  } catch (error) {
    console.error(error);
    await message.reply(`Something broke while handling that: ${errorMessage(error)}`);
  }
});

await client.login(config.discord.token);

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAllowedChannel(interaction.channelId)) {
    await interaction.reply({ content: "This bot is not enabled in this channel.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "ask") {
    await interaction.deferReply();
    const prompt = interaction.options.getString("prompt", true);
    const attachment = interaction.options.getAttachment("image");
    const imageParts = await imagePartsFromAttachments(attachment ? [attachment] : []);
    const answer = await agent.ask(prompt, {
      allowCommandExecution: hasOperatorAccess(interaction.member),
      userLabel: userLabel(interaction.user.id, interaction.user.username),
      imageParts
    });
    await editWithChunks(interaction, answer);
    return;
  }

  if (interaction.commandName === "join") {
    await interaction.reply(formatJoinInfo());
    return;
  }

  if (interaction.commandName === "memory") {
    if (!hasOperatorAccess(interaction.member)) {
      await interaction.reply({ content: "You need an operator role or Manage Server permission.", ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "add") {
      const entry = await memory.add(
        interaction.options.getString("text", true),
        userLabel(interaction.user.id, interaction.user.username),
        interaction.options.getString("category") ?? "general"
      );
      await interaction.reply({ content: `Remembered \`${entry.id}\`: ${entry.text}`, ephemeral: true });
      return;
    }

    if (subcommand === "list") {
      const entries = await memory.list();
      await interaction.reply({
        content: entries.length ? formatMemoryEntries(entries) : "BibiAI has no memories yet.",
        ephemeral: true
      });
      return;
    }

    if (subcommand === "remove") {
      const removed = await memory.remove(interaction.options.getString("id", true));
      await interaction.reply({ content: removed ? "Memory removed." : "No memory with that ID.", ephemeral: true });
      return;
    }

    if (subcommand === "clear") {
      const count = await memory.clear();
      await interaction.reply({ content: `Cleared ${count} memories.`, ephemeral: true });
      return;
    }
  }

  if (interaction.commandName === "mc") {
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "status") {
      await interaction.deferReply();
      const status = await minecraft.getStatus(false);
      await interaction.editReply(minecraft.formatStatus(status));
      return;
    }

    if (subcommand === "diagnostics") {
      if (!hasOperatorAccess(interaction.member)) {
        await interaction.reply({ content: "You need an operator role or Manage Server permission.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const status = await minecraft.getStatus(true);
      await events.record(
        "minecraft_diagnostics",
        `${status.serverName} diagnostics requested`,
        `TCP ${status.tcpOnline ? "online" : "offline"}, RCON ${status.rconOnline ? "online" : "offline"}`,
        { userId: interaction.user.id }
      );
      await interaction.editReply(minecraft.formatDiagnostics(status));
      return;
    }

    if (subcommand === "start") {
      if (!hasOperatorAccess(interaction.member)) {
        await interaction.reply({ content: "You need an operator role or Manage Server permission.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const result = await minecraftMonitor.startServer(`manual start by ${userLabel(interaction.user.id, interaction.user.username)}`);
      await interaction.editReply(result.message);
      return;
    }

    if (subcommand === "recover") {
      if (!hasOperatorAccess(interaction.member)) {
        await interaction.reply({ content: "You need an operator role or Manage Server permission.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const result = await minecraftMonitor.triggerRecovery(`manual request by ${userLabel(interaction.user.id, interaction.user.username)}`);
      await interaction.editReply(result.message);
      return;
    }

    if (subcommand === "fix") {
      if (!hasOperatorAccess(interaction.member)) {
        await interaction.reply({ content: "You need an operator role or Manage Server permission.", ephemeral: true });
        return;
      }

      await interaction.deferReply();
      const issue = interaction.options.getString("issue", true);
      const details = interaction.options.getString("details") ?? "";
      const plan = await agent.createFixPlan(issue, details);
      const id = crypto.randomUUID();
      pendingPlans.set(id, {
        id,
        ownerId: interaction.user.id,
        title: plan.title,
        commands: plan.commands,
        createdAt: Date.now()
      });

      await interaction.editReply({
        content: formatPlan(plan),
        components: buildPlanButtons(id, plan)
      });
      return;
    }
  }

  if (interaction.commandName === "rcon") {
    if (!hasOperatorAccess(interaction.member)) {
      await interaction.reply({ content: "You need an operator role or Manage Server permission.", ephemeral: true });
      return;
    }

    const command = interaction.options.getString("command", true);
    const evaluation = minecraft.evaluate(command);

    if (!evaluation.allowed) {
      await interaction.reply({ content: `Blocked: ${evaluation.reason}`, ephemeral: true });
      return;
    }

    if (evaluation.risk === "needs_confirmation") {
      const id = crypto.randomUUID();
      pendingPlans.set(id, {
        id,
        ownerId: interaction.user.id,
        title: "Manual RCON command",
        commands: [
          {
            command: evaluation.command,
            reason: "Manual operator command.",
            risk: evaluation.risk,
            allowed: true,
            policyReason: evaluation.reason
          }
        ],
        createdAt: Date.now()
      });
      await interaction.reply({
        content: `This needs confirmation before running:\n\`${evaluation.command}\`\n${evaluation.reason}`,
        components: buildConfirmationButtons(id)
      });
      return;
    }

    await interaction.deferReply();
    const result = await minecraft.execute(evaluation.command);
    await interaction.editReply(formatCommandResults([result]));
  }
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const [prefix, action, id] = interaction.customId.split(":");
  if (prefix !== "plan" || !action || !id) return;

  const plan = pendingPlans.get(id);
  if (!plan) {
    await interaction.reply({ content: "That plan expired or was already used.", ephemeral: true });
    return;
  }

  if (!hasOperatorAccess(interaction.member)) {
    await interaction.reply({ content: "You need an operator role or Manage Server permission.", ephemeral: true });
    return;
  }

  if (action === "cancel") {
    pendingPlans.delete(id);
    await interaction.update({ content: `Cancelled **${plan.title}**.`, components: [] });
    return;
  }

  const runnable =
    action === "safe"
      ? plan.commands.filter((command) => command.allowed && (command.risk === "safe" || command.risk === "read"))
      : plan.commands.filter((command) => command.allowed && command.risk !== "blocked");

  if (runnable.length === 0) {
    await interaction.reply({ content: "There are no runnable commands in that plan.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  const results = await minecraft.runCommands(
    runnable.map((command) => command.command),
    { confirmed: action === "confirm" }
  );
  pendingPlans.delete(id);

  await interaction.editReply({
    content: `**${plan.title}**\n${formatCommandResults(results)}`,
    components: []
  });
}

function buildPlanButtons(id: string, plan: FixPlan) {
  const hasSafe = plan.commands.some((command) => command.allowed && (command.risk === "safe" || command.risk === "read"));
  const hasRisky = plan.commands.some((command) => command.allowed && command.risk === "needs_confirmation");

  const row = new ActionRowBuilder<ButtonBuilder>();

  if (hasSafe) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`plan:safe:${id}`)
        .setLabel("Run Safe Commands")
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (hasRisky) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`plan:confirm:${id}`)
        .setLabel("Confirm Risky Commands")
        .setStyle(ButtonStyle.Danger)
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`plan:cancel:${id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row];
}

function buildConfirmationButtons(id: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`plan:confirm:${id}`)
        .setLabel("Confirm Command")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`plan:cancel:${id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function formatPlan(plan: FixPlan): string {
  const commands = plan.commands.length
    ? plan.commands
        .map((command, index) => {
          const status = command.allowed ? command.risk : "blocked";
          return `${index + 1}. \`${command.command}\` (${status}) - ${command.reason}`;
        })
        .join("\n")
    : "No commands recommended.";

  const notes = plan.notes.length ? `\n\nNotes:\n${plan.notes.map((note) => `- ${note}`).join("\n")}` : "";

  return truncate(`**${plan.title}**\n${plan.diagnosis}\n\nCommands:\n${commands}${notes}`, 1900);
}

function formatCommandResults(results: Array<{ command: string; ok: boolean; output: string }>): string {
  return truncate(
    results
      .map((result) => `\`${result.command}\` ${result.ok ? "ok" : "failed"}\n${truncate(result.output, 700)}`)
      .join("\n\n"),
    1900
  );
}

function formatMemoryEntries(entries: Array<{ id: string; category: string; text: string }>): string {
  return truncate(
    entries.map((entry) => `\`${entry.id}\` [${entry.category}] ${entry.text}`).join("\n"),
    1900
  );
}

function isAllowedChannel(channelId: string | null): boolean {
  if (!channelId || config.discord.allowedChannelIds.length === 0) return true;
  return config.discord.allowedChannelIds.includes(channelId);
}

function hasOperatorAccess(member: Interaction["member"]): boolean {
  if (!member) return false;

  if (member instanceof GuildMember) {
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return true;
    return config.discord.adminRoleIds.some((roleId) => member.roles.cache.has(roleId));
  }

  const permissions = BigInt(member.permissions ?? 0);
  const permissionBits = new PermissionsBitField(permissions);
  if (permissionBits.has(PermissionsBitField.Flags.Administrator)) return true;
  if (permissionBits.has(PermissionsBitField.Flags.ManageGuild)) return true;

  const roles = Array.isArray(member.roles) ? member.roles : [];
  return config.discord.adminRoleIds.some((roleId) => roles.includes(roleId));
}

async function editWithChunks(interaction: ChatInputCommandInteraction, text: string): Promise<void> {
  const chunks = splitDiscordText(text);
  await interaction.editReply(chunks[0] ?? "(empty response)");

  for (const chunk of chunks.slice(1)) {
    await interaction.followUp(chunk);
  }
}

async function replyInChunks(message: Message, text: string): Promise<void> {
  const chunks = splitDiscordText(text);
  for (const chunk of chunks.length ? chunks : ["(empty response)"]) {
    await message.reply(chunk);
  }
}

async function sendModerationNotice(message: Message, action: ModerationAction): Promise<void> {
  const channelId = config.moderation.logChannelId ?? message.channelId;
  await sendToDiscordChannel(
    channelId,
    `**BibiAI moderation:** timed out <@${action.userId}> for ${action.timeoutMinutes} minute(s). Rule: ${action.rule}.`
  );
}

async function sendMinecraftNotice(content: string): Promise<void> {
  const channelId = notificationChannelId();
  if (!channelId) {
    console.log(content.replace(/\*\*/g, ""));
    return;
  }

  await sendToDiscordChannel(channelId, content);
}

async function sendWeeklyReport(content: string): Promise<void> {
  const channelId = notificationChannelId();
  if (!channelId) {
    console.log(content.replace(/\*\*/g, ""));
    return;
  }

  await sendToDiscordChannel(channelId, content);
}

function notificationChannelId(): string | undefined {
  return config.minecraft.reportChannelId ?? config.moderation.logChannelId ?? config.discord.allowedChannelIds[0];
}

async function sendToDiscordChannel(channelId: string | undefined, content: string): Promise<boolean> {
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  const sendable = channel as { send?: (options: { content: string; allowedMentions?: { users: string[] } }) => Promise<unknown> } | null;
  if (typeof sendable?.send !== "function") {
    console.warn(`Could not send notification to Discord channel ${channelId}.`);
    return false;
  }

  await sendable.send({
    content: truncate(content, 1900),
    allowedMentions: { users: [] }
  });
  return true;
}

async function replySafely(interaction: Interaction, content: string): Promise<void> {
  if (!interaction.isRepliable()) return;

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, ephemeral: true });
  } else {
    await interaction.reply({ content, ephemeral: true });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function userLabel(id: string, username: string): string {
  return `${username} (${id})`;
}

type DiscordAttachmentLike = {
  url: string;
  name: string | null;
  contentType: string | null;
  size: number;
};

async function imagePartsFromAttachments(attachments: DiscordAttachmentLike[]): Promise<Part[]> {
  const imageAttachments = attachments.filter((attachment) => isImageAttachment(attachment));
  if (imageAttachments.length === 0) return [];

  if (!config.vision.enabled) {
    throw new Error("Image understanding is disabled by VISION_ENABLED=false.");
  }

  const selected = imageAttachments.slice(0, 3);
  const parts: Part[] = [];

  for (const attachment of selected) {
    if (attachment.size > config.vision.maxImageBytes) {
      throw new Error(`Image ${attachment.name ?? attachment.url} is too large. Max is ${config.vision.maxImageBytes} bytes.`);
    }

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Could not download image ${attachment.name ?? attachment.url}: HTTP ${response.status}`);
    }

    const mimeType = response.headers.get("content-type") ?? attachment.contentType ?? inferImageMimeType(attachment.name);
    if (!mimeType?.startsWith("image/")) {
      throw new Error(`Attachment ${attachment.name ?? attachment.url} is not an image.`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    parts.push({
      inlineData: {
        mimeType,
        data: bytes.toString("base64")
      }
    });
  }

  return parts;
}

function isImageAttachment(attachment: DiscordAttachmentLike): boolean {
  if (attachment.contentType?.startsWith("image/")) return true;
  return Boolean(inferImageMimeType(attachment.name));
}

function inferImageMimeType(name: string | null): string | undefined {
  const lowered = name?.toLowerCase();
  if (!lowered) return undefined;
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")) return "image/jpeg";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".gif")) return "image/gif";
  return undefined;
}

async function registerSlashCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discord.token);

  try {
    if (config.discord.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commands }
      );
      console.log(`Registered ${commands.length} guild slash commands for ${config.discord.guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
      console.log(`Registered ${commands.length} global slash commands. Global updates can take a while.`);
    }
  } catch (error) {
    console.error(`Could not register slash commands: ${errorMessage(error)}`);
  }
}
