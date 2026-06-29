# BibiAI Home Assistant Add-ons

Home Assistant add-on repository for **BibiAI**, a Gemini-powered Discord bot that can diagnose and safely operate a Minecraft server over RCON.

Features include persistent fact memory, conversational memory for past chats, BibiAI resentment/grudge memory for users who disrespect it, passive chat observation, optional random AI chat chimes, optional `@everyone` chat revives, Discord slash commands, Gemini image/video understanding for attachments, guarded Minecraft RCON actions, new-player join help, remembered member snitch reports with media evidence and severity-based short timeout punishment, configurable manual/random voice-channel MP3 triggers, Discord moderation, full vacation moderation, Minecraft monitoring, optional PebbleHost/API recovery, and weekly reports.

## Add This Repository To Home Assistant

After this folder is pushed to GitHub, add the repository URL in Home Assistant:

```text
https://github.com/Sirgb12/bibiai-ha-addon-repository
```

In Home Assistant:

1. Open **Settings -> Add-ons -> Add-on Store**.
2. Open the three-dot menu.
3. Choose **Repositories**.
4. Paste the GitHub URL.
5. Click **Add**.
6. Install **Minecraft Discord AI Bot**.

## Persona File

For long custom persona prompts, create this file in Home Assistant:

```text
/share/bibiai_persona.txt
```

The add-on automatically reads it on startup.

Persistent bot memory is stored in the add-on data folder:

```text
/data/bibiai-memory.json
```

Conversational chat memory is stored separately:

```text
/data/bibiai-conversations.json
```

BibiAI's resentment ledger is stored separately:

```text
/data/bibiai-grudges.json
```

## Important

Do not commit secrets to this repository. Put tokens, API keys, and RCON passwords only in the Home Assistant add-on configuration.
