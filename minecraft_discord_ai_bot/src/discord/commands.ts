import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask the AI Minecraft operator a question.")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("What do you want the bot to diagnose or do?")
        .setRequired(true)
        .setMaxLength(1500)
    )
    .addAttachmentOption((option) =>
      option
        .setName("image")
        .setDescription("Optional image for BibiAI to inspect.")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("mc")
    .setDescription("Minecraft server controls.")
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Check Minecraft server status.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("diagnostics").setDescription("Run deeper Minecraft diagnostics for operators.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("start").setDescription("Start the Minecraft server using the configured panel API.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("recover").setDescription("Trigger the configured Minecraft recovery provider.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("fix")
        .setDescription("Create an AI fix plan and optionally run approved commands.")
        .addStringOption((option) =>
          option
            .setName("issue")
            .setDescription("What is broken?")
            .setRequired(true)
            .addChoices(
              { name: "Lag / low TPS", value: "lag" },
              { name: "Storm or rain stuck", value: "weather" },
              { name: "Time stuck / needs day", value: "time" },
              { name: "Ghost player / connection weirdness", value: "ghost_player" },
              { name: "Save world", value: "save" },
              { name: "Restart server", value: "restart" },
              { name: "Something else", value: "other" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("details")
            .setDescription("Extra context for the AI.")
            .setRequired(false)
            .setMaxLength(1000)
        )
    ),
  new SlashCommandBuilder()
    .setName("rcon")
    .setDescription("Run one allowlisted Minecraft RCON command.")
    .addStringOption((option) =>
      option
        .setName("command")
        .setDescription("Minecraft command without the leading slash.")
        .setRequired(true)
        .setMaxLength(200)
    ),
  new SlashCommandBuilder()
    .setName("memory")
    .setDescription("Manage BibiAI persistent memory.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a non-secret memory.")
        .addStringOption((option) =>
          option
            .setName("text")
            .setDescription("What should BibiAI remember?")
            .setRequired(true)
            .setMaxLength(500)
        )
        .addStringOption((option) =>
          option
            .setName("category")
            .setDescription("Memory category.")
            .setRequired(false)
            .addChoices(
              { name: "General", value: "general" },
              { name: "Server", value: "server" },
              { name: "Community", value: "community" },
              { name: "User", value: "user" },
              { name: "Ops", value: "ops" }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List current memories.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove one memory by ID.")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("Memory ID from /memory list.")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Clear all memories.")
    )
].map((command) => command.toJSON());
