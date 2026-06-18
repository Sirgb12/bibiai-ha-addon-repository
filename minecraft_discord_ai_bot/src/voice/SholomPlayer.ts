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
import { GuildMember, Message, PermissionsBitField } from "discord.js";
import { config } from "../config.js";

export class SholomPlayer {
  private nextAllowedAt = 0;
  private playing = false;

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

    this.nextAllowedAt = Date.now() + config.sholom.cooldownSeconds * 1000;
    await this.play(voiceChannel.id, message.guild.id, message.guild.voiceAdapterCreator);
    return true;
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

  private matchesTrigger(content: string): boolean {
    const trigger = escapeRegex(config.sholom.trigger.trim());
    if (!trigger) return false;
    return new RegExp(`(^|[^a-z0-9_])${trigger}([^a-z0-9_]|$)`, "i").test(content);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
