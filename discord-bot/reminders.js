// ============================================================
// ProjectSync Discord reminder sweep — run-once script, triggered hourly
// by .github/workflows/discord-reminders.yml. Same shape as telegram_bot.py:
// no persistent connection, just REST calls to Discord's HTTP API to open a
// DM channel and post to it. Ported from discord-bot/index.js's setInterval
// version, which needed a full gateway login just to send DMs.
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const { DISCORD_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!DISCORD_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing DISCORD_BOT_TOKEN, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const APP_URL = 'https://project-sync-nine.vercel.app';

async function dmUser(externalId, text) {
  const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: externalId }),
  });
  if (!dmRes.ok) throw new Error(`open DM channel failed: ${await dmRes.text()}`);
  const dmChannel = await dmRes.json();

  const sendRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  });
  if (!sendRes.ok) throw new Error(`send DM failed: ${await sendRes.text()}`);
}

function getUserLocalHour(tz) {
  try {
    const hour = parseInt(
      new Date().toLocaleString('en-US', { timeZone: tz || 'UTC', hour: 'numeric', hour12: false }),
      10
    );
    return hour === 24 ? 0 : hour;
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
    process.exitCode = 1;
  }
  console.log('Discord reminder sweep finished at', new Date().toISOString());
  console.log('='.repeat(60));
}

await runReminderSweep();
