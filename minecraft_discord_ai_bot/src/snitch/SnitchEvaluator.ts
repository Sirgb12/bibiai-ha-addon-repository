export type SnitchSeverity = "low" | "medium" | "high" | "critical";

export type SnitchHistoryItem = {
  createdAt: string;
  reason: string;
  evidence?: string;
  severity?: string;
};

export type SnitchEvaluation = {
  severity: SnitchSeverity;
  baseSeverity: SnitchSeverity;
  timeoutMinutes: number;
  previousReportCount: number;
  matchedSignals: string[];
  repeatEscalated: boolean;
  recentReasons: string[];
  explanation: string;
};

type SnitchEvaluationInput = {
  reason: string;
  evidence?: string;
  previousReports: SnitchHistoryItem[];
  minTimeoutMinutes: number;
  defaultTimeoutMinutes: number;
  maxTimeoutMinutes: number;
  escalateRepeatReports: boolean;
};

const severityOrder: SnitchSeverity[] = ["low", "medium", "high", "critical"];

const criticalPatterns = [
  /\bkill yourself\b/i,
  /\bkys\b/i,
  /\bdoxx?\b/i,
  /\bddos\b/i,
  /\bswat(?:ting)?\b/i,
  /\bleak(?:ing)?\s+(?:their|his|her|your|my)?\s*(?:ip|address|phone|number)\b/i,
  /\b(?:death|serious)\s+threat\b/i
];

const highPatterns = [
  /\bporn\b/i,
  /\bporno\b/i,
  /\bnsfw\b/i,
  /\bonlyfans\b/i,
  /\bnude(?:s)?\b/i,
  /\bsend nudes\b/i,
  /\brule\s*34\b/i,
  /\bfree\s+nitro\b/i,
  /\bdiscord\.gift\b/i,
  /\bphishing\b/i,
  /\bscam(?:ming|mer)?\b/i,
  /\bexplicit\b/i
];

const mediumPatterns = [
  /\bspam(?:ming|med)?\b/i,
  /\bflood(?:ing|ed)?\b/i,
  /\brepeated(?:ly)?\s+(?:ping|mention|message)/i,
  /\be[-\s]?dat(?:e|ing)\b/i,
  /\bdiscord kitten\b/i,
  /\bbe my (?:gf|bf|girlfriend|boyfriend)\b/i,
  /\bgrief(?:ing|ed)?\b/i,
  /\bharass(?:ing|ment|ed)?\b/i,
  /\bthreaten(?:ing|ed)?\b/i,
  /\bslur(?:s)?\b/i
];

const lowPatterns = [
  /\binsult(?:ing|ed)?\b/i,
  /\bbad bot\b/i,
  /\bfuck\s+(?:you|u|off|bibiai|this bot|the bot)\b/i,
  /\brude\b/i,
  /\bannoy(?:ing|ed)?\b/i,
  /\bbeing mean\b/i,
  /\bbroke\s+(?:a\s+)?rule\b/i
];

export function evaluateSnitchReport(input: SnitchEvaluationInput): SnitchEvaluation {
  const combined = `${input.reason}\n${input.evidence ?? ""}`.trim();
  const { baseSeverity, matchedSignals } = classifyText(combined);
  const previousReportCount = input.previousReports.length;
  const severity = input.escalateRepeatReports
    ? escalateSeverity(baseSeverity, previousReportCount)
    : baseSeverity;
  const timeoutMinutes = timeoutForSeverity(
    severity,
    input.minTimeoutMinutes,
    input.defaultTimeoutMinutes,
    input.maxTimeoutMinutes
  );
  const repeatEscalated = severity !== baseSeverity;
  const recentReasons = input.previousReports
    .slice(-3)
    .map((report) => report.reason.trim())
    .filter(Boolean);

  return {
    severity,
    baseSeverity,
    timeoutMinutes,
    previousReportCount,
    matchedSignals,
    repeatEscalated,
    recentReasons,
    explanation: formatExplanation(severity, baseSeverity, matchedSignals, previousReportCount, repeatEscalated)
  };
}

function classifyText(text: string): { baseSeverity: SnitchSeverity; matchedSignals: string[] } {
  const matchedSignals: string[] = [];

  if (criticalPatterns.some((pattern) => pattern.test(text))) {
    matchedSignals.push("severe threat, doxxing, DDoS, or personal-info leak language");
    return { baseSeverity: "critical", matchedSignals };
  }

  if (highPatterns.some((pattern) => pattern.test(text))) {
    matchedSignals.push("NSFW/porn, scam, phishing, or explicit-content language");
    return { baseSeverity: "high", matchedSignals };
  }

  if (mediumPatterns.some((pattern) => pattern.test(text))) {
    matchedSignals.push("spam, edating, harassment, griefing, or repeated disruption language");
    return { baseSeverity: "medium", matchedSignals };
  }

  if (lowPatterns.some((pattern) => pattern.test(text))) {
    matchedSignals.push("mild insult, rule-break, or nuisance language");
    return { baseSeverity: "low", matchedSignals };
  }

  matchedSignals.push("general user report without a stronger rule signal");
  return { baseSeverity: "low", matchedSignals };
}

function escalateSeverity(severity: SnitchSeverity, previousReportCount: number): SnitchSeverity {
  if (previousReportCount <= 0) return severity;
  const bump = previousReportCount >= 3 ? 2 : 1;
  const nextIndex = Math.min(severityOrder.length - 1, severityOrder.indexOf(severity) + bump);
  return severityOrder[nextIndex];
}

function timeoutForSeverity(
  severity: SnitchSeverity,
  minTimeoutMinutes: number,
  defaultTimeoutMinutes: number,
  maxTimeoutMinutes: number
): number {
  const min = Math.min(minTimeoutMinutes, maxTimeoutMinutes);
  const max = Math.max(minTimeoutMinutes, maxTimeoutMinutes);
  const medium = clamp(defaultTimeoutMinutes, min, max);
  const high = clamp(Math.max(medium + 1, Math.ceil((medium + max) / 2)), min, max);

  if (severity === "critical") return max;
  if (severity === "high") return high;
  if (severity === "medium") return medium;
  return min;
}

function formatExplanation(
  severity: SnitchSeverity,
  baseSeverity: SnitchSeverity,
  matchedSignals: string[],
  previousReportCount: number,
  repeatEscalated: boolean
): string {
  const signal = matchedSignals[0] ?? "general report";
  const repeat = repeatEscalated
    ? ` Escalated from ${baseSeverity} because this user has ${previousReportCount} previous snitch report(s) in the lookback window.`
    : "";
  return `Classified as ${severity}: ${signal}.${repeat}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
