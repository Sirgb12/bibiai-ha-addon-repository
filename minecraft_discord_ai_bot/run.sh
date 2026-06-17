#!/usr/bin/with-contenv bashio
set -euo pipefail

export DISCORD_TOKEN="$(bashio::config 'discord_token')"
export DISCORD_CLIENT_ID="$(bashio::config 'discord_client_id')"
export DISCORD_GUILD_ID="$(bashio::config 'discord_guild_id')"
export BOT_ALLOWED_CHANNEL_IDS="$(bashio::config 'bot_allowed_channel_ids')"
export BOT_ADMIN_ROLE_IDS="$(bashio::config 'bot_admin_role_ids')"
export BOT_PERSONA_STYLE="$(bashio::config 'bot_persona_style')"
export BOT_PERSONA_FILE="$(bashio::config 'bot_persona_file')"

export GEMINI_API_KEY="$(bashio::config 'gemini_api_key')"
export GEMINI_MODEL="$(bashio::config 'gemini_model')"

export MC_SERVER_NAME="$(bashio::config 'mc_server_name')"
export MC_RCON_HOST="$(bashio::config 'mc_rcon_host')"
export MC_RCON_PORT="$(bashio::config 'mc_rcon_port')"
export MC_RCON_PASSWORD="$(bashio::config 'mc_rcon_password')"
export MC_QUERY_HOST="$(bashio::config 'mc_query_host')"
export MC_QUERY_PORT="$(bashio::config 'mc_query_port')"
export MC_LOG_PATH="$(bashio::config 'mc_log_path')"
export STATUS_LOG_LINES="$(bashio::config 'status_log_lines')"

export MEMORY_ENABLED="$(bashio::config 'memory_enabled')"
export MEMORY_PATH="$(bashio::config 'memory_path')"
export MAX_MEMORY_ITEMS="$(bashio::config 'max_memory_items')"
export MAX_MEMORY_ENTRY_LENGTH="$(bashio::config 'max_memory_entry_length')"

export VISION_ENABLED="$(bashio::config 'vision_enabled')"
export MAX_IMAGE_BYTES="$(bashio::config 'max_image_bytes')"

export AI_AUTO_EXECUTE_SAFE_COMMANDS="$(bashio::config 'ai_auto_execute_safe_commands')"
export ALLOW_STOP_COMMAND="$(bashio::config 'allow_stop_command')"
export BYPASS_RCON_SAFETY="$(bashio::config 'bypass_rcon_safety')"
export MAX_COMMANDS_PER_FIX="$(bashio::config 'max_commands_per_fix')"
export RCON_TIMEOUT_MS="$(bashio::config 'rcon_timeout_ms')"

if [[ -z "${DISCORD_TOKEN}" || -z "${DISCORD_CLIENT_ID}" || -z "${GEMINI_API_KEY}" || -z "${MC_RCON_PASSWORD}" ]]; then
  bashio::log.fatal "Missing required add-on options: discord_token, discord_client_id, gemini_api_key, or mc_rcon_password."
  exit 1
fi

cd /app
exec npm start
