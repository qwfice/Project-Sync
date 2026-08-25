// ============================================================
// ProjectSync Discord Bot
// ============================================================
// Standalone, always-on process (Discord's gateway needs a persistent
// WebSocket — this cannot be a Vercel edge function or an hourly cron job
// like telegram_bot.py). See README.md for setup and deploy instructions.
//
// Responsibilities:
//   - /link <code>            — link a Discord identity to a ProjectSync user
//   - /connect-project <code> — upgrade a project's Discord connection to
//                                two-way sync for the channel it's run in
//   - Mirrors messages: Discord channel <-> ProjectSync project chat, for
//     any project connection whose capabilities include 'two_way'
//   - DMs linked users hourly check-ins, 24h deadline warnings, and a 7am
//     local daily digest — ported from telegram_bot.py, running on this
//     process's own setInterval since (unlike that script) it's always on
// ============================================================

import 'dotenv/config';
import http from 'http';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

const { DISCORD_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT } = process.env;

if (!DISCORD_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing DISCORD_BOT_TOKEN, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// This process's real job is the Discord gateway connection below, not
// serving HTTP — but hosts like Koyeb expect a service to answer on a port
// for health checks, or they assume it crashed and keep restarting it.
http.createServer((_req, res) => res.writeHead(200).end('ok')).listen(PORT || 8000);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — must be enabled in the Developer Portal, see README
  ],
});

// This process needs to survive unattended for hours/days once deployed.
// A transient gateway hiccup (e.g. a WebSocket handshake timeout during
// reconnect) is normal and discord.js retries automatically — but if
// nothing is listening for the resulting 'error' event, Node treats it as
// an unhandled exception and kills the whole process. These listeners are
// the difference between "logged a warning and kept going" and "crashed
// silently until someone notices reminders stopped."
client.on('error', (err) => {
  console.error('[discord client error]', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaught exception]', err.message);
});

// In-memory maps of active two-way connections, refreshed periodically
// rather than re-queried per message. A project can only have one active
// Discord connection at a time (enforced by platform_connections' unique
// index), so these are 1:1.
const projectToChannel = new Map(); // project_id -> discord channel id
const channelToProject = new Map(); // discord channel id -> project_id

const REFRESH_INTERVAL_MS = 60 * 1000;

async function refreshConnections() {
  const { data, error } = await supabase
    .from('platform_connections')
    .select('project_id, external_id, capabilities')
    .eq('platform', 'discord')
    .eq('status', 'active')
    .contains('capabilities', ['two_way']);

  if (error) {
    console.error('[refreshConnections] failed:', error.message);
    return;
  }

  projectToChannel.clear();
  channelToProject.clear();
  for (const row of data || []) {
    if (!row.external_id) continue;
    projectToChannel.set(row.project_id, row.external_id);
    channelToProject.set(row.external_id, row.project_id);
  }
}

// ============================================================
// Slash commands
// ============================================================
async function handleLink(interaction) {
  const code = interaction.options.getString('code', true).trim();

  const { data: codeRow, error: codeError } = await supabase
    .from('platform_link_codes')
    .select('*')
    .eq('code', code)
    .eq('kind', 'user')
    .eq('platform', 'discord')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (codeError || !codeRow) {
    await interaction.reply({ content: '❌ That code is invalid or has expired. Generate a new one in ProjectSync > Connections.', ephemeral: true });
    return;
  }

  const { error: upsertError } = await supabase.from('platform_connections').upsert({
    scope: 'user',
    user_id: codeRow.user_id,
    platform: 'discord',
    external_id: interaction.user.id,
    external_label: interaction.user.username,
    capabilities: ['linking', 'notify'], // linking already implies opting into reminder DMs
    status: 'active',
    created_by: codeRow.user_id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,platform' });

  if (upsertError) {
    console.error('[handleLink] upsert failed:', upsertError.message);
    await interaction.reply({ content: '❌ Something went wrong linking your account. Try again.', ephemeral: true });
    return;
  }

  await supabase.from('platform_link_codes').update({ used_at: new Date().toISOString() }).eq('id', codeRow.id);

  await interaction.reply({ content: '✅ Linked! Messages you send in synced channels will now show your ProjectSync profile.', ephemeral: true });
}

async function handleConnectProject(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: '❌ Run this inside the server channel you want to sync, not in a DM.', ephemeral: true });
    return;
  }

  const code = interaction.options.getString('code', true).trim();

  const { data: codeRow, error: codeError } = await supabase
    .from('platform_link_codes')
    .select('*')
    .eq('code', code)
    .eq('kind', 'project')
    .eq('platform', 'discord')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (codeError || !codeRow) {
    await interaction.reply({ content: '❌ That code is invalid or has expired. Generate a new one in ProjectSync > Connections (project leader only).', ephemeral: true });
    return;
  }

  // The project's platform_connections row already exists if a webhook was
  // ever saved (Phase 1) — this upgrades it in place rather than inserting
  // a second row, since (project_id, platform) is unique per project.
  const { data: existing } = await supabase
    .from('platform_connections')
    .select('capabilities')
    .eq('project_id', codeRow.project_id)
    .eq('platform', 'discord')
    .maybeSingle();

  const capabilities = Array.from(new Set([...(existing?.capabilities || []), 'two_way']));

  const { error: upsertError } = await supabase.from('platform_connections').upsert({
    scope: 'project',
    project_id: codeRow.project_id,
    platform: 'discord',
    external_id: interaction.channelId,
    external_label: '#' + (interaction.channel?.name || 'unknown'),
    capabilities,
    status: 'active',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id,platform' });

  if (upsertError) {
    console.error('[handleConnectProject] upsert failed:', upsertError.message);
    await interaction.reply({ content: '❌ Something went wrong connecting this channel. Try again.', ephemeral: true });
    return;
  }

  await supabase.from('platform_link_codes').update({ used_at: new Date().toISOString() }).eq('id', codeRow.id);
  await refreshConnections();

  await interaction.reply({ content: '✅ This channel is now synced two-way with the project\'s ProjectSync chat.' });
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'link') await handleLink(interaction);
    else if (interaction.commandName === 'connect-project') await handleConnectProject(interaction);
  } catch (err) {
    console.error('[interactionCreate] unhandled error:', err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ Unexpected error, please try again.', ephemeral: true }).catch(() => {});
    }
  }
});

// ============================================================
// Discord -> ProjectSync
// ============================================================
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const projectId = channelToProject.get(message.channelId);
  if (!projectId) return;

  const content = (message.content || '').trim();
  if (!content) return; // attachment/embed-only messages aren't synced (chat_messages needs content/sticker)

  const { data: linked } = await supabase
    .from('platform_connections')
    .select('user_id')
    .eq('scope', 'user')
    .eq('platform', 'discord')
    .eq('external_id', message.author.id)
    .eq('status', 'active')
    .maybeSingle();

  const row = linked?.user_id
    ? { project_id: projectId, user_id: linked.user_id, content, origin: 'discord' }
    : { project_id: projectId, user_id: null, external_platform: 'discord', external_label: message.author.username, content, origin: 'discord' };

  const { error } = await supabase.from('chat_messages').insert(row);
  if (error) console.error('[messageCreate] sync insert failed:', error.message);
});

// ============================================================
// ProjectSync -> Discord
// ============================================================
supabase
  .channel('discord-bot:chat-forward')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, async (payload) => {
    const msg = payload.new;
    if (msg.origin !== 'app') return; // don't echo messages that originated from a platform sync

    const channelId = projectToChannel.get(msg.project_id);
    if (!channelId) return;

    const text = msg.content || (msg.sticker_emoji ? msg.sticker_emoji : msg.sticker_url ? '[sticker]' : null);
    if (!text) return;

    let senderName = 'Someone';
    if (msg.user_id) {
      const { data: profile } = await supabase.from('profiles').select('name').eq('id', msg.user_id).maybeSingle();
      senderName = profile?.name || senderName;
    }

    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.isTextBased()) await channel.send('**' + senderName + ':** ' + text);
    } catch (err) {
      console.error('[chat-forward] failed to post to Discord:', err.message);
    }
  })
  .subscribe();

// ============================================================
// DM reminders — ported from telegram_bot.py, adapted for Discord.
// This process is already always-on (unlike telegram_bot.py, which only
// runs when an external cron wakes it), so the sweep just runs on its own
// setInterval below instead of needing separate scheduling infrastructure.
// Reuses the same profiles columns (timezone/language/reminder hours) as
// Telegram — these are account-level preferences, not platform-specific.
// ============================================================

const APP_URL = 'https://project-sync-nine.vercel.app';

function getUserLocalHour(tz) {
  try {
    const hour = parseInt(
      new Date().toLocaleString('en-US', { timeZone: tz || 'UTC', hour: 'numeric', hour12: false }),
      10
    );
    return hour === 24 ? 0 : hour; // some ICU implementations report midnight as "24"
  } catch {
    return new Date().getUTCHours();
  }
}

function getUserLocalDateStr(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatDueText(dueDate, lang) {
  const due = new Date(dueDate + 'T00:00:00Z');
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const daysLeft = Math.round((due - today) / 86400000);

  const translations = {
    en: { today: 'Due today', tomorrow: 'Due tomorrow', days: 'days left', overdue: 'OVERDUE' },
    ms: { today: 'Due hari ini', tomorrow: 'Due esok', days: 'hari lagi', overdue: 'LEWAT' },
    zh: { today: '今天到期', tomorrow: '明天到期', days: '天后到期', overdue: '已逾期' },
    es: { today: 'Vence hoy', tomorrow: 'Vence mañana', days: 'días restantes', overdue: 'ATRASADO' },
    ja: { today: '今日が期限', tomorrow: '明日が期限', days: '日後', overdue: '期限超過' },
    ko: { today: '오늘 마감', tomorrow: '내일 마감', days: '일 남음', overdue: '기한 초과' },
  };
  const t = translations[lang] || translations.en;

  if (daysLeft < 0) return `🔴 **${t.overdue}** (${Math.abs(daysLeft)} ${t.days})`;
  if (daysLeft === 0) return `🔴 **${t.today}**`;
  if (daysLeft === 1) return `🟡 **${t.tomorrow}**`;
  if (daysLeft <= 3) return `🟡 ${daysLeft} ${t.days}`;
  return `🟢 ${daysLeft} ${t.days}`;
}

async function dmUser(externalId, text) {
  const user = await client.users.fetch(externalId);
  await user.send(text);
}

// ---- Hourly check-in ----
async function sendHourlyReminders() {
  console.log(`[${new Date().toISOString()}] Sending Discord hourly reminders...`);

  const { data: links, error } = await supabase
    .from('platform_connections')
    .select('user_id, external_id')
    .eq('platform', 'discord').eq('scope', 'user').eq('status', 'active');
  if (error || !links?.length) return;

  const translations = {
    en: { header: '⏰ Hourly Check-in', you_have: 'You have', pending: 'pending task(s):', open: 'Open ProjectSync' },
    ms: { header: '⏰ Peringatan Setiap Jam', you_have: 'Anda mempunyai', pending: 'tugas tertangguh:', open: 'Buka ProjectSync' },
    zh: { header: '⏰ 每小时提醒', you_have: '您有', pending: '个待办任务：', open: '打开 ProjectSync' },
    es: { header: '⏰ Recordatorio Horario', you_have: 'Tienes', pending: 'tarea(s) pendiente(s):', open: 'Abrir ProjectSync' },
    ja: { header: '⏰ 定時リマインダー', you_have: '', pending: '件の未完了タスクがあります：', open: 'ProjectSync を開く' },
    ko: { header: '⏰ 정시 알림', you_have: '', pending: '개의 미완료 작업이 있습니다:', open: 'ProjectSync 열기' },
  };

  for (const link of links) {
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', link.user_id).maybeSingle();
    if (!profile) continue;

    const tz = profile.timezone || 'UTC';
    const startHour = profile.reminder_start_hour ?? 16;
    const endHour = profile.reminder_end_hour ?? 22;
    const lang = profile.language || 'en';
    const currentHour = getUserLocalHour(tz);
    if (currentHour < startHour || currentHour > endHour) continue;

    const { data: memberships } = await supabase.from('project_members').select('project_id').eq('user_id', link.user_id);
    if (!memberships?.length) continue;
    const projectIds = memberships.map((m) => m.project_id);

    const { data: tasks } = await supabase.from('tasks').select('*, projects(name)').in('project_id', projectIds).neq('status', 'done');
    const pending = (tasks || []).filter((task) => task.assignee === link.user_id || !task.assignee);
    if (!pending.length) continue;

    const t = translations[lang] || translations.en;
    let msg = `**${t.header}**\n\n`;
    msg += ['ja', 'ko'].includes(lang) ? `${pending.length}${t.pending}\n` : `${t.you_have} **${pending.length}** ${t.pending}\n`;
    for (const task of pending.slice(0, 5)) {
      const projectName = task.projects?.name || 'Project';
      msg += `\n• **${task.title}** — ${projectName}`;
      if (task.due_date) msg += `\n  ${formatDueText(task.due_date, lang)}`;
    }
    if (pending.length > 5) msg += `\n\n_...and ${pending.length - 5} more_`;
    msg += `\n\n📋 ${t.open}: ${APP_URL}`;

    try {
      await dmUser(link.external_id, msg);
      console.log(`  ✓ Sent hourly reminder to Discord user ${link.external_id}`);
    } catch (err) {
      console.error(`  ✗ Failed to DM hourly reminder to ${link.external_id}:`, err.message);
    }
  }
}

// ---- 24h deadline warnings ----
async function sendDeadlineWarnings() {
  console.log(`[${new Date().toISOString()}] Checking Discord deadline warnings...`);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

  const { data: tasks } = await supabase.from('tasks').select('*, projects(name)').in('due_date', [today, tomorrow]).neq('status', 'done');
  if (!tasks?.length) return;

  const translations = {
    en: { warning: '🚨 Deadline Warning', due_in: 'is due in', hours: 'hours!', view: 'View Task' },
    ms: { warning: '🚨 Amaran Tarikh Akhir', due_in: 'tamat tempoh dalam', hours: 'jam!', view: 'Lihat Tugas' },
    zh: { warning: '🚨 截止日期警告', due_in: '将在', hours: '小时后到期！', view: '查看任务' },
    es: { warning: '🚨 Aviso de Fecha Límite', due_in: 'vence en', hours: 'horas!', view: 'Ver Tarea' },
    ja: { warning: '🚨 期限警告', due_in: 'の期限まであと', hours: '時間です！', view: 'タスクを見る' },
    ko: { warning: '🚨 마감일 경고', due_in: '마감까지', hours: '시간 남았습니다!', view: '작업 보기' },
  };

  for (const task of tasks) {
    if (!task.assignee) continue;

    const { data: link } = await supabase
      .from('platform_connections').select('external_id')
      .eq('user_id', task.assignee).eq('platform', 'discord').eq('scope', 'user').eq('status', 'active')
      .maybeSingle();
    if (!link?.external_id) continue;

    // Shared dedup with Telegram — whichever platform's sweep runs first
    // for this user+task "claims" the warning, the other skips it.
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('notifications').select('id')
      .eq('user_id', task.assignee).eq('task_id', task.id).eq('type', 'deadline_warning')
      .gte('created_at', sixHoursAgo);
    if (existing?.length) continue;

    const { data: profile } = await supabase.from('profiles').select('language').eq('id', task.assignee).maybeSingle();
    const lang = profile?.language || 'en';
    const t = translations[lang] || translations.en;

    const hoursLeft = task.due_date === tomorrow ? 24 : 0;
    const dueText = hoursLeft > 0 ? `${hoursLeft} ${t.hours}` : t.hours;

    let msg = `**${t.warning}**\n\n`;
    msg += `⚠️ **${task.title}** ${t.due_in} **${dueText}**`;
    msg += `\n\n📁 Project: ${task.projects?.name || 'Unknown'}`;
    msg += `\n\n👀 ${t.view}: ${APP_URL}`;

    try {
      await dmUser(link.external_id, msg);
      await supabase.from('notifications').insert({
        user_id: task.assignee, type: 'deadline_warning', title: t.warning,
        message: `${task.title} is due soon`, project_id: task.project_id, task_id: task.id, read: false,
      });
      console.log(`  ✓ Sent deadline warning to Discord user ${link.external_id} for "${task.title}"`);
    } catch (err) {
      console.error(`  ✗ Failed to DM deadline warning to ${link.external_id}:`, err.message);
    }
  }
}

// ---- 7am local daily digest ----
async function sendDailyDigest() {
  console.log(`[${new Date().toISOString()}] Sending Discord daily digests...`);

  const { data: links } = await supabase
    .from('platform_connections').select('user_id, external_id')
    .eq('platform', 'discord').eq('scope', 'user').eq('status', 'active');
  if (!links?.length) return;

  const translations = {
    en: { header: '📋 Today\'s Tasks', you_have: 'You have', tasks_today: 'task(s) due today:', good_luck: 'Good luck! 💪' },
    ms: { header: '📋 Tugas Hari Ini', you_have: 'Anda mempunyai', tasks_today: 'tugas untuk hari ini:', good_luck: 'Semoga berjaya! 💪' },
    zh: { header: '📋 今日任务', you_have: '您今天有', tasks_today: '个到期任务：', good_luck: '加油！💪' },
    es: { header: '📋 Tareas de Hoy', you_have: 'Tienes', tasks_today: 'tarea(s) para hoy:', good_luck: '¡Buena suerte! 💪' },
    ja: { header: '📋 今日のタスク', you_have: '', tasks_today: '件の今日期限のタスクがあります：', good_luck: '頑張って！💪' },
    ko: { header: '📋 오늘의 작업', you_have: '', tasks_today: '개의 오늘 마감 작업이 있습니다:', good_luck: '화이팅! 💪' },
  };

  for (const link of links) {
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', link.user_id).maybeSingle();
    if (!profile) continue;

    const tz = profile.timezone || 'UTC';
    if (getUserLocalHour(tz) !== 7) continue;

    const lang = profile.language || 'en';
    const todayStr = getUserLocalDateStr(tz);

    const { data: memberships } = await supabase.from('project_members').select('project_id').eq('user_id', link.user_id);
    if (!memberships?.length) continue;
    const projectIds = memberships.map((m) => m.project_id);

    const { data: tasks } = await supabase.from('tasks').select('*, projects(name)').in('project_id', projectIds).eq('due_date', todayStr).neq('status', 'done');
    if (!tasks?.length) continue;

    const t = translations[lang] || translations.en;
    let msg = `**${t.header}** ☀️\n\n`;
    msg += ['ja', 'ko'].includes(lang) ? `${tasks.length}${t.tasks_today}\n` : `${t.you_have} **${tasks.length}** ${t.tasks_today}\n`;
    for (const task of tasks) {
      msg += `\n• **${task.title}** — ${task.projects?.name || 'Project'}`;
    }
    msg += `\n\n_${t.good_luck}_`;

    try {
      await dmUser(link.external_id, msg);
      console.log(`  ✓ Sent daily digest to Discord user ${link.external_id}`);
    } catch (err) {
      console.error(`  ✗ Failed to DM daily digest to ${link.external_id}:`, err.message);
    }
  }
}

async function runReminderSweep() {
  console.log('='.repeat(60));
  console.log('Discord reminder sweep started at', new Date().toISOString());
  try {
    await sendHourlyReminders();
    await sendDeadlineWarnings();
    await sendDailyDigest();
  } catch (err) {
    console.error('[FATAL] reminder sweep error:', err);
  }
  console.log('Discord reminder sweep finished at', new Date().toISOString());
  console.log('='.repeat(60));
}

const REMINDER_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly, matching telegram_bot.py's cron cadence

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await refreshConnections();
  setInterval(refreshConnections, REFRESH_INTERVAL_MS);
  await runReminderSweep();
  setInterval(runReminderSweep, REMINDER_SWEEP_INTERVAL_MS);
});

client.login(DISCORD_BOT_TOKEN);
