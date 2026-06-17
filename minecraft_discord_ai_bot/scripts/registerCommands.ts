import "dotenv/config";
import { REST, Routes } from "discord.js";
import { config } from "../src/config.js";
import { commands } from "../src/discord/commands.js";

const rest = new REST({ version: "10" }).setToken(config.discord.token);

if (config.discord.guildId) {
  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body: commands }
  );
  console.log(`Registered ${commands.length} guild commands for ${config.discord.guildId}.`);
} else {
  await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
  console.log(`Registered ${commands.length} global commands. Global updates can take a while.`);
}
