#!/usr/bin/env python3
"""
ProjectSync Telegram Reminder Bot
=================================
Sends hourly reminders and deadline alerts to students worldwide.
Respects each user's timezone and preferred reminder hours.

SETUP:
1. Message @BotFather on Telegram, create a bot, get your token
2. Replace BOT_TOKEN below
3. Replace SUPABASE_URL and SUPABASE_KEY with your credentials
4. Run manually: python3 telegram_bot.py
5. Or set up cron: crontab -e, add: 0 * * * * /usr/bin/python3 /path/to/telegram_bot.py

For free cloud hosting, use:
- PythonAnywhere (free tier, runs every hour)
- Railway.app (free tier, $5 credit)
- Render.com (free tier)
"""

import os
import sys
import json
import asyncio
import aiohttp
from datetime import datetime, timedelta
from supabase import create_client, Client

# ============================================================
# CONFIGURATION — REPLACE THESE VALUES
# ============================================================
BOT_TOKEN = "YOUR_BOTFATHER_TOKEN_HERE"  # From @BotFather
SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co"
SUPABASE_KEY = "YOUR_SERVICE_ROLE_KEY_HERE"  # NOT the anon key! Use service_role key.

# ============================================================
# INITIALIZE
# ============================================================
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"


async def send_telegram_message(chat_id: str, text: str, inline_keyboard=None):
    """Send a message via Telegram Bot API."""
    url = f"{TELEGRAM_API}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": True
    }
    if inline_keyboard:
        payload["reply_markup"] = json.dumps({"inline_keyboard": inline_keyboard})

    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload) as resp:
            result = await resp.json()
            if not result.get("ok"):
                print(f"[ERROR] Failed to send to {chat_id}: {result}")
            return result


def get_user_local_time(timezone_str: str) -> datetime:
    """Get current time in user's timezone."""
    import pytz
    try:
        tz = pytz.timezone(timezone_str)
        return datetime.now(tz)
    except:
        return datetime.now(pytz.UTC)


def format_due_text(due_date: str, lang: str) -> str:
    """Format due date text in user's language."""
    due = datetime.strptime(due_date, "%Y-%m-%d").date()
    today = datetime.now().date()
    days_left = (due - today).days

    translations = {
        "en": {"today": "Due today", "tomorrow": "Due tomorrow", "days": "days left", "overdue": "OVERDUE"},
        "ms": {"today": "Due hari ini", "tomorrow": "Due esok", "days": "hari lagi", "overdue": "LEWAT"},
        "zh": {"today": "今天到期", "tomorrow": "明天到期", "days": "天后到期", "overdue": "已逾期"},
        "es": {"today": "Vence hoy", "tomorrow": "Vence mañana", "days": "días restantes", "overdue": "ATRASADO"},
        "ja": {"today": "今日が期限", "tomorrow": "明日が期限", "days": "日後", "overdue": "期限超過"},
        "ko": {"today": "오늘 마감", "tomorrow": "내일 마감", "days": "일 남음", "overdue": "기한 초과"},
    }
    t = translations.get(lang, translations["en"])

    if days_left < 0:
        return f"🔴 *{t['overdue']}* ({abs(days_left)} {t['days']})"
    elif days_left == 0:
        return f"🔴 *{t['today']}*"
    elif days_left == 1:
        return f"🟡 *{t['tomorrow']}*"
    elif days_left <= 3:
        return f"🟡 {days_left} {t['days']}"
    else:
        return f"🟢 {days_left} {t['days']}"


# ============================================================
# HOURLY REMINDERS
# ============================================================
async def send_hourly_reminders():
    """Send hourly check-in reminders to users during their preferred hours."""
    print(f"[{datetime.now()}] Sending hourly reminders...")

    # Get all users with Telegram linked
    users = supabase.table("profiles").select(
        "*, tasks:tasks(*)"  # This won't work directly, we'll fetch tasks separately
    ).eq("telegram_linked", True).execute()

    if not users.data:
        print("No linked Telegram users found.")
        return

    for user in users.data:
        chat_id = user.get("telegram_chat_id")
        if not chat_id:
            continue

        # Check if within user's preferred reminder hours
        user_tz = user.get("timezone", "UTC")
        start_hour = user.get("reminder_start_hour", 16)
        end_hour = user.get("reminder_end_hour", 22)
        lang = user.get("language", "en")

        local_time = get_user_local_time(user_tz)
        current_hour = local_time.hour

        if current_hour < start_hour or current_hour > end_hour:
            continue  # Outside preferred hours

        # Get pending tasks for this user
        # First get projects they're in
        memberships = supabase.table("project_members").select("project_id").eq("user_id", user["id"]).execute()
        if not memberships.data:
            continue

        project_ids = [m["project_id"] for m in memberships.data]

        # Get pending tasks assigned to them OR in their projects
        tasks = supabase.table("tasks").select("*, projects(name)").in_("project_id", project_ids).neq("status", "done").execute()

        pending_tasks = []
        for task in tasks.data:
            # Include tasks assigned to user OR unassigned tasks in their projects
            if task.get("assignee") == user["id"] or not task.get("assignee"):
                pending_tasks.append(task)

        if not pending_tasks:
            continue  # Nothing to remind about

        # Build message in user's language
        translations = {
            "en": {"header": "⏰ Hourly Check-in", "you_have": "You have", "pending": "pending task(s):", "open": "Open ProjectSync"},
            "ms": {"header": "⏰ Peringatan Setiap Jam", "you_have": "Anda mempunyai", "pending": "tugas tertangguh:", "open": "Buka ProjectSync"},
            "zh": {"header": "⏰ 每小时提醒", "you_have": "您有", "pending": "个待办任务：", "open": "打开 ProjectSync"},
            "es": {"header": "⏰ Recordatorio Horario", "you_have": "Tienes", "pending": "tarea(s) pendiente(s):", "open": "Abrir ProjectSync"},
            "ja": {"header": "⏰ 定時リマインダー", "you_have": "", "pending": "件の未完了タスクがあります：", "open": "ProjectSync を開く"},
            "ko": {"header": "⏰ 정시 알림", "you_have": "", "pending": "개의 미완료 작업이 있습니다:", "open": "ProjectSync 열기"},
        }
        t = translations.get(lang, translations["en"])

        msg = f"*{t['header']}*\n\n"
        if lang in ["ja", "ko"]:
            msg += f"{len(pending_tasks)}{t['pending']}\n"
        else:
            msg += f"{t['you_have']} *{len(pending_tasks)}* {t['pending']}\n"

        for task in pending_tasks[:5]:  # Max 5 tasks per message
            due_text = ""
            if task.get("due_date"):
                due_text = format_due_text(task["due_date"], lang)
            project_name = task.get("projects", {}).get("name", "Project")
            msg += f"\n• *{task['title']}* — {project_name}"
            if due_text:
                msg += f"\n  {due_text}"

        if len(pending_tasks) > 5:
            msg += f"\n\n_...and {len(pending_tasks) - 5} more_"

        # Add open button
        keyboard = [[{"text": f"📋 {t['open']}", "url": "https://projectsync.vercel.app"}]]

        await send_telegram_message(chat_id, msg, keyboard)
        print(f"  ✓ Sent hourly reminder to {user.get('email', 'unknown')}")


# ============================================================
# DEADLINE WARNINGS
# ============================================================
async def send_deadline_warnings():
    """Send warnings for tasks due within 24 hours."""
    print(f"[{datetime.now()}] Checking deadline warnings...")

    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    today = datetime.now().strftime("%Y-%m-%d")

    # Get tasks due today or tomorrow that aren't done
    tasks = supabase.table("tasks").select("*, projects(name)").in_("due_date", [today, tomorrow]).neq("status", "done").execute()

    if not tasks.data:
        print("No upcoming deadlines.")
        return

    for task in tasks.data:
        assignee_id = task.get("assignee")
        if not assignee_id:
            continue

        # Get assignee's Telegram info
        user = supabase.table("profiles").select("*").eq("id", assignee_id).eq("telegram_linked", True).single().execute()

        if not user.data:
            continue

        user_data = user.data
        chat_id = user_data.get("telegram_chat_id")
        lang = user_data.get("language", "en")

        if not chat_id:
            continue

        # Check if we already sent a warning for this task recently
        existing = supabase.table("notifications").select("*").eq("user_id", assignee_id).eq("task_id", task["id"]).eq("type", "deadline_warning").gte("created_at", (datetime.now() - timedelta(hours=6)).isoformat()).execute()

        if existing.data:
            continue  # Already warned recently

        translations = {
            "en": {"warning": "🚨 Deadline Warning", "due_in": "is due in", "hours": "hours!", "view": "View Task"},
            "ms": {"warning": "🚨 Amaran Tarikh Akhir", "due_in": "tamat tempoh dalam", "hours": "jam!", "view": "Lihat Tugas"},
            "zh": {"warning": "🚨 截止日期警告", "due_in": "将在", "hours": "小时后到期！", "view": "查看任务"},
            "es": {"warning": "🚨 Aviso de Fecha Límite", "due_in": "vence en", "hours": "horas!", "view": "Ver Tarea"},
            "ja": {"warning": "🚨 期限警告", "due_in": "の期限まであと", "hours": "時間です！", "view": "タスクを見る"},
            "ko": {"warning": "🚨 마감일 경고", "due_in": "마감까지", "hours": "시간 남았습니다!", "view": "작업 보기"},
        }
        t = translations.get(lang, translations["en"])

        hours_left = 24 if task["due_date"] == tomorrow else 0
        due_text = f"{hours_left} {t['hours']}" if hours_left > 0 else t['hours']

        msg = f"*{t['warning']}*\n\n"
        msg += f"⚠️ *{task['title']}* {t['due_in']} *{due_text}*"
        msg += f"\n\n📁 Project: {task.get('projects', {}).get('name', 'Unknown')}"

        keyboard = [[{"text": f"👀 {t['view']}", "url": f"https://projectsync.vercel.app"}]]

        await send_telegram_message(chat_id, msg, keyboard)

        # Record that we sent this notification
        supabase.table("notifications").insert({
            "user_id": assignee_id,
            "type": "deadline_warning",
            "title": t["warning"],
            "message": f"{task['title']} is due soon",
            "project_id": task["project_id"],
            "task_id": task["id"],
            "read": False
        }).execute()

        print(f"  ✓ Sent deadline warning to {user_data.get('email', 'unknown')} for '{task['title']}'")


# ============================================================
# DAILY DIGEST
# ============================================================
async def send_daily_digest():
    """Send daily summary at 7 AM user's local time."""
    print(f"[{datetime.now()}] Sending daily digests...")

    users = supabase.table("profiles").select("*").eq("telegram_linked", True).execute()

    for user in users.data:
        chat_id = user.get("telegram_chat_id")
        if not chat_id:
            continue

        user_tz = user.get("timezone", "UTC")
        local_time = get_user_local_time(user_tz)

        # Only send at 7 AM local time
        if local_time.hour != 7:
            continue

        lang = user.get("language", "en")

        # Get today's tasks
        today_str = local_time.strftime("%Y-%m-%d")
        memberships = supabase.table("project_members").select("project_id").eq("user_id", user["id"]).execute()

        if not memberships.data:
            continue

        project_ids = [m["project_id"] for m in memberships.data]
        tasks = supabase.table("tasks").select("*, projects(name)").in_("project_id", project_ids).eq("due_date", today_str).neq("status", "done").execute()

        if not tasks.data:
            continue

        translations = {
            "en": {"header": "📋 Today's Tasks", "you_have": "You have", "tasks_today": "task(s) due today:", "good_luck": "Good luck! 💪"},
            "ms": {"header": "📋 Tugas Hari Ini", "you_have": "Anda mempunyai", "tasks_today": "tugas untuk hari ini:", "good_luck": "Semoga berjaya! 💪"},
            "zh": {"header": "📋 今日任务", "you_have": "您今天有", "tasks_today": "个到期任务：", "good_luck": "加油！💪"},
            "es": {"header": "📋 Tareas de Hoy", "you_have": "Tienes", "tasks_today": "tarea(s) para hoy:", "good_luck": "¡Buena suerte! 💪"},
            "ja": {"header": "📋 今日のタスク", "you_have": "", "tasks_today": "件の今日期限のタスクがあります：", "good_luck": "頑張って！💪"},
            "ko": {"header": "📋 오늘의 작업", "you_have": "", "tasks_today": "개의 오늘 마감 작업이 있습니다:", "good_luck": "화이팅! 💪"},
        }
        t = translations.get(lang, translations["en"])

        msg = f"*{t['header']}* ☀️\n\n"
        if lang in ["ja", "ko"]:
            msg += f"{len(tasks.data)}{t['tasks_today']}\n"
        else:
            msg += f"{t['you_have']} *{len(tasks.data)}* {t['tasks_today']}\n"

        for task in tasks.data:
            project_name = task.get("projects", {}).get("name", "Project")
            msg += f"\n• *{task['title']}* — {project_name}"

        msg += f"\n\n_{t['good_luck']}_"

        await send_telegram_message(chat_id, msg)
        print(f"  ✓ Sent daily digest to {user.get('email', 'unknown')}")


# ============================================================
# MAIN
# ============================================================
async def main():
    """Run all notification jobs."""
    print("=" * 60)
    print("ProjectSync Telegram Bot")
    print(f"Started at: {datetime.now()}")
    print("=" * 60)

    try:
        await send_hourly_reminders()
        await send_deadline_warnings()
        await send_daily_digest()
    except Exception as e:
        print(f"[FATAL ERROR] {e}")
        import traceback
        traceback.print_exc()

    print("=" * 60)
    print(f"Finished at: {datetime.now()}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
