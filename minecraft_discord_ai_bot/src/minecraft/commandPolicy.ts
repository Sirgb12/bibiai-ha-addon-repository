export type CommandRisk = "read" | "safe" | "needs_confirmation" | "blocked";

export type CommandRule = {
  id: string;
  risk: Exclude<CommandRisk, "blocked">;
  description: string;
  examples: string[];
  pattern: RegExp;
  requiresStopOptIn?: boolean;
};

export type CommandEvaluation = {
  command: string;
  allowed: boolean;
  risk: CommandRisk;
  reason: string;
  rule?: CommandRule;
};

export type PolicyOptions = {
  allowStopCommand: boolean;
  bypassSafety: boolean;
};

const rules: CommandRule[] = [
  {
    id: "read_server",
    risk: "read",
    description: "Read basic server state.",
    examples: ["list", "tps", "mspt", "version", "weather query", "time query gametime"],
    pattern: /^(list|tps|mspt|version|plugins|weather query|time query (gametime|daytime|day))$/i
  },
  {
    id: "broadcast",
    risk: "safe",
    description: "Broadcast a short message to players.",
    examples: ["say Server maintenance in 60 seconds."],
    pattern: /^say [\s\S]{1,200}$/i
  },
  {
    id: "save_world",
    risk: "safe",
    description: "Save the world to disk.",
    examples: ["save-all", "save-all flush"],
    pattern: /^save-all( flush)?$/i
  },
  {
    id: "clear_weather",
    risk: "safe",
    description: "Clear storms and rain.",
    examples: ["weather clear", "weather clear 6000"],
    pattern: /^weather clear( \d{1,7})?$/i
  },
  {
    id: "fix_daylight_cycle",
    risk: "safe",
    description: "Resume the day cycle or set a simple time.",
    examples: ["gamerule doDaylightCycle true", "time set day"],
    pattern: /^(gamerule doDaylightCycle true|time set (day|noon|night|midnight|\d{1,7}))$/i
  },
  {
    id: "fix_weather_cycle",
    risk: "safe",
    description: "Resume natural weather cycling.",
    examples: ["gamerule doWeatherCycle true"],
    pattern: /^gamerule doWeatherCycle true$/i
  },
  {
    id: "reload_whitelist",
    risk: "safe",
    description: "Reload whitelist data from disk.",
    examples: ["whitelist reload"],
    pattern: /^whitelist reload$/i
  },
  {
    id: "cleanup_drops",
    risk: "needs_confirmation",
    description: "Delete dropped item or XP entities. This can remove player loot.",
    examples: ["kill @e[type=item]", "kill @e[type=minecraft:experience_orb]"],
    pattern: /^kill @e\[type=(minecraft:)?(item|experience_orb|xp_orb)\]$/i
  },
  {
    id: "kick_player",
    risk: "needs_confirmation",
    description: "Kick one named player.",
    examples: ["kick Steve Relog to fix ghost session"],
    pattern: /^kick [A-Za-z0-9_]{3,16}( [\s\S]{1,120})?$/i
  },
  {
    id: "whitelist_edit",
    risk: "needs_confirmation",
    description: "Add or remove one player from the whitelist.",
    examples: ["whitelist add Steve", "whitelist remove Steve"],
    pattern: /^whitelist (add|remove) [A-Za-z0-9_]{3,16}$/i
  },
  {
    id: "difficulty",
    risk: "needs_confirmation",
    description: "Change world difficulty.",
    examples: ["difficulty normal"],
    pattern: /^difficulty (peaceful|easy|normal|hard)$/i
  },
  {
    id: "stop_server",
    risk: "needs_confirmation",
    description: "Stop the server. Use a process manager to bring it back up.",
    examples: ["stop"],
    pattern: /^stop$/i,
    requiresStopOptIn: true
  }
];

const hardBlockedPatterns = [
  /^op\b/i,
  /^deop\b/i,
  /^ban(-ip)?\b/i,
  /^pardon(-ip)?\b/i,
  /^save-off\b/i,
  /^execute\b/i,
  /^function\b/i,
  /^data\b/i,
  /^scoreboard\b/i,
  /^team\b/i,
  /^give\b/i,
  /^summon\b/i,
  /^tp\b/i,
  /^teleport\b/i,
  /^fill\b/i,
  /^setblock\b/i,
  /^clone\b/i,
  /^reload\b/i,
  /^minecraft:reload\b/i,
  /^luckperms\b/i,
  /^lp\b/i,
  /^permission\b/i,
  /^whitelist off\b/i
];

export const normalizeCommand = (command: string): string =>
  command.trim().replace(/^\//, "").replace(/\s+/g, " ");

export const evaluateCommand = (
  rawCommand: string,
  options: PolicyOptions
): CommandEvaluation => {
  const command = normalizeCommand(rawCommand);

  if (!command) {
    return {
      command,
      allowed: false,
      risk: "blocked",
      reason: "Empty command."
    };
  }

  if (/[\r\n;&|`$<>]/.test(command)) {
    return {
      command,
      allowed: false,
      risk: "blocked",
      reason: "Command separators and shell-like characters are not allowed."
    };
  }

  if (options.bypassSafety) {
    return {
      command,
      allowed: true,
      risk: "needs_confirmation",
      reason: "Safety bypass is enabled; this still requires an explicit Discord confirmation."
    };
  }

  if (hardBlockedPatterns.some((pattern) => pattern.test(command))) {
    return {
      command,
      allowed: false,
      risk: "blocked",
      reason: "This command is blocked by policy."
    };
  }

  const rule = rules.find((candidate) => candidate.pattern.test(command));
  if (!rule) {
    return {
      command,
      allowed: false,
      risk: "blocked",
      reason: "This command is not in the bot allowlist."
    };
  }

  if (rule.requiresStopOptIn && !options.allowStopCommand) {
    return {
      command,
      allowed: false,
      risk: "blocked",
      rule,
      reason: "The stop command is disabled. Set ALLOW_STOP_COMMAND=true if your server has a process manager."
    };
  }

  return {
    command,
    allowed: true,
    risk: rule.risk,
    rule,
    reason: rule.description
  };
};

export const commandCatalogForPrompt = (options: PolicyOptions): string => {
  const visibleRules = rules.filter((rule) => !rule.requiresStopOptIn || options.allowStopCommand);

  return visibleRules
    .map((rule) => {
      const examples = rule.examples.map((example) => `\`${example}\``).join(", ");
      return `- ${rule.id} (${rule.risk}): ${rule.description} Examples: ${examples}`;
    })
    .join("\n");
};
