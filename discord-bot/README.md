# ProjectSync Discord Bot

Standalone, always-on Node process. Handles Discord account linking and
two-way chat sync between a Discord channel and a ProjectSync project's
in-app chat. This is separate from the main web app and from
`discord-notify` (the instant one-way notification edge function) — this
bot is only needed for two-way sync and account linking.

It needs a persistent connection (Discord's gateway is a WebSocket), so it
can't run as a Vercel edge function or a cron job — it has to be deployed
somewhere that keeps a Node process running continuously (Railway and
Render both have free/low-cost tiers that work; the code itself isn't
tied to either).

## 1. Create the Discord Application (you have to do this — it's your Discord account)

1. Go to https://discord.com/developers/applications → **New Application**.
2. Under **Bot**, click **Reset Token** to get your bot token, and turn on
   **Message Content Intent** under Privileged Gateway Intents — required
   for the bot to read message text for two-way sync. Without this, the
   bot connects but every message looks empty.
3. Copy the **Application ID** (top of the General Information page) — that's `DISCORD_CLIENT_ID`.
4. Under **OAuth2 > URL Generator**, select scopes `bot` and `applications.commands`,
   and bot permissions `Send Messages`, `Read Message History`, `Use Slash Commands`.
   Open the generated URL to invite the bot to your server.

   This application is already set up this way — its invite URL is:
   `https://discord.com/oauth2/authorize?client_id=1538160725766307872&permissions=2147551232&integration_type=0&scope=bot+applications.commands`
   Open it, pick the server to add the bot to, and authorize.

## 2. Configure

```bash
cd discord-bot
cp .env.example .env
# fill in DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm install
```

`SUPABASE_SERVICE_ROLE_KEY` is in the Supabase Dashboard under Settings > API —
**not** the anon key used by the web app. This process needs it to write
synced messages and read/write connection rows across RLS.

## 3. Register the slash commands (once, or whenever they change)

```bash
npm run register-commands
```

Global commands can take up to an hour to show up everywhere. They appear
instantly in a server the bot was just invited to in most cases.

## 4. Run

```bash
npm start
```

## 5. Deploy

Push this `discord-bot/` folder to its own Railway/Render service (start
command `npm start`), with the same four environment variables set in the
host's dashboard. It's a separate deploy from the Vercel-hosted web app —
this folder never gets pulled into the Vercel build.

## Usage (in Discord)

- `/link <code>` — links your Discord identity to your ProjectSync profile.
  Get the code from ProjectSync > open a project > Connections.
- `/connect-project <code>` — run by the project leader, inside the
  channel that should sync. Get the code from the same Connections panel.
  Upgrades the project's existing Discord connection to two-way sync.

Messages from Discord members who haven't run `/link` still sync into the
ProjectSync chat, shown with their Discord username instead of a linked
profile.

## Reminder DMs

Once a user runs `/link`, this bot DMs them directly — the same three jobs
`telegram_bot.py` runs on a cron, ported here to run on this process's own
hourly `setInterval` (it's always-on, so no external scheduler is needed):

- **Hourly check-in** — a list of pending tasks, only sent within the
  user's `reminder_start_hour`–`reminder_end_hour` window (from their
  ProjectSync profile).
- **24h deadline warning** — sent once per task within 6 hours of the
  first warning, shared with Telegram's own dedup (if Telegram already
  warned a user about a task recently, Discord won't warn again, and
  vice versa).
- **Daily digest** — today's due tasks, sent once at 7am in the user's
  local timezone.

All three reuse the user's existing `timezone`/`language`/reminder-hour
profile settings — same preferences that already drive Telegram reminders,
just delivered over Discord DM instead. A DM only works if the user hasn't
disabled "Allow direct messages from server members" for the server the
bot is in; if they have, that reminder silently fails for them without
affecting anyone else's.
