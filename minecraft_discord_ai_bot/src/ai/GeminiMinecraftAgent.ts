import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type Part
} from "@google/genai";
import { z } from "zod";
import { config } from "../config.js";
import { MemoryStore } from "../memory/MemoryStore.js";
import { commandCatalogForPrompt, CommandRisk } from "../minecraft/commandPolicy.js";
import { MinecraftService } from "../minecraft/MinecraftService.js";
import { joinInfoForPrompt } from "../onboarding/JoinInfo.js";
import { parseJsonObject } from "./json.js";

export type FixPlanCommand = {
  command: string;
  reason: string;
  risk: CommandRisk;
  allowed: boolean;
  policyReason: string;
};

export type FixPlan = {
  title: string;
  diagnosis: string;
  commands: FixPlanCommand[];
  notes: string[];
};

const rawFixPlanSchema = z.object({
  title: z.string().min(1).max(80),
  diagnosis: z.string().min(1).max(900),
  commands: z.array(
    z.object({
      command: z.string().min(1).max(200),
      reason: z.string().min(1).max(300)
    })
  ),
  notes: z.array(z.string().max(300)).default([])
});

const fixPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    diagnosis: { type: "string" },
    commands: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          command: { type: "string" },
          reason: { type: "string" }
        },
        required: ["command", "reason"]
      }
    },
    notes: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["title", "diagnosis", "commands", "notes"]
};

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "get_minecraft_status",
    description: "Get current Minecraft server status and optionally recent logs.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        includeRecentLogs: {
          type: "boolean",
          description: "Whether to include recent server log lines."
        }
      },
      required: ["includeRecentLogs"]
    }
  },
  {
    name: "run_minecraft_command",
    description:
      "Run one read or safe Minecraft command through RCON. Commands that need confirmation or are blocked will not execute.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: {
          type: "string",
          description: "A single Minecraft command without a leading slash."
        },
        reason: {
          type: "string",
          description: "Short reason this command helps."
        }
      },
      required: ["command", "reason"]
    }
  },
  {
    name: "remember_fact",
    description:
      "Persist a stable non-secret memory when the user explicitly asks you to remember it or gives lasting server/community context.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
          description: "The non-secret fact to remember."
        },
        category: {
          type: "string",
          enum: ["general", "server", "community", "user", "ops"],
          description: "Memory category."
        }
      },
      required: ["text", "category"]
    }
  }
];

const vacationInfoForPrompt = (): string =>
  [
    `Enabled: ${config.vacation.enabled}`,
    `Expected return: ${config.vacation.returnDate || "not configured"}`,
    `Owner note: ${config.vacation.ownerNote}`,
    `Rules summary: ${config.vacation.rulesSummary}`,
    "If vacation mode is enabled, help with routine Discord/server questions, direct players to /join, remind people of rules, and be clear that serious issues still need a real operator."
  ].join("\n");

export class GeminiMinecraftAgent {
  private readonly client = new GoogleGenAI({ apiKey: config.gemini.apiKey });

  constructor(
    private readonly minecraft: MinecraftService,
    private readonly memory: MemoryStore
  ) {}

  async ask(
    prompt: string,
    options: { allowCommandExecution: boolean; userLabel: string; mediaParts?: Part[] }
  ): Promise<string> {
    const contents: Content[] = [
      {
        role: "user",
        parts: [{ text: prompt }, ...(options.mediaParts ?? [])]
      }
    ];
    let safeCommandsRun = 0;

    for (let step = 0; step < 5; step += 1) {
      const response = await this.client.models.generateContent({
        model: config.gemini.model,
        contents,
        config: {
          systemInstruction: await this.instructions(
            options.allowCommandExecution
              ? ""
              : "This user is not an operator. You may inspect status, but do not execute Minecraft commands. Suggest commands for an operator instead."
          ),
          tools: [{ functionDeclarations: toolDeclarations }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.AUTO
            }
          }
        }
      });

      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) contents.push(modelContent);

      const calls = response.functionCalls ?? [];
      if (calls.length === 0) {
        return response.text || "I got a response, but it did not contain readable text.";
      }

      const functionResponseParts: Part[] = [];
      for (const call of calls) {
        const output = await this.handleToolCall(call, options, safeCommandsRun);
        if (output.countedAsSafeCommand) safeCommandsRun += 1;

        functionResponseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: output.response
          }
        });
      }

      contents.push({
        role: "user",
        parts: functionResponseParts
      });
    }

    return "I hit my tool-call limit while diagnosing that. Try `/mc status`, then ask again with the exact symptom.";
  }

  async summarizeMediaEvidence(context: string, mediaParts: Part[]): Promise<string> {
    if (mediaParts.length === 0) return "";

    const response = await this.client.models.generateContent({
      model: config.gemini.model,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "Review the attached Discord evidence for moderation.",
                "Summarize only rule-relevant behavior visible or audible in the media.",
                "Do not identify private people, guess identities, or invent details.",
                "If the media is unclear, say that briefly.",
                `Report context: ${context}`
              ].join("\n")
            },
            ...mediaParts
          ]
        }
      ],
      config: {
        systemInstruction:
          "You are a concise Discord moderation evidence reviewer. Return one short paragraph under 600 characters."
      }
    });

    return (response.text ?? "").trim().slice(0, 600);
  }

  async createFixPlan(issue: string, details: string): Promise<FixPlan> {
    const status = await this.minecraft.getStatus(true);
    const prompt = [
      "Create a Minecraft server fix plan.",
      `Issue: ${issue}`,
      details ? `Details: ${details}` : "Details: none",
      `Status JSON: ${JSON.stringify(status)}`,
      "",
      "Return only JSON with this shape:",
      '{"title":"short title","diagnosis":"what is probably wrong","commands":[{"command":"single allowlisted command","reason":"why"}],"notes":["operator note"]}',
      "",
      "Only include commands from the command catalog. Prefer the smallest useful plan. Do not include shell commands."
    ].join("\n");

    try {
      const response = await this.client.models.generateContent({
        model: config.gemini.model,
        contents: prompt,
        config: {
          systemInstruction: await this.instructions("Return strict JSON only for fix plans."),
          responseMimeType: "application/json",
          responseJsonSchema: fixPlanJsonSchema
        }
      });

      const parsed = rawFixPlanSchema.parse(parseJsonObject(response.text ?? ""));
      return this.validatePlan(parsed);
    } catch (error) {
      return this.fallbackPlan(issue, error instanceof Error ? error.message : String(error));
    }
  }

  private async handleToolCall(
    call: FunctionCall,
    options: { allowCommandExecution: boolean; userLabel: string },
    safeCommandsRun: number
  ): Promise<{ countedAsSafeCommand: boolean; response: Record<string, unknown> }> {
    const args = call.args ?? {};

    if (call.name === "get_minecraft_status") {
      return {
        countedAsSafeCommand: false,
        response: {
          output: await this.minecraft.getStatus(Boolean(args.includeRecentLogs))
        }
      };
    }

    if (call.name === "remember_fact") {
      try {
        const entry = await this.memory.add(
          String(args.text ?? ""),
          options.userLabel,
          String(args.category ?? "general")
        );

        return {
          countedAsSafeCommand: false,
          response: {
            output: {
              ok: true,
              remembered: entry
            }
          }
        };
      } catch (error) {
        return {
          countedAsSafeCommand: false,
          response: {
            output: {
              ok: false,
              reason: error instanceof Error ? error.message : String(error)
            }
          }
        };
      }
    }

    if (call.name !== "run_minecraft_command") {
      return {
        countedAsSafeCommand: false,
        response: {
          error: `Unknown tool: ${call.name ?? "(unnamed)"}`
        }
      };
    }

    const command = String(args.command ?? "");

    if (!config.safety.autoExecuteSafeCommands) {
      return {
        countedAsSafeCommand: false,
        response: {
          output: {
            ok: false,
            command,
            reason: "AI auto-execution is disabled by AI_AUTO_EXECUTE_SAFE_COMMANDS=false."
          }
        }
      };
    }

    if (!options.allowCommandExecution) {
      return {
        countedAsSafeCommand: false,
        response: {
          output: {
            ok: false,
            command,
            reason: "This Discord user is not authorized to execute Minecraft commands."
          }
        }
      };
    }

    if (safeCommandsRun >= config.minecraft.maxCommandsPerFix) {
      return {
        countedAsSafeCommand: false,
        response: {
          output: {
            ok: false,
            command,
            reason: "Maximum command count reached for this request."
          }
        }
      };
    }

    const evaluation = this.minecraft.evaluate(command);
    if (evaluation.risk !== "safe" && evaluation.risk !== "read") {
      return {
        countedAsSafeCommand: false,
        response: {
          output: {
            ok: false,
            command: evaluation.command,
            risk: evaluation.risk,
            reason: evaluation.reason
          }
        }
      };
    }

    return {
      countedAsSafeCommand: true,
      response: {
        output: await this.minecraft.execute(evaluation.command)
      }
    };
  }

  private async instructions(extra = ""): Promise<string> {
    return [
      "You are an AI Minecraft server operator assistant inside a Discord bot.",
      "Help diagnose and fix common Minecraft server issues through RCON only.",
      "Never invent shell access, never ask for passwords, and never run commands outside the catalog.",
      "You may run only commands whose policy risk is read or safe. Risky commands need human confirmation.",
      "Memory is persistent across restarts. Use remember_fact only when a user explicitly asks you to remember something or provides stable server/community context.",
      "Never store tokens, API keys, passwords, private addresses, or other secrets in memory.",
      "When you act, mention the exact Minecraft commands you ran and the result.",
      "Keep Discord replies concise and practical.",
      "For every natural-language reply you generate, strongly follow the configured speaking style.",
      "Do not merely answer normally; make the tone, phrasing, and framing noticeably match the style while staying concise.",
      `Configured speaking style: ${config.discord.personaStyle}`,
      "",
      "Persistent memory:",
      await this.memory.formatForPrompt(),
      "",
      "New player join information:",
      joinInfoForPrompt(),
      "",
      "Vacation mode:",
      vacationInfoForPrompt(),
      "",
      "Command catalog:",
      commandCatalogForPrompt({
        allowStopCommand: config.safety.allowStopCommand,
        bypassSafety: false
      }),
      extra
    ]
      .filter(Boolean)
      .join("\n");
  }

  private validatePlan(raw: z.infer<typeof rawFixPlanSchema>): FixPlan {
    return {
      title: raw.title,
      diagnosis: raw.diagnosis,
      notes: raw.notes,
      commands: raw.commands.slice(0, config.minecraft.maxCommandsPerFix).map((item) => {
        const evaluation = this.minecraft.evaluate(item.command);
        return {
          command: evaluation.command,
          reason: item.reason,
          risk: evaluation.risk,
          allowed: evaluation.allowed,
          policyReason: evaluation.reason
        };
      })
    };
  }

  private fallbackPlan(issue: string, error: string): FixPlan {
    const normalized = issue.toLowerCase();
    const commands =
      normalized.includes("lag") || normalized.includes("tps")
        ? [
            { command: "list", reason: "Check how many players are online." },
            { command: "tps", reason: "Check whether the server is actually lagging." },
            { command: "kill @e[type=item]", reason: "Clear dropped items if operators confirm loot loss is acceptable." }
          ]
        : normalized.includes("storm") || normalized.includes("weather")
          ? [
              { command: "weather clear", reason: "Clear the current storm." },
              { command: "gamerule doWeatherCycle true", reason: "Make sure weather can cycle naturally again." }
            ]
          : normalized.includes("time") || normalized.includes("day")
            ? [
                { command: "gamerule doDaylightCycle true", reason: "Resume the daylight cycle." },
                { command: "time set day", reason: "Put the world back into daytime." }
              ]
            : normalized.includes("restart")
              ? [
                  { command: "say Server restart requested. Saving world now.", reason: "Warn online players." },
                  { command: "save-all", reason: "Save the world before any restart." },
                  { command: "stop", reason: "Stop the server if a process manager is configured to restart it." }
                ]
              : [
                  { command: "list", reason: "Check online players." },
                  { command: "tps", reason: "Check server tick health." },
                  { command: "save-all", reason: "Take a safe world save before deeper troubleshooting." }
                ];

    return this.validatePlan({
      title: "Fallback fix plan",
      diagnosis: `The AI plan parser failed, so this is a conservative preset. Parser error: ${error}`,
      commands,
      notes: ["Review the commands before running them."]
    });
  }
}
