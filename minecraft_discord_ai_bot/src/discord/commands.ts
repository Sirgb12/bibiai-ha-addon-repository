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
    ),
  new SlashCommandBuilder()
    .setName("mc")
    .setDescription("Minecraft server controls.")
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Check Minecraft server status.")
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
    )
].map((command) => command.toJSON());
