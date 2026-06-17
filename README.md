# BibiAI Home Assistant Add-ons

Home Assistant add-on repository for **BibiAI**, a Gemini-powered Discord bot that can diagnose and safely operate a Minecraft server over RCON.

Features include persistent memory, Discord slash commands, Gemini image understanding for attachments, and guarded Minecraft RCON actions.

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

## Important

Do not commit secrets to this repository. Put tokens, API keys, and RCON passwords only in the Home Assistant add-on configuration.
