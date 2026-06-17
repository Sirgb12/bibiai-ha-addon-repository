import { GuildMember, Message, PermissionsBitField } from "discord.js";
import { config } from "../config.js";

export type ModerationAction = {
  userId: string;
  username: string;
  rule: string;
  reason: string;
  timeoutMinutes: number;
};

type ModerationDecision = {
  rule: string;
  reason: string;
  timeoutMinutes: number;
};

const pornPatterns = [
  /\bporn\b/i,
  /\bporno\b/i,
  /\bnsfw\b/i,
  /\bonlyfans\b/i,
  /\bsend nudes\b/i,
  /\bnude(?:s)?\b/i,
  /\brule\s*34\b/i
];

const edatingPatterns = [
  /\bdate me\b/i,
  /\b(?:wanna|want to|anyone want to|who wants to|let's|lets)\s+e[-\s]?date\b/i,
  /\b(?:i want|i need|looking for)\s+(?:an? )?e[-\s]?(?:date|girl|boy)\b/i,
  /\bdiscord kitten\b/i,
  /\bbe my (?:gf|bf|girlfriend|boyfriend)\b/i,
  /\blooking for (?:an? )?e[-\s]?(?:girl|boy)\b/i,
  /\bonline dating\b/i
];

const botInsultPatterns = [
  /\bbad bot\b/i,
  /\bstupid\b/i,
  /\bdumb\b/i,
  /\bidiot\b/i,
  /\bmoron\b/i,
  /\buseless\b/i,
  /\btrash\b/i,
  /\bshut up\b/i
];

const ruleDiscussionPattern = /\b(no|not|stop|don't|dont|against|rule)\s+(?:the\s+)?(?:porn|nsfw|nude(?:s)?|e[-\s]?dating|e[-\s]?date)\b/i;

export class ModerationService {
  private readonly mentionHistory = new Map<string, number[]>();

  async moderate(message: Message, botId: string, isExempt: boolean): Promise<ModerationAction | null> {
    if (!config.moderation.enabled || !message.guild || message.author.bot || isExempt) return null;
    if (!(message.member instanceof GuildMember)) return null;

    const decision = this.decide(message, botId);
    if (!decision) return null;

    const me = message.guild.members.me;
    if (!me?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      console.warn(`Moderation matched ${decision.rule}, but the bot lacks Moderate Members permission.`);
      return null;
    }

    if (!message.member.moderatable) {
      console.warn(`Moderation matched ${decision.rule}, but ${message.author.tag} is not moderatable by the bot.`);
      return null;
    }

    const timeoutMinutes = clamp(
      decision.timeoutMinutes,
      config.moderation.minTimeoutMinutes,
      config.moderation.maxTimeoutMinutes
    );

    await message.member.timeout(
      timeoutMinutes * 60 * 1000,
      `BibiAI moderation: ${decision.reason}`
    );

    return {
      userId: message.author.id,
      username: message.author.username,
      rule: decision.rule,
      reason: decision.reason,
      timeoutMinutes
    };
  }

  private decide(message: Message, botId: string): ModerationDecision | null {
    const content = message.content.trim();
    if (!content) return null;

    const referencesBot = message.mentions.has(botId) || /\bbibiai\b/i.test(content);
    const notRuleDiscussion = !ruleDiscussionPattern.test(content);

    if (referencesBot && this.recordBotReference(message.author.id)) {
      return {
        rule: "spamming BibiAI",
        reason: "Repeatedly pinged or invoked BibiAI in a short window.",
        timeoutMinutes: config.moderation.spamTimeoutMinutes
      };
    }

    if (notRuleDiscussion && pornPatterns.some((pattern) => pattern.test(content))) {
      return {
        rule: "no porn or NSFW content",
        reason: "Matched the server rule against porn/NSFW content.",
        timeoutMinutes: config.moderation.ruleTimeoutMinutes
      };
    }

    if (notRuleDiscussion && edatingPatterns.some((pattern) => pattern.test(content))) {
      return {
        rule: "no edating",
        reason: "Matched the server rule against edating.",
        timeoutMinutes: config.moderation.ruleTimeoutMinutes
      };
    }

    if (referencesBot && botInsultPatterns.some((pattern) => pattern.test(content))) {
      return {
        rule: "offending BibiAI",
        reason: "Directly insulted BibiAI.",
        timeoutMinutes: config.moderation.offenseTimeoutMinutes
      };
    }

    return null;
  }

  private recordBotReference(userId: string): boolean {
    const now = Date.now();
    const windowStart = now - config.moderation.spamWindowMs;
    const hits = (this.mentionHistory.get(userId) ?? []).filter((hit) => hit >= windowStart);
    hits.push(now);
    this.mentionHistory.set(userId, hits);
    return hits.length >= config.moderation.spamMentionLimit;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
