import { existsSync } from "node:fs";
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  NoSubscriberBehavior
} from "@discordjs/voice";
import { Client, GuildMember, Message, PermissionsBitField, VoiceBasedChannel } from "discord.js";
import { config } from "../config.js";

export class SholomPlayer {
  private nextAllowedAt = 0;
  private playing = false;
  private randomTimer: NodeJS.Timeout | undefined;

  startRandom(client: Client): void {
    if (!config.sholom.enabled || !config.sholom.randomEnabled || this.randomTimer) return;
    this.scheduleRandom(client);
  }

  async handleMessage(message: Message): Promise<boolean> {
    if (!config.sholom.enabled || message.author.bot || !message.guild) return false;
    if (!this.matchesTrigger(message.content)) return false;

    if (Date.now() < this.nextAllowedAt || this.playing) return true;

    const member = await this.resolveMember(message);
    const voiceChannel = member?.voice.channel;
    if (!voiceChannel) {
      await message.reply(`Say \`${config.sholom.trigger}\` while you are in a voice channel.`);
      return true;
    }

    if (!existsSync(config.sholom.audioPath)) {
      await message.reply(`I cannot find the MP3 file at \`${config.sholom.audioPath}\`.`);
      return true;
    }

    const me = message.guild.members.me ?? (await message.guild.members.fetchMe().catch(() => null));
    const permissions = me ? voiceChannel.permissionsFor(me) : null;
    if (
      !permissions?.has(PermissionsBitField.Flags.Connect) ||
      !permissions.has(PermissionsBitField.Flags.Speak)
    ) {
      await message.reply("I need permission to Connect and Speak in your voice channel.");
      return true;
    }

    this.startCooldown();
    await this.play(voiceChannel.id, message.guild.id, message.guild.voiceAdapterCreator);
    return true;
  }

  private scheduleRandom(client: Client): void {
    const delayMs = randomMinutes(config.sholom.randomMinMinutes, config.sholom.randomMaxMinutes) * 60 * 1000;
    this.randomTimer = setTimeout(() => {
      this.randomTimer = undefined;
      void this.tryRandomPlay(client).finally(() => this.scheduleRandom(client));
    }, delayMs);
    this.randomTimer.unref?.();
  }

  private async tryRandomPlay(client: Client): Promise<void> {
    if (!config.sholom.enabled || !config.sholom.randomEnabled) return;
    if (Date.now() < this.nextAllowedAt || this.playing) return;
    if (!existsSync(config.sholom.audioPath)) {
      console.warn(`Random sholom skipped: MP3 file not found at ${config.sholom.audioPath}.`);
      return;
    }

    const voiceChannel = await this.randomJoinableVoiceChannel(client);
    if (!voiceChannel) return;

    this.startCooldown();
    console.log(`Random sholom joining ${voiceChannel.guild.name} / ${voiceChannel.name}.`);
    await this.play(voiceChannel.id, voiceChannel.guild.id, voiceChannel.guild.voiceAdapterCreator);
  }

  private async play(
    channelId: string,
    guildId: string,
    adapterCreator: Parameters<typeof joinVoiceChannel>[0]["adapterCreator"]
  ): Promise<void> {
    this.playing = true;
    const existing = getVoiceConnection(guildId);
    existing?.destroy();

    const connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator,
      selfDeaf: false
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play
        }
      });
      player.on("error", (error) => {
        console.warn(`Sholom audio playback failed: ${error.message}`);
      });
      const resource = createAudioResource(config.sholom.audioPath);

      connection.subscribe(player);
      player.play(resource);
      await entersState(player, AudioPlayerStatus.Idle, 10 * 60 * 1000);

      if (config.sholom.leaveAfterSeconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.sholom.leaveAfterSeconds * 1000));
      }
    } finally {
      this.playing = false;
      connection.destroy();
    }
  }

  private async resolveMember(message: Message): Promise<GuildMember | null> {
    if (message.member instanceof GuildMember) return message.member;
    return message.guild?.members.fetch(message.author.id).catch(() => null) ?? null;
  }

  private async randomJoinableVoiceChannel(client: Client): Promise<VoiceBasedChannel | undefined> {
    const channels: VoiceBasedChannel[] = [];

    for (const guild of client.guilds.cache.values()) {
      const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
      if (!me) continue;

      for (const channel of guild.channels.cache.values()) {
        if (!channel.isVoiceBased()) continue;
        if (channel.members.filter((member) => !member.user.bot).size === 0) continue;

        const permissions = channel.permissionsFor(me);
        if (!permissions?.has(PermissionsBitField.Flags.Connect)) continue;
        if (!permissions.has(PermissionsBitField.Flags.Speak)) continue;

        channels.push(channel);
      }
    }

    return pickRandom(channels);
  }

  private startCooldown(): void {
    this.nextAllowedAt = Date.now() + config.sholom.cooldownSeconds * 1000;
  }

  private matchesTrigger(content: string): boolean {
    const trigger = escapeRegex(config.sholom.trigger.trim());
    if (!trigger) return false;
    return new RegExp(`(^|[^a-z0-9_])${trigger}([^a-z0-9_]|$)`, "i").test(content);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function randomMinutes(minMinutes: number, maxMinutes: number): number {
  const min = Math.min(minMinutes, maxMinutes);
  const max = Math.max(minMinutes, maxMinutes);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}
