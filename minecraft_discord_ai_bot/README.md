# AI Minecraft Discord Bot

Discord bot that can chat with operators, diagnose a Minecraft server, and run approved Minecraft RCON commands to fix common problems.

It is intentionally not a remote shell. The bot can only use Minecraft RCON, and every command goes through a small policy layer before it reaches the server.

The AI layer uses the Gemini API, so you can start with Google's Gemini free tier for supported models.

## What It Can Do

- `/ask prompt:<text>`: talk to the AI operator. It can check server status, and for authorized operators it can run read/safe commands.
- `/mc status`: check TCP, RCON, players, TPS/MSPT if supported by your server, and version.
- `/mc fix issue:<choice> details:<text>`: generate an AI fix plan with buttons to run safe commands or explicitly confirm risky commands.
- `/rcon command:<command>`: run one allowlisted RCON command as an operator.
- Mention the bot in an enabled channel to chat with it.

Regular users can ask questions and get diagnosis. Only users with one of `BOT_ADMIN_ROLE_IDS`, Administrator, or Manage Server can trigger RCON execution.

## Safety Model

Safe commands can run automatically when the AI uses tools:

- `list`, `tps`, `mspt`, `version`, `weather query`, `time query ...`
- `say ...`
- `save-all`, `save-all flush`
- `weather clear`
- `gamerule doDaylightCycle true`, `time set day/noon/night/midnight`
- `gamerule doWeatherCycle true`
- `whitelist reload`

Risky commands require a Discord button confirmation:

- `kill @e[type=item]` or `kill @e[type=experience_orb]`
- `kick <player>`
- `whitelist add/remove <player>`
- `difficulty <level>`
- `stop`, only when `ALLOW_STOP_COMMAND=true`

Blocked commands include things like `op`, `deop`, `ban`, `give`, `summon`, `execute`, `fill`, `tp`, `save-off`, permission plugin commands, and anything not explicitly allowlisted.

## Requirements

- Node.js 22+
- A Discord application and bot token
- A Gemini API key from Google AI Studio
- Minecraft RCON enabled on the server

## Gemini Setup

1. Open [Google AI Studio](https://aistudio.google.com/).
2. Create or select a project.
3. Create an API key and put it in `.env` as `GEMINI_API_KEY`.
4. Keep `GEMINI_MODEL=gemini-3.5-flash`, or pick another free-tier Flash/Flash-Lite model from AI Studio if this one is not available on your account.

Gemini free-tier availability and limits are model-specific. If the bot gets quota errors, wait for the quota reset or choose a lower-cost/free-tier model.

## Discord Setup

1. Create an app in the Discord Developer Portal.
2. Create a bot and copy the token into `.env`.
3. Enable the Message Content intent if you want mention-based chat. Slash commands do not need it.
4. Invite the bot with these scopes:
   - `bot`
   - `applications.commands`
5. Give it permissions to read/send messages in your operator channel.

## Minecraft RCON Setup

In `server.properties`:

```properties
enable-rcon=true
rcon.port=25575
rcon.password=use-a-long-random-password
```

Restart the Minecraft server after changing those settings.

## Install

```powershell
cd C:\Users\Benmi\Documents\Codex\2026-06-17\make-an-ai-powered-discord-bot\outputs\minecraft-discord-ai-bot
npm.cmd install
copy .env.example .env
```

Edit `.env` and fill in:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `GEMINI_API_KEY`
- `MC_RCON_PASSWORD`

Recommended:

- `DISCORD_GUILD_ID`: your server/guild ID for instant slash command updates while developing.
- `GEMINI_MODEL`: defaults to `gemini-3.5-flash`. If that model is not available on your free tier, set this to a free-tier Flash or Flash-Lite model shown in Google AI Studio.
- `BOT_ALLOWED_CHANNEL_IDS`: comma-separated Discord channel IDs where the bot may respond.
- `BOT_ADMIN_ROLE_IDS`: comma-separated role IDs allowed to use `/mc fix`, `/rcon`, and confirmation buttons.
- `BOT_PERSONA_STYLE`: broad speaking style for the bot. Avoid asking it to impersonate a real living person; use a general style instead.
- `MC_LOG_PATH`: path to `logs/latest.log` for better AI diagnosis.

## Register Commands

```powershell
npm.cmd run register:commands
```

If `DISCORD_GUILD_ID` is set, commands update almost immediately. Global commands can take longer.

## Run

Development:

```powershell
npm.cmd run dev
```

Production:

```powershell
npm.cmd run build
npm.cmd start
```

## Install On Home Assistant OS

HAOS is a managed appliance OS, so do not install Node.js directly on it. Install this project as a local Home Assistant add-on instead.

1. Copy this entire `minecraft-discord-ai-bot` folder to the HAOS add-ons folder:

   ```text
   /addons/minecraft-discord-ai-bot
   ```

   The easiest ways are the Samba share add-on, Studio Code Server add-on, or SSH/Terminal add-on.

2. In Home Assistant, open **Settings -> Add-ons**.

3. Open the add-on store menu and choose **Check for updates** or **Reload**.

4. The local add-on should appear as **Minecraft Discord AI Bot**.

5. Open it, fill in the Configuration tab:

   - `discord_token`
   - `discord_client_id`
   - `gemini_api_key`
   - `mc_rcon_host`
   - `mc_rcon_password`

6. Install and start the add-on.

7. Watch the add-on logs. You want to see `Logged in as ...` and `Registered ... guild slash commands`.

For `mc_rcon_host`, use the LAN IP of the Minecraft server, such as `192.168.1.50`. Do not use `127.0.0.1` unless Minecraft is running inside the same add-on container. If Minecraft is on another Raspberry Pi, PC, or hosting panel, use that machine's local IP or hostname.

If you change the bot source after installing the local add-on, rebuild the add-on from Home Assistant before restarting it. The add-on registers slash commands automatically on startup.

Example persona style:

```yaml
bot_persona_style: "Formal, stern, statesmanlike server operator. Sound like a high-stakes security briefing, but do not impersonate a real person."
```

If Home Assistant keeps removing a long multiline persona from the add-on configuration, put the prompt in this file instead:

```text
/share/bibiai_persona.txt
```

The add-on automatically reads that file on startup. You do not need to keep `bot_persona_file` in the add-on configuration.

## Useful Examples

```text
/mc status
/ask prompt: TPS is low, check status and do safe fixes only.
/mc fix issue:Lag / low TPS details: Players say mobs and item drops are everywhere near spawn.
/rcon command:save-all
```

For restarts, leave `ALLOW_STOP_COMMAND=false` until your server is managed by something that restarts it automatically, such as systemd, Docker restart policy, Pterodactyl, AMP, or a host panel. Then set `ALLOW_STOP_COMMAND=true`; the bot will still require a confirmation button.

## Troubleshooting

- `RCON check failed`: verify `enable-rcon=true`, host, port, firewall, and password.
- Slash commands missing: set `DISCORD_GUILD_ID`, run `npm.cmd run register:commands`, then restart Discord.
- Mention chat ignored: enable Message Content intent in the Discord Developer Portal.
- AI refuses a command: it is probably not allowlisted in `src/minecraft/commandPolicy.ts`.
- `tps` or `mspt` fails: vanilla Minecraft may not support those commands. Paper/Purpur usually do.
