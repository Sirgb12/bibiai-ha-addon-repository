import { GuildMember, Message, PermissionsBitField } from "discord.js";
import { config } from "../config.js";
import { EventLogStore } from "../events/EventLogStore.js";

export type ModerationAction = {
  userId: string;
  username: string;
  rule: string;
  reason: string;
  timeoutMinutes: number;
  severity: ModerationSeverity;
  previousOffenses: number;
  deletedMessage: boolean;
};

type ModerationSeverity = "low" | "medium" | "high" | "critical";

type ModerationDecision = {
  rule: string;
  reason: string;
  severity: ModerationSeverity;
  timeoutMinutes: number;
  deleteMessage: boolean;
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
  /\bfuck\s+(?:you|u|off)\b/i,
  /\bfuck\s+(?:bibiai|this bot|the bot)\b/i,
  /\bscrew\s+(?:you|u|bibiai|this bot|the bot)\b/i,
  /\bfat\s*ass\b/i,
  /\bfatass\b/i,
  /\bfatty\b/i,
  /\bstupid\b/i,
  /\bdumb\b/i,
  /\bidiot\b/i,
  /\bmoron\b/i,
  /\buseless\b/i,
  /\btrash\b/i,
  /\bloser\b/i,
  /\bclown\b/i,
  /\bshut up\b/i
];

const threatPatterns = [
  /\bkill yourself\b/i,
  /\bkys\b/i,
  /\bdoxx?\b/i,
  /\bddos\b/i,
  /\bleak(?:ing)?\s+(?:your|his|her|their)\s+(?:ip|address|phone|number)\b/i,
  /\b(?:i will|i'm gonna|im gonna|gonna)\s+(?:doxx?|ddos)\b/i
];

const scamPatterns = [
  /\bfree\s+nitro\b/i,
  /\bdiscord\.gift\b/i,
  /\bsteamcommunity\.[^\s]+gift\b/i,
  /\bairdrop\b/i
];

const directedHarassmentPatterns = [
  /\b(?:you|u)\s+(?:are|r)\s+(?:stupid|dumb|an idiot|a moron|trash|useless)\b/i,
  /<@!?\d+>\s+(?:is|you are|u are|ur)\s+(?:stupid|dumb|an idiot|a moron|trash|useless)\b/i
];

const ruleDiscussionPattern = /\b(no|not|stop|don't|dont|against|rule)\s+(?:the\s+)?(?:porn|nsfw|nude(?:s)?|e[-\s]?dating|e[-\s]?date)\b/i;

export class ModerationService {
  private readonly mentionHistory = new Map<string, number[]>();
  private readonly messageHistory = new Map<string, Array<{ createdAt: number; content: string }>>();

  constructor(private readonly events?: EventLogStore) {}

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

    const previousOffenses = await this.countPreviousOffenses(message.author.id);
    const finalDecision = this.withVacationEscalation(decision, previousOffenses);
    const timeoutMinutes = clamp(
      finalDecision.timeoutMinutes,
      config.moderation.minTimeoutMinutes,
      vacationModerationEnabled() ? config.vacationModeration.maxTimeoutMinutes : config.moderation.maxTimeoutMinutes
    );

    await message.member.timeout(
      timeoutMinutes * 60 * 1000,
      `BibiAI moderation: ${finalDecision.reason}`
    );

    const deletedMessage = await this.deleteMessageIfNeeded(message, finalDecision);

    return {
      userId: message.author.id,
      username: message.author.username,
      rule: finalDecision.rule,
      reason: finalDecision.reason,
      timeoutMinutes,
      severity: finalDecision.severity,
      previousOffenses,
      deletedMessage
    };
  }

  private decide(message: Message, botId: string): ModerationDecision | null {
    const content = message.content.trim();
    if (!content) return null;

    const referencesBot = message.mentions.has(botId) || /\bbibiai\b/i.test(content);
    const notRuleDiscussion = !ruleDiscussionPattern.test(content);
    const vacationMode = vacationModerationEnabled();

    const blockedTerm = config.vacationModeration.blockedTerms.find((term) =>
      content.toLowerCase().includes(term.toLowerCase())
    );

    if (vacationMode && blockedTerm) {
      return {
        rule: "blocked term",
        reason: "Matched a configured vacation-mode blocked term.",
        severity: "high",
        timeoutMinutes: config.vacationModeration.highTimeoutMinutes,
        deleteMessage: true
      };
    }

    if (vacationMode && threatPatterns.some((pattern) => pattern.test(content))) {
      return {
        rule: "threats, doxxing, or severe harassment",
        reason: "Matched severe harassment, doxxing, or attack language.",
        severity: "critical",
        timeoutMinutes: config.vacationModeration.criticalTimeoutMinutes,
        deleteMessage: true
      };
    }

    if (vacationMode && scamPatterns.some((pattern) => pattern.test(content))) {
      return {
        rule: "scam or suspicious link",
        reason: "Matched scam-like language or suspicious gift bait.",
        severity: "high",
        timeoutMinutes: config.vacationModeration.highTimeoutMinutes,
        deleteMessage: true
      };
    }

    const spamDecision = this.recordMessageAndCheckSpam(message.author.id, content);
    if (vacationMode && spamDecision) return spamDecision;

    if (referencesBot && this.recordBotReference(message.author.id)) {
      return {
        rule: "spamming BibiAI",
        reason: "Repeatedly pinged or invoked BibiAI in a short window.",
        severity: vacationMode ? "medium" : "low",
        timeoutMinutes: vacationMode ? config.vacationModeration.mediumTimeoutMinutes : config.moderation.spamTimeoutMinutes,
        deleteMessage: vacationMode
      };
    }

    if (notRuleDiscussion && pornPatterns.some((pattern) => pattern.test(content))) {
      return {
        rule: "no porn or NSFW content",
        reason: "Matched the server rule against porn/NSFW content.",
        severity: vacationMode ? "high" : "medium",
        timeoutMinutes: vacationMode ? config.vacationModeration.highTimeoutMinutes : config.moderation.ruleTimeoutMinutes,
        deleteMessage: vacationMode
      };
    }

    if (notRuleDiscussion && edatingPatterns.some((pattern) => pattern.test(content))) {
      return {
        rule: "no edating",
        reason: "Matched the server rule against edating.",
        severity: "medium",
        timeoutMinutes: vacationMode ? config.vacationModeration.mediumTimeoutMinutes : config.moderation.ruleTimeoutMinutes,
        deleteMessage: vacationMode
      };
    }

    if (vacationMode && directedHarassmentPatterns.some((pattern) => pattern.test(content))) {
      return {
        rule: "harassment",
        reason: "Matched direct harassment toward another user.",
        severity: "low",
        timeoutMinutes: config.vacationModeration.lowTimeoutMinutes,
        deleteMessage: config.vacationModeration.deleteRulebreakingMessages
      };
    }

    if (referencesBot && botInsultPatterns.some((pattern) => pattern.test(content))) {
      return {
        rule: "offending BibiAI",
        reason: "Directly insulted BibiAI.",
        severity: "low",
        timeoutMinutes: vacationMode ? config.vacationModeration.lowTimeoutMinutes : config.moderation.offenseTimeoutMinutes,
        deleteMessage: false
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

  private recordMessageAndCheckSpam(userId: string, content: string): ModerationDecision | null {
    const now = Date.now();
    const windowStart = now - config.vacationModeration.spamWindowMs;
    const normalized = content.toLowerCase().replace(/\s+/g, " ").trim();
    const history = (this.messageHistory.get(userId) ?? []).filter((item) => item.createdAt >= windowStart);
    history.push({ createdAt: now, content: normalized });
    this.messageHistory.set(userId, history);

    if (history.length >= config.vacationModeration.rapidSpamLimit) {
      return {
        rule: "rapid spam",
        reason: "Sent too many messages in a short window while vacation mode is active.",
        severity: "medium",
        timeoutMinutes: config.vacationModeration.mediumTimeoutMinutes,
        deleteMessage: true
      };
    }

    if (normalized.length >= 5) {
      const duplicateCount = history.filter((item) => item.content === normalized).length;
      if (duplicateCount >= config.vacationModeration.duplicateSpamLimit) {
        return {
          rule: "duplicate spam",
          reason: "Repeated the same message too many times while vacation mode is active.",
          severity: "medium",
          timeoutMinutes: config.vacationModeration.mediumTimeoutMinutes,
          deleteMessage: true
        };
      }
    }

    return null;
  }

  private async countPreviousOffenses(userId: string): Promise<number> {
    if (!this.events || !config.vacationModeration.escalateRepeatOffenses) return 0;

    const since = Date.now() - config.vacationModeration.repeatLookbackDays * 24 * 60 * 60 * 1000;
    const recent = await this.events.since(since);
    return recent.filter((event) => event.type === "moderation" && event.metadata?.userId === userId).length;
  }

  private withVacationEscalation(decision: ModerationDecision, previousOffenses: number): ModerationDecision {
    if (!vacationModerationEnabled() || !config.vacationModeration.escalateRepeatOffenses || previousOffenses === 0) {
      return decision;
    }

    const severity = escalateSeverity(decision.severity, previousOffenses);
    const timeoutMinutes = timeoutForSeverity(severity);
    const escalationNote =
      severity === decision.severity ? "" : ` Escalated for ${previousOffenses} previous moderation action(s).`;

    return {
      ...decision,
      severity,
      timeoutMinutes,
      reason: `${decision.reason}${escalationNote}`
    };
  }

  private async deleteMessageIfNeeded(message: Message, decision: ModerationDecision): Promise<boolean> {
    if (!vacationModerationEnabled()) return false;
    if (!config.vacationModeration.deleteRulebreakingMessages || !decision.deleteMessage) return false;
    if (!message.deletable) return false;

    try {
      await message.delete();
      return true;
    } catch (error) {
      console.warn(`Could not delete moderated message ${message.id}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function vacationModerationEnabled(): boolean {
  return config.vacation.enabled && config.vacationModeration.enabled;
}

function escalateSeverity(severity: ModerationSeverity, previousOffenses: number): ModerationSeverity {
  const levels: ModerationSeverity[] = ["low", "medium", "high", "critical"];
  const bump = previousOffenses >= 4 ? 2 : 1;
  const nextIndex = Math.min(levels.length - 1, levels.indexOf(severity) + bump);
  return levels[nextIndex];
}

function timeoutForSeverity(severity: ModerationSeverity): number {
  if (severity === "critical") return config.vacationModeration.criticalTimeoutMinutes;
  if (severity === "high") return config.vacationModeration.highTimeoutMinutes;
  if (severity === "medium") return config.vacationModeration.mediumTimeoutMinutes;
  return config.vacationModeration.lowTimeoutMinutes;
}
