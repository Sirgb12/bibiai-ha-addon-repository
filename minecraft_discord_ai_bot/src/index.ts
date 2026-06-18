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
import { evaluateSnitchReport, SnitchEvaluation, SnitchHistoryItem } from "./snitch/SnitchEvaluator.js";
import { splitDiscordText, truncate } from "./util/text.js";
import { VacationManager } from "./vacation/VacationManager.js";
import { SholomPlayer } from "./voice/SholomPlayer.js";

type PendingPlan = {
  id: string;
  ownerId: string;
  title: string;
  commands: FixPlan["commands"];
  createdAt: number;
};

type SnitchPunishmentResult = {
  applied: boolean;
  timeoutMinutes?: number;
  skippedReason?: string;
};

type SnitchEvidenceFile = {
  url: string;
  name: string;
  contentType: string;
  size: number;
  kind: "image" | "video";
};

const minecraft = new MinecraftService();
const memory = new MemoryStore();
const events = new EventLogStore();
const moderation = new ModerationService(events);
const agent = new GeminiMinecraftAgent(minecraft, memory);
const pendingPlans = new Map<string, PendingPlan>();
const snitchCooldowns = new Map<string, number>();
const sholomPlayer = new SholomPlayer();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

const minecraftMonitor = new MinecraftMonitor(minecraft, events, sendMinecraftNotice);
const weeklyReporter = new WeeklyReporter(minecraft, events, sendWeeklyReport);
const vacationManager = new VacationManager(minecraft, events, sendVacationReport);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
  console.log(`Persona style loaded: ${config.discord.personaStyle}`);
  await registerSlashCommands();
  minecraftMonitor.start();
  weeklyReporter.start();
  vacationManager.start();
  sholomPlayer.startRandom(readyClient);
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
          timeoutMinutes: moderationAction.timeoutMinutes,
          severity: moderationAction.severity,
          previousOffenses: moderationAction.previousOffenses,
          deletedMessage: moderationAction.deletedMessage
        }
      );
      await sendModerationNotice(message, moderationAction);
      return;
    }

    if (await sholomPlayer.handleMessage(message)) return;

    if (!message.mentions.has(client.user)) return;

    if (config.onboarding.autoReplyEnabled && looksLikeJoinHelpRequest(message.content)) {
      await message.reply(formatJoinInfo());
      return;
    }

    if (
      config.vacation.enabled &&
      config.vacation.autoReplyEnabled &&
      vacationManager.looksLikeVacationHelpRequest(message.content)
    ) {
      await message.reply(vacationManager.formatAutoReply());
      return;
    }

    const prompt = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
      .trim();

    const mediaParts = await mediaPartsFromAttachments([...message.attachments.values()]);

    if (!prompt && mediaParts.length === 0) {
      await message.reply("Tell me what is broken on the server and I will take a look.");
      return;
    }

    await message.channel.sendTyping();
    const answer = await agent.ask(prompt || "Describe the attached media.", {
      allowCommandExecution: hasOperatorAccess(message.member),
      userLabel: userLabel(message.author.id, message.author.username),
      mediaParts
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
    const attachments = [
      interaction.options.getAttachment("image"),
      interaction.options.getAttachment("video")
    ].filter(isPresent);
    const mediaParts = await mediaPartsFromAttachments(attachments);
    const answer = await agent.ask(prompt, {
      allowCommandExecution: hasOperatorAccess(interaction.member),
      userLabel: userLabel(interaction.user.id, interaction.user.username),
      mediaParts
    });
    await editWithChunks(interaction, answer);
    return;
  }

  if (interaction.commandName === "join") {
    await interaction.reply(formatJoinInfo());
    return;
  }

  if (interaction.commandName === "snitch") {
    await handleSnitchCommand(interaction);
    return;
  }

  if (interaction.commandName === "vacation") {
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "status") {
      await interaction.deferReply();
      await interaction.editReply(await vacationManager.formatStatus());
      return;
    }

    if (subcommand === "checkin") {
      if (!hasOperatorAccess(interaction.member)) {
        await interaction.reply({ content: "You need an operator role or Manage Server permission.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      await interaction.editReply(await vacationManager.formatStatus());
      return;
    }
  }

  if (interaction.commandName === "moderation") {
    if (!hasOperatorAccess(interaction.member)) {
      await interaction.reply({ content: "You need an operator role or Manage Server permission.", ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "check") {
      await interaction.deferReply({ ephemeral: true });
      const user = interaction.options.getUser("user", true);
      await interaction.editReply(await formatModerationCheck(interaction, user.id));
      return;
    }
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

async function handleSnitchCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!config.snitching.enabled || !config.snitching.allowUserReports) {
    await interaction.reply({ content: "Snitching is disabled right now.", ephemeral: true });
    return;
  }

  if (!interaction.guild) {
    await interaction.reply({ content: "Snitching only works inside the Discord server.", ephemeral: true });
    return;
  }

  const reporterIsOperator = hasOperatorAccess(interaction.member);
  const cooldownRemaining = reporterIsOperator ? 0 : snitchCooldownRemainingSeconds(interaction.user.id);
  if (cooldownRemaining > 0) {
    await interaction.reply({
      content: `Slow down. You can snitch again in ${cooldownRemaining} second(s).`,
      ephemeral: true
    });
    return;
  }

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true).trim();
  const evidence = interaction.options.getString("evidence")?.trim();
  const evidenceAttachments = [
    interaction.options.getAttachment("evidence_file"),
    interaction.options.getAttachment("evidence_file_2"),
    interaction.options.getAttachment("evidence_file_3")
  ].filter(isPresent);

  if (!reason) {
    await interaction.reply({ content: "Give me a reason. Empty snitching is just paperwork.", ephemeral: true });
    return;
  }

  const unsupportedEvidence = evidenceAttachments.find((attachment) => !isSupportedMediaAttachment(attachment));
  if (unsupportedEvidence) {
    await interaction.reply({
      content: `Evidence attachment ${unsupportedEvidence.name ?? unsupportedEvidence.url} is not a supported image or video file.`,
      ephemeral: true
    });
    return;
  }

  if (targetUser.id === interaction.user.id) {
    await interaction.reply({ content: "You cannot snitch on yourself.", ephemeral: true });
    return;
  }

  if (targetUser.bot) {
    await interaction.reply({ content: "I am not punishing bots through snitch reports.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.editReply("I could not find that member in this server.");
    return;
  }

  const channelId = snitchChannelId() ?? interaction.channelId ?? undefined;
  if (!channelId) {
    await interaction.editReply("No snitch channel is available. Set `snitch_channel_id`.");
    return;
  }

  const evidenceFiles = evidenceFilesFromAttachments(evidenceAttachments);
  const evidenceMediaSummary = await summarizeSnitchEvidenceMedia(reason, evidence, evidenceAttachments);
  const evaluationEvidence = formatEvidenceForEvaluation(evidence, evidenceFiles, evidenceMediaSummary);
  const previousReports = await recentSnitchReportsForTarget(targetUser.id);
  const evaluation = evaluateSnitchReport({
    reason,
    evidence: evaluationEvidence,
    previousReports,
    minTimeoutMinutes: config.snitching.minTimeoutMinutes,
    defaultTimeoutMinutes: config.snitching.timeoutMinutes,
    maxTimeoutMinutes: config.snitching.maxTimeoutMinutes,
    escalateRepeatReports: config.snitching.escalateRepeatReports
  });
  const punishment = await applySnitchPunishment(interaction, targetMember, reason, evaluation);
  rememberSnitchCooldown(interaction.user.id);

  await events.record(
    "snitch_report",
    `Snitch report on ${targetUser.username}`,
    reason,
    {
      reporterId: interaction.user.id,
      targetUserId: targetUser.id,
      evidence,
      evidenceFiles,
      evidenceMediaSummary,
      evaluationEvidence,
      timeoutApplied: punishment.applied,
      timeoutMinutes: punishment.timeoutMinutes,
      skippedReason: punishment.skippedReason,
      severity: evaluation.severity,
      baseSeverity: evaluation.baseSeverity,
      previousReportCount: evaluation.previousReportCount,
      matchedSignals: evaluation.matchedSignals,
      repeatEscalated: evaluation.repeatEscalated,
      recentReasons: evaluation.recentReasons,
      explanation: evaluation.explanation,
      channelId
    }
  );

  const sent = await sendSnitchNotice(channelId, {
    reporterId: interaction.user.id,
    reporterTag: interaction.user.tag,
    targetId: targetUser.id,
    targetTag: targetUser.tag,
    reason,
    evidence,
    evidenceFiles,
    evidenceMediaSummary,
    evaluation,
    punishment
  });

  const confirmation = punishment.applied
    ? `Snitch accepted. <@${targetUser.id}> was timed out for ${punishment.timeoutMinutes} minute(s). Severity: ${evaluation.severity}. ${evaluation.explanation}`
    : `Snitch filed. No timeout was applied: ${punishment.skippedReason}`;

  await interaction.editReply(
    `${confirmation}${sent ? "" : " I could not send the snitch notice to the configured channel."}`
  );
}

async function applySnitchPunishment(
  interaction: ChatInputCommandInteraction,
  targetMember: GuildMember,
  reason: string,
  evaluation: SnitchEvaluation
): Promise<SnitchPunishmentResult> {
  if (!config.snitching.autoPunishEnabled) {
    return { applied: false, skippedReason: "snitch auto-punishment is disabled" };
  }

  if (hasOperatorAccess(targetMember)) {
    return { applied: false, skippedReason: "the reported user has operator/admin access" };
  }

  const me = interaction.guild?.members.me ?? (await interaction.guild?.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
    return { applied: false, skippedReason: "BibiAI lacks Moderate Members permission" };
  }

  if (!targetMember.moderatable) {
    return { applied: false, skippedReason: "BibiAI's role is not high enough to moderate that user" };
  }

  const timeoutMinutes = evaluation.timeoutMinutes;
  await targetMember.timeout(
    timeoutMinutes * 60 * 1000,
    truncate(`BibiAI snitch report by ${interaction.user.tag} (${evaluation.severity}): ${reason}`, 500)
  );

  return { applied: true, timeoutMinutes };
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

async function formatModerationCheck(interaction: ChatInputCommandInteraction, userId: string): Promise<string> {
  if (!interaction.guild) return "This command only works in a server.";

  const target = await interaction.guild.members.fetch(userId).catch(() => null);
  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe().catch(() => null));

  if (!target) return "I could not fetch that member.";

  const lines = [
    `**Moderation check for ${target.user.tag}**`,
    `Moderation enabled: ${config.moderation.enabled ? "yes" : "no"}`,
    `Vacation mode: ${config.vacation.enabled ? "on" : "off"}`,
    `Vacation full moderation: ${config.vacationModeration.enabled ? "on" : "off"}`,
    `Target is bot: ${target.user.bot ? "yes" : "no"}`,
    `Target has operator/admin access: ${hasOperatorAccess(target) ? "yes" : "no"}`,
    `Bot has Moderate Members: ${me?.permissions.has(PermissionsBitField.Flags.ModerateMembers) ? "yes" : "no"}`,
    `Bot has Manage Messages: ${me?.permissions.has(PermissionsBitField.Flags.ManageMessages) ? "yes" : "no"}`,
    `Target moderatable by bot: ${target.moderatable ? "yes" : "no"}`,
    "",
    "If target has operator/admin access or is not moderatable, BibiAI will intentionally not timeout them."
  ];

  return lines.join("\n");
}

async function recentSnitchReportsForTarget(userId: string): Promise<SnitchHistoryItem[]> {
  const since = Date.now() - config.snitching.repeatLookbackDays * 24 * 60 * 60 * 1000;
  const recent = await events.since(since);

  return recent
    .filter((event) => event.type === "snitch_report" && event.metadata?.targetUserId === userId)
    .map((event) => ({
      createdAt: event.createdAt,
      reason: typeof event.details === "string" ? event.details : event.title,
      evidence: evidenceTextFromEventMetadata(event.metadata),
      severity: typeof event.metadata?.severity === "string" ? event.metadata.severity : undefined
    }));
}

function evidenceTextFromEventMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;

  const pieces = [
    typeof metadata.evidence === "string" ? metadata.evidence : undefined,
    typeof metadata.evidenceMediaSummary === "string" ? metadata.evidenceMediaSummary : undefined,
    Array.isArray(metadata.evidenceFiles)
      ? metadata.evidenceFiles
          .map((item) => {
            if (!item || typeof item !== "object") return undefined;
            const file = item as Partial<SnitchEvidenceFile>;
            return [file.kind, file.name, file.contentType].filter(Boolean).join(" ");
          })
          .filter(Boolean)
          .join("\n")
      : undefined
  ].filter(Boolean);

  return pieces.length > 0 ? pieces.join("\n") : undefined;
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
  const channelId = config.snitching.enabled && config.snitching.reportModerationEvents
    ? snitchChannelId() ?? message.channelId
    : config.moderation.logChannelId ?? message.channelId;
  await sendToDiscordChannel(
    channelId,
    [
      `**BibiAI moderation:** timed out <@${action.userId}> for ${action.timeoutMinutes} minute(s).`,
      `Rule: ${action.rule}. Severity: ${action.severity}.`,
      action.previousOffenses > 0 ? `Previous offenses in lookback: ${action.previousOffenses}.` : undefined,
      action.deletedMessage ? "Message deleted." : undefined
    ]
      .filter(Boolean)
      .join(" ")
  );
}

async function sendSnitchNotice(
  channelId: string,
  report: {
    reporterId: string;
    reporterTag: string;
    targetId: string;
    targetTag: string;
    reason: string;
    evidence?: string;
    evidenceFiles: SnitchEvidenceFile[];
    evidenceMediaSummary?: string;
    evaluation: SnitchEvaluation;
    punishment: SnitchPunishmentResult;
  }
): Promise<boolean> {
  return sendToDiscordChannel(
    channelId,
    [
      "**BibiAI snitch report**",
      `Target: <@${report.targetId}> (${report.targetTag}, ${report.targetId})`,
      `Reporter: <@${report.reporterId}> (${report.reporterTag}, ${report.reporterId})`,
      `Reason: ${truncate(report.reason, 700)}`,
      report.evidence ? `Evidence: ${truncate(report.evidence, 300)}` : undefined,
      report.evidenceFiles.length > 0
        ? `Evidence files:\n${report.evidenceFiles.map(formatEvidenceFileForNotice).join("\n")}`
        : undefined,
      report.evidenceMediaSummary ? `Media review: ${truncate(report.evidenceMediaSummary, 700)}` : undefined,
      `Severity: ${report.evaluation.severity}. ${report.evaluation.explanation}`,
      `Matched: ${report.evaluation.matchedSignals.join(", ")}`,
      `Previous snitch reports in lookback: ${report.evaluation.previousReportCount}`,
      report.evaluation.recentReasons.length > 0
        ? `Remembered reasons: ${report.evaluation.recentReasons.map((reason) => truncate(reason, 120)).join(" | ")}`
        : undefined,
      report.punishment.applied
        ? `Action: timed out for ${report.punishment.timeoutMinutes} minute(s).`
        : `Action: no timeout. Reason: ${report.punishment.skippedReason}.`
    ]
      .filter(Boolean)
      .join("\n")
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

async function sendVacationReport(content: string): Promise<void> {
  const channelId = vacationNotificationChannelId();
  if (!channelId) {
    console.log(content.replace(/\*\*/g, ""));
    return;
  }

  await sendToDiscordChannel(channelId, content);
}

function notificationChannelId(): string | undefined {
  return config.minecraft.reportChannelId ?? config.moderation.logChannelId ?? config.discord.allowedChannelIds[0];
}

function vacationNotificationChannelId(): string | undefined {
  return config.vacation.reportChannelId ?? notificationChannelId();
}

function snitchChannelId(): string | undefined {
  return config.snitching.channelId ?? config.moderation.logChannelId ?? config.vacation.reportChannelId ?? config.discord.allowedChannelIds[0];
}

function snitchCooldownRemainingSeconds(userId: string): number {
  const until = snitchCooldowns.get(userId) ?? 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function rememberSnitchCooldown(userId: string): void {
  if (config.snitching.cooldownSeconds <= 0) return;
  snitchCooldowns.set(userId, Date.now() + config.snitching.cooldownSeconds * 1000);
}

function evidenceFilesFromAttachments(attachments: DiscordAttachmentLike[]): SnitchEvidenceFile[] {
  return attachments.map((attachment) => {
    const contentType = mediaMimeTypeForAttachment(attachment) ?? "application/octet-stream";
    const kind = mediaKindFromMimeType(contentType) ?? "image";
    return {
      url: attachment.url,
      name: attachment.name ?? attachment.url,
      contentType,
      size: attachment.size,
      kind
    };
  });
}

async function summarizeSnitchEvidenceMedia(
  reason: string,
  evidence: string | undefined,
  attachments: DiscordAttachmentLike[]
): Promise<string | undefined> {
  if (attachments.length === 0) return undefined;

  try {
    const mediaParts = await mediaPartsFromAttachments(attachments);
    if (mediaParts.length === 0) return undefined;
    const context = [reason, evidence].filter(Boolean).join("\n");
    return (await agent.summarizeMediaEvidence(context, mediaParts)) || undefined;
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`Could not summarize snitch media evidence: ${message}`);
    return `Media review unavailable: ${message}`;
  }
}

function formatEvidenceForEvaluation(
  evidence: string | undefined,
  evidenceFiles: SnitchEvidenceFile[],
  evidenceMediaSummary: string | undefined
): string | undefined {
  const fileText = evidenceFiles
    .map((file) => `${file.kind} evidence ${file.name} ${file.contentType}`)
    .join("\n");
  const pieces = [evidence, fileText, evidenceMediaSummary].filter(Boolean);
  return pieces.length > 0 ? pieces.join("\n") : undefined;
}

function formatEvidenceFileForNotice(file: SnitchEvidenceFile): string {
  return `- ${file.kind}: ${file.name} (${formatBytes(file.size)}, ${file.contentType}) ${file.url}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

type DiscordAttachmentLike = {
  url: string;
  name: string | null;
  contentType: string | null;
  size: number;
};

async function mediaPartsFromAttachments(attachments: DiscordAttachmentLike[]): Promise<Part[]> {
  const mediaAttachments = attachments.filter((attachment) => isSupportedMediaAttachment(attachment));
  if (mediaAttachments.length === 0) return [];

  if (!config.vision.enabled) {
    throw new Error("Media understanding is disabled by VISION_ENABLED=false.");
  }

  const selected = mediaAttachments.slice(0, 3);
  const parts: Part[] = [];

  for (const attachment of selected) {
    const expectedMimeType = mediaMimeTypeForAttachment(attachment);
    const kind = expectedMimeType ? mediaKindFromMimeType(expectedMimeType) : undefined;
    const maxBytes = kind === "video" ? config.vision.maxVideoBytes : config.vision.maxImageBytes;

    if (attachment.size > maxBytes) {
      throw new Error(`${kind ?? "Media"} ${attachment.name ?? attachment.url} is too large. Max is ${maxBytes} bytes.`);
    }

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Could not download media ${attachment.name ?? attachment.url}: HTTP ${response.status}`);
    }

    const responseMimeType = normalizeMimeType(response.headers.get("content-type"));
    const mimeType = mediaKindFromMimeType(responseMimeType) ? responseMimeType : expectedMimeType;
    if (!mimeType || !mediaKindFromMimeType(mimeType)) {
      throw new Error(`Attachment ${attachment.name ?? attachment.url} is not a supported image or video.`);
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

function isSupportedMediaAttachment(attachment: DiscordAttachmentLike): boolean {
  return Boolean(mediaKindFromMimeType(mediaMimeTypeForAttachment(attachment)));
}

function mediaMimeTypeForAttachment(attachment: DiscordAttachmentLike): string | undefined {
  return normalizeMimeType(attachment.contentType) ?? inferMediaMimeType(attachment.name);
}

function normalizeMimeType(mimeType: string | null | undefined): string | undefined {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase();
  return normalized || undefined;
}

function mediaKindFromMimeType(mimeType: string | undefined): "image" | "video" | undefined {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  return undefined;
}

function inferMediaMimeType(name: string | null): string | undefined {
  const lowered = name?.toLowerCase();
  if (!lowered) return undefined;
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")) return "image/jpeg";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".gif")) return "image/gif";
  if (lowered.endsWith(".mp4")) return "video/mp4";
  if (lowered.endsWith(".mov")) return "video/quicktime";
  if (lowered.endsWith(".webm")) return "video/webm";
  if (lowered.endsWith(".mpeg") || lowered.endsWith(".mpg")) return "video/mpeg";
  if (lowered.endsWith(".avi")) return "video/x-msvideo";
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
