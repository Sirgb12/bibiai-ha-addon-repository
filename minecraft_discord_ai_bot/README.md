# AI Minecraft Discord Bot

Discord bot that can chat with operators, diagnose a Minecraft server, and run approved Minecraft RCON commands to fix common problems.

It is intentionally not a remote shell. The bot can only use Minecraft RCON, and every command goes through a small policy layer before it reaches the server.

The AI layer uses the Gemini API, so you can start with Google's Gemini free tier for supported models.

## What It Can Do

- `/ask prompt:<text>`: talk to the AI operator. It can inspect attached images/videos, check server status, and for authorized operators it can run read/safe commands.
- `/join`: show the server IP, modpack link, and install steps for new players.
- `/snitch user:<user> reason:<text>`: let a member report someone to BibiAI. BibiAI remembers report reasons/evidence, accepts image/video evidence, classifies severity, and applies a short timeout if it can safely moderate that user.
- Say `sholom` in an enabled text channel while you are in a voice channel, and BibiAI joins your voice channel to play the configured MP3.
- `/mc status`: check TCP, RCON, players, TPS/MSPT if supported by your server, and version.
- `/mc diagnostics`: run deeper operator-only diagnostics, including recent logs when `MC_LOG_PATH` is configured.
- `/mc start`: start the server through the configured PebbleHost panel API.
- `/mc recover`: trigger the configured recovery provider, such as PebbleHost or an external webhook.
- `/mc fix issue:<choice> details:<text>`: generate an AI fix plan with buttons to run safe commands or explicitly confirm risky commands.
- `/rcon command:<command>`: run one allowlisted RCON command as an operator.
- `/memory add/list/remove/clear`: manage persistent BibiAI memory.
- `/vacation status/checkin`: show vacation mode status and operator check-ins.
- `/moderation check user:<user>`: operator-only check for timeout/delete permissions and role hierarchy.
- Mention the bot in an enabled channel to chat with it.
- Attach an image or short video to `/ask` or to a bot mention and BibiAI can inspect it with Gemini vision.
- Short Discord timeouts for obvious rule breaks: no porn/NSFW content, no edating, and no spamming BibiAI.
- Minecraft monitor alerts, optional PebbleHost/API recovery calls, and weekly bot-observed server reports.
- Vacation mode for stronger moderation, daily status reports, rule reminders, and basic Discord/server stewardship while the owner is away.

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
5. Give it these permissions:
   - View Channels
   - Send Messages
   - Read Message History
   - Use Slash Commands
   - Moderate Members, only if you want short timeout moderation
   - Manage Messages, only if you want BibiAI to delete rule-breaking messages during vacation mode
   - Connect and Speak, only if you want the `sholom` voice trigger

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
- `SHOLOM_ENABLED`: enables the voice-channel MP3 trigger.
- `SHOLOM_TRIGGER`: word that starts playback. Defaults to `sholom`.
- `SHOLOM_AUDIO_PATH`: MP3 file path. Defaults to `/share/bibiai_sholom.mp3`.
- `SHOLOM_COOLDOWN_SECONDS`: cooldown between plays. Defaults to 120 seconds.
- `SHOLOM_LEAVE_AFTER_SECONDS`: seconds to wait after the song before leaving voice. Defaults to 10.
- `MC_LOG_PATH`: path to `logs/latest.log` for better AI diagnosis.
- `MEMORY_ENABLED`: enables persistent memory. Defaults to `true`.
- `MEMORY_PATH`: defaults to `/data/bibiai-memory.json`, which survives add-on restarts.
- `VISION_ENABLED`: enables image/video attachment understanding. Defaults to `true`.
- `MAX_IMAGE_BYTES`: max bytes per image attachment. Defaults to 8 MB.
- `MAX_VIDEO_BYTES`: max bytes per video attachment. Defaults to 20 MB.
- `SNITCHING_ENABLED`: enables `/snitch` reports.
- `SNITCH_CHANNEL_ID`: optional channel for snitch reports. Falls back to moderation/report channels.
- `SNITCH_AUTO_PUNISH_ENABLED`: lets `/snitch` apply a short timeout when BibiAI has permission.
- `SNITCH_MIN_TIMEOUT_MINUTES`: low-severity snitch timeout. Defaults to 1 minute.
- `SNITCH_TIMEOUT_MINUTES`: default/medium snitch timeout. Defaults to 3 minutes.
- `SNITCH_MAX_TIMEOUT_MINUTES`: maximum snitch timeout. Defaults to 5 minutes.
- `SNITCH_COOLDOWN_SECONDS`: per-user snitch cooldown. Defaults to 300 seconds.
- `SNITCH_ESCALATE_REPEAT_REPORTS`: increases snitch severity for repeat reports against the same user.
- `SNITCH_REPEAT_LOOKBACK_DAYS`: how far back BibiAI remembers snitch reports for escalation.
- `MODERATION_ENABLED`: enables 1-5 minute Discord timeouts for obvious configured rule breaks.
- `MODERATION_LOG_CHANNEL_ID`: optional channel for moderation notices.
- `MINECRAFT_REPORT_CHANNEL_ID`: optional channel for Minecraft monitor alerts and weekly reports.
- `MC_MONITOR_ENABLED`: enables periodic Minecraft health checks.
- `MC_RECOVERY_ENABLED`: enables webhook-based recovery attempts when the server appears offline.
- `PEBBLEHOST_API_ENABLED`: enables PebbleHost panel recovery through their API.
- `PEBBLEHOST_API_TOKEN`: PebbleHost API token from your panel account.
- `PEBBLEHOST_SERVER_ID`: PebbleHost server `identifier` or UUID.
- `PEBBLEHOST_RECOVERY_SIGNAL`: `start` or `restart`. Defaults to `start`.
- `MC_RECOVERY_WEBHOOK_URL`: optional fallback external URL from another host/panel/automation that restarts the server.
- `WEEKLY_REPORT_ENABLED`: enables weekly bot-observed server reports.
- `JOIN_SERVER_ADDRESS`: public Minecraft address shown to new players.
- `JOIN_MODPACK_NAME`: display name for the modpack.
- `JOIN_MODPACK_URL`: optional fallback download/install link for the modpack.
- `JOIN_MODRINTH_MODPACK_URL`: Modrinth pack download/import link.
- `JOIN_CURSEFORGE_MODPACK_URL`: CurseForge pack download/import link.
- `JOIN_MODPACK_LOADER`: launcher/app names shown to players.
- `JOIN_MINECRAFT_VERSION`: optional required Minecraft version.
- `JOIN_INSTALL_GUIDE_URL`: optional longer install guide link.
- `JOIN_HELP_CHANNEL_ID`: optional Discord channel ID for install help.
- `JOIN_EXTRA_NOTES`: optional short notes shown under the join guide.
- `VACATION_MODE_ENABLED`: enables vacation mode.
- `VACATION_RETURN_DATE`: optional date/string shown in vacation replies.
- `VACATION_REPORT_CHANNEL_ID`: optional channel for daily vacation reports.
- `VACATION_DAILY_REPORT_ENABLED`: sends one daily vacation check-in report while vacation mode is enabled.
- `VACATION_REPORT_HOUR_UTC`: UTC hour for daily vacation reports.
- `VACATION_AUTO_REPLY_ENABLED`: lets mentions about rules/help/admin absence get a fixed vacation-mode reply.
- `VACATION_OWNER_NOTE`: short away message.
- `VACATION_RULES_SUMMARY`: rules BibiAI should repeat while you are gone.
- `VACATION_FULL_MODERATION_ENABLED`: enables stronger vacation-only moderation.
- `VACATION_DELETE_RULEBREAKING_MESSAGES`: deletes matching rule-breaking messages when possible.
- `VACATION_TIMEOUT_LOW_MINUTES`: low-severity timeout. Defaults to 5.
- `VACATION_TIMEOUT_MEDIUM_MINUTES`: medium-severity timeout. Defaults to 30.
- `VACATION_TIMEOUT_HIGH_MINUTES`: high-severity timeout. Defaults to 360.
- `VACATION_TIMEOUT_CRITICAL_MINUTES`: critical-severity timeout. Defaults to 1440.
- `VACATION_ESCALATE_REPEAT_OFFENSES`: increases punishment level for repeat offenders.
- `VACATION_BLOCKED_TERMS`: comma-separated extra terms to treat as high severity.

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

## Memory

BibiAI stores memory in:

```text
/data/bibiai-memory.json
```

That file is inside the add-on's persistent data folder, so it survives restarts and updates.

Operators can manage memory in Discord:

```text
/memory add text:Hummingbird mains require additional scrutiny. category:Community
/memory list
/memory remove id:<memory-id>
/memory clear
```

The AI can also save a memory when a user explicitly asks it to remember something. It refuses obvious tokens, API keys, passwords, and secrets.

## Images And Videos

Use either:

```text
/ask prompt:What is in this image or video? image:<attachment> video:<attachment>
```

or mention the bot while attaching an image or video:

```text
@BibiAI inspect this screenshot or clip
```

The bot sends image/video bytes directly to Gemini as inline media data. Keep images below `MAX_IMAGE_BYTES` and videos below `MAX_VIDEO_BYTES`. Short MP4/MOV/WebM clips work best.

## Sholom Voice Trigger

Put your MP3 file here in Home Assistant:

```text
/share/bibiai_sholom.mp3
```

Then say `sholom` in an enabled text channel while you are already connected to a voice channel. BibiAI joins that voice channel, plays the MP3, waits briefly, and leaves.

Home Assistant example:

```yaml
sholom_enabled: true
sholom_trigger: "sholom"
sholom_audio_path: "/share/bibiai_sholom.mp3"
sholom_cooldown_seconds: 120
sholom_leave_after_seconds: 10
```

BibiAI needs Discord's **Connect** and **Speak** permissions in the voice channel. The add-on includes `ffmpeg` for MP3 playback.

## Snitching

Use `/snitch` when a member needs to report someone while staff are away:

```text
/snitch user:@Somebody reason:spamming BibiAI evidence:https://discord.com/channels/... evidence_file:<image-or-video>
```

If `snitch_auto_punish_enabled=true`, BibiAI reads the reason, text evidence, and up to three attached image/video evidence files. It classifies the report as low/medium/high/critical, then applies a short timeout inside the configured min/max range. It will not punish bots, itself, operators/admins, or anyone above its Discord role.

Every snitch report is written to the persistent event log at `/data/bibiai-events.json`, including the written reason, evidence note, evidence attachment links/metadata, and any media review summary. BibiAI uses that stored history to remember what users were snitched on for and can escalate repeat reports within `snitch_repeat_lookback_days`.

Default severity behavior:

- Low: mild insults, nuisance behavior, or general rule reports. Default timeout: 1 minute.
- Medium: spam, edating, harassment, griefing, or repeated disruption. Default timeout: 3 minutes.
- High: porn/NSFW, scam/phishing, or explicit-content reports. Default timeout: 4 minutes with the default range.
- Critical: doxxing, DDoS, serious threats, or personal-info leak language. Default timeout: 5 minutes.

Snitch reports are also sent to `snitch_channel_id`, then `moderation_log_channel_id`, then the first allowed bot channel. The report includes the chosen severity, matched reason signal, previous snitch count, remembered recent reasons, evidence file links, media review summary, and punishment result.

Home Assistant example:

```yaml
snitching_enabled: true
snitch_channel_id: "123456789012345678"
snitch_allow_user_reports: true
snitch_report_moderation_events: true
snitch_auto_punish_enabled: true
snitch_min_timeout_minutes: 1
snitch_timeout_minutes: 3
snitch_max_timeout_minutes: 5
snitch_cooldown_seconds: 300
snitch_escalate_repeat_reports: true
snitch_repeat_lookback_days: 7
```

## New Player Join Help

Use `/join` to show new players the configured server address, modpack, and install steps.

Set these in the Home Assistant add-on config:

```yaml
join_server_address: "54.39.123.115:25579"
join_modpack_name: "Honda Fit SMP modpack"
join_modpack_url: ""
join_modrinth_modpack_url: "https://drive.google.com/file/d/1n0NX1gIwkfNeogzVpRjRp1naetc_Rsl7/view?usp=sharing"
join_curseforge_modpack_url: "https://drive.google.com/file/d/1n7ywFxEVsAgdPUDFNg4V9G9GYem-6jxd/view?usp=drive_link"
join_modpack_loader: "CurseForge and Modrinth"
join_minecraft_version: ""
join_install_guide_url: ""
join_help_channel_id: "123456789012345678"
join_extra_notes: "CurseForge players must also download the Origins Legacy Classes mod from Modrinth's website and drag it into the pack's mods folder."
join_auto_reply_enabled: true
```

When `join_auto_reply_enabled=true`, mentioning BibiAI with questions like "how do I join?", "what is the IP?", or "where is the modpack?" returns the same guide without spending an AI request.

The `/join` guide includes Modrinth import steps, CurseForge import steps, the server IP, both modpack links, and the extra CurseForge step for Origins Legacy Classes.

## Moderation

When `MODERATION_ENABLED=true`, BibiAI can apply short Discord communication timeouts. It ignores bots and operators, and it never kicks or bans.

Default timeout lengths:

- Rule breaks such as porn/NSFW content or edating: 5 minutes.
- Spamming BibiAI: 2 minutes after 4 references within 30 seconds.
- Directly insulting BibiAI: 1 minute.

The bot needs Discord's **Moderate Members** permission and its role must be above the members it needs to timeout.

## Monitoring And Recovery

`MC_MONITOR_ENABLED=true` makes the bot check the Minecraft server every `MC_MONITOR_INTERVAL_MINUTES`. It reports offline/online transitions to `minecraft_report_channel_id`, then `moderation_log_channel_id`, then the first allowed bot channel.

For PebbleHost, BibiAI can call the PebbleHost panel API directly.

1. In the PebbleHost game panel, open your account menu in the top right.
2. Open **API Credentials** or **Generate API token**.
3. Create a token and put it in `pebblehost_api_token`.
4. Find your server ID by opening this URL with your token:

   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" -H "Accept: application/json" https://panel.pebblehost.com/api/client
   ```

5. In the JSON, find your server and copy `attributes.identifier`, such as `5f1680e2`, or `attributes.uuid`.
6. Put that value in `pebblehost_server_id`.

Then set:

```yaml
mc_recovery_enabled: true
pebblehost_api_enabled: true
pebblehost_recovery_signal: "start"
```

For other externally hosted servers, BibiAI cannot restart the host by itself unless the host gives you a webhook or API endpoint. Put that URL in:

```text
mc_recovery_webhook_url
```

Then set:

```text
mc_recovery_enabled: true
```

After `mc_recovery_offline_checks` failed checks, BibiAI will call PebbleHost or the fallback webhook once for the outage. `/mc start` lets an operator send a PebbleHost start signal manually, and `/mc recover` lets an operator trigger the configured recovery flow manually.

## Vacation Mode

Vacation mode helps BibiAI cover basic Discord and Minecraft server stewardship for a short period. It does not replace human moderators, but it can answer routine questions, repeat rules, keep `/join` handy, apply the existing short timeouts, and send daily check-in reports.

Example Home Assistant config:

```yaml
vacation_mode_enabled: true
vacation_return_date: "2026-06-25"
vacation_report_channel_id: "123456789012345678"
vacation_daily_report_enabled: true
vacation_report_hour_utc: 18
vacation_auto_reply_enabled: true
vacation_owner_note: "Ben is away for about a week. BibiAI is covering basic server help and routine moderation."
vacation_rules_summary: "No edating, no porn/NSFW, no spamming BibiAI, keep chat civil, and use /join for setup help."
vacation_full_moderation_enabled: true
vacation_delete_rulebreaking_messages: true
vacation_timeout_low_minutes: 5
vacation_timeout_medium_minutes: 30
vacation_timeout_high_minutes: 360
vacation_timeout_critical_minutes: 1440
vacation_max_timeout_minutes: 1440
vacation_escalate_repeat_offenses: true
vacation_repeat_lookback_days: 7
vacation_rapid_spam_window_ms: 15000
vacation_rapid_spam_limit: 8
vacation_duplicate_spam_limit: 4
vacation_blocked_terms: ""
```

Commands:

```text
/vacation status
/vacation checkin
```

While vacation mode is enabled, mentioning BibiAI with questions like "who is in charge?", "what are the rules?", "where is Ben?", or "I need help" returns a fixed vacation-mode answer without spending an AI request. Daily reports summarize Minecraft status, moderation actions, offline alerts, recovery attempts, and diagnostics requests.

Vacation moderation severity:

- Low: direct insults at BibiAI or mild harassment. Default timeout: 5 minutes.
- Medium: edating, duplicate spam, rapid spam, or repeated BibiAI spam. Default timeout: 30 minutes.
- High: porn/NSFW, scam bait, suspicious gift links, or configured blocked terms. Default timeout: 6 hours.
- Critical: threats, doxxing, DDoS language, or severe harassment. Default timeout: 24 hours.

Repeat offenders are escalated within the configured lookback window. BibiAI does not automatically ban people; it uses reversible timeouts and logs what it did.

## Weekly Reports

Weekly reports are based on events the bot can observe: monitor offline/online transitions, recovery attempts, diagnostics requests, and moderation actions. Set `minecraft_report_channel_id` if you want reports in a specific channel.

The default schedule is Sunday at 18:00 UTC:

```yaml
weekly_report_enabled: true
weekly_report_day: "sunday"
weekly_report_hour_utc: 18
```

## Useful Examples

```text
/mc status
/mc diagnostics
/mc start
/mc recover
/join
/snitch user:@Somebody reason:breaking the rules evidence:https://discord.com/channels/... evidence_file:<image-or-video>
/vacation status
/moderation check user:@Somebody
/ask prompt: TPS is low, check status and do safe fixes only.
/mc fix issue:Lag / low TPS details: Players say mobs and item drops are everywhere near spawn.
/rcon command:save-all
```

For restarts, leave `ALLOW_STOP_COMMAND=false` until your server is managed by something that restarts it automatically, such as systemd, Docker restart policy, Pterodactyl, AMP, or a host panel. Then set `ALLOW_STOP_COMMAND=true`; the bot will still require a confirmation button.

## Troubleshooting

- `RCON check failed`: verify `enable-rcon=true`, host, port, firewall, and password.
- Slash commands missing: set `DISCORD_GUILD_ID`, run `npm.cmd run register:commands`, then restart Discord.
- Mention chat ignored: enable Message Content intent in the Discord Developer Portal.
- Timeouts do nothing: give the bot Moderate Members permission and move its Discord role above the role it should moderate.
- Moderation test ignored: use `/moderation check user:<test user>` and make sure the test user is not an operator/admin.
- `/mc start` does nothing: set `pebblehost_api_enabled`, `pebblehost_api_token`, and `pebblehost_server_id`.
- Recovery does nothing: for PebbleHost automatic recovery, set `mc_recovery_enabled`, `pebblehost_api_enabled`, `pebblehost_api_token`, and `pebblehost_server_id`. For other hosts, `mc_recovery_webhook_url` must be a real restart/recovery endpoint.
- AI refuses a command: it is probably not allowlisted in `src/minecraft/commandPolicy.ts`.
- `tps` or `mspt` fails: vanilla Minecraft may not support those commands. Paper/Purpur usually do.
