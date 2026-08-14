-- ============================================================
-- ProjectSync Global — International Database Schema
-- Run this in Supabase SQL Editor after creating your project
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES TABLE (User profiles — INTERNATIONAL)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  school TEXT,                              -- Auto-detected from email, nullable
  edu_level TEXT DEFAULT 'high' CHECK (edu_level IN ('middle', 'high', 'uni', 'self')),
  language TEXT DEFAULT 'en' CHECK (language IN ('en', 'ms', 'zh', 'es', 'ja', 'ko')),
  timezone TEXT DEFAULT 'UTC',
  country TEXT,                             -- Auto-detected from IP/timezone
  telegram_chat_id TEXT,
  telegram_linked BOOLEAN DEFAULT FALSE,
  reminder_start_hour INTEGER DEFAULT 16,
  reminder_end_hour INTEGER DEFAULT 22,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure profiles schema is up to date
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_linked BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reminder_start_hour INTEGER DEFAULT 16;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reminder_end_hour INTEGER DEFAULT 22;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT FALSE;


ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_linked BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reminder_start_hour INTEGER DEFAULT 16;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reminder_end_hour INTEGER DEFAULT 22;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT FALSE;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, avatar_url, timezone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.raw_user_meta_data->>'timezone', 'UTC')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- PROJECTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  subject TEXT,
  deadline DATE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROJECT MEMBERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- Also FK to profiles(id) so PostgREST can embed profiles through
-- project_members (app.js joins members:project_members(..., profiles(...)));
-- profiles.id already mirrors auth.users.id 1:1 via the handle_new_user trigger.
ALTER TABLE project_members
  DROP CONSTRAINT IF EXISTS project_members_user_id_profiles_fkey;
ALTER TABLE project_members
  ADD CONSTRAINT project_members_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ============================================================
-- TASKS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assignee UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  due_date DATE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  path TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('task_assigned', 'task_completed', 'deadline_warning', 'hourly_reminder', 'project_invite', 'payment_failed')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

-- Profiles: Users can read all profiles, update only their own
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON profiles;

CREATE POLICY "Profiles are viewable by everyone" ON profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Helper functions: SECURITY DEFINER bypasses RLS on project_members so that
-- policies on projects/project_members/tasks/files can check membership
-- without recursively re-triggering project_members's own RLS policies
-- (direct EXISTS subqueries into project_members from within its own SELECT
-- policy caused "infinite recursion detected in policy" / error 42P17).
CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p_project_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = p_project_id AND user_id = p_user_id AND role = 'owner'
  );
$$;

-- Projects: Members can view, owners can update/delete
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Projects viewable by members" ON projects;

CREATE POLICY "Projects viewable by members" ON projects
  FOR SELECT USING (
    created_by = auth.uid() OR is_project_member(id, auth.uid())
  );

DROP POLICY IF EXISTS "Projects insertable by authenticated" ON projects;

CREATE POLICY "Projects insertable by authenticated" ON projects
  FOR INSERT WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Projects updatable by owners" ON projects;

CREATE POLICY "Projects updatable by owners" ON projects
  FOR UPDATE USING (is_project_owner(id, auth.uid()));

DROP POLICY IF EXISTS "Projects deletable by owners" ON projects;

CREATE POLICY "Projects deletable by owners" ON projects
  FOR DELETE USING (is_project_owner(id, auth.uid()));

-- Project Members: Viewable by project members
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members viewable by project members" ON project_members;

CREATE POLICY "Members viewable by project members" ON project_members
  FOR SELECT USING (is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Members insertable by project owners" ON project_members;

CREATE POLICY "Members insertable by project owners" ON project_members
  FOR INSERT WITH CHECK (
    is_project_owner(project_id, auth.uid())
    OR (
      -- Bootstrap case: the project creator adds themselves as the first owner
      user_id = auth.uid() AND role = 'owner'
      AND EXISTS (SELECT 1 FROM projects WHERE id = project_id AND created_by = auth.uid())
    )
  );

-- Tasks: Viewable/editable by project members
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tasks viewable by project members" ON tasks;

CREATE POLICY "Tasks viewable by project members" ON tasks
  FOR SELECT USING (is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Tasks insertable by project members" ON tasks;
DROP POLICY IF EXISTS "Tasks insertable by project leader" ON tasks;

-- Only the project leader (owner) can create/assign tasks.
CREATE POLICY "Tasks insertable by project leader" ON tasks
  FOR INSERT WITH CHECK (is_project_owner(project_id, auth.uid()));

DROP POLICY IF EXISTS "Tasks updatable by project members" ON tasks;

CREATE POLICY "Tasks updatable by project members" ON tasks
  FOR UPDATE USING (is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Tasks deletable by project members" ON tasks;

CREATE POLICY "Tasks deletable by project members" ON tasks
  FOR DELETE USING (is_project_member(project_id, auth.uid()));

-- Files: Viewable by project members
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Files viewable by project members" ON files;

CREATE POLICY "Files viewable by project members" ON files
  FOR SELECT USING (is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Files insertable by project members" ON files;

CREATE POLICY "Files insertable by project members" ON files
  FOR INSERT WITH CHECK (is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Files deletable by uploader or owner" ON files;

CREATE POLICY "Files deletable by uploader or owner" ON files
  FOR DELETE USING (
    uploaded_by = auth.uid() OR is_project_owner(project_id, auth.uid())
  );

-- ============================================================
-- CHAT MESSAGES TABLE
-- ============================================================
-- user_id references profiles(id) rather than auth.users(id) so PostgREST
-- can embed sender profile data (name/avatar) directly -- see the
-- project_members_user_id_profiles_fkey fix above for why.
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT,
  sticker_emoji TEXT,
  sticker_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (content IS NOT NULL OR sticker_emoji IS NOT NULL OR sticker_url IS NOT NULL)
);

-- ============================================================
-- PROJECT STICKERS TABLE (custom stickers, shared within a project)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_stickers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT,
  url TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages: viewable/insertable by project members
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chat messages viewable by project members" ON chat_messages;

CREATE POLICY "Chat messages viewable by project members" ON chat_messages
  FOR SELECT USING (is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Chat messages insertable by project members" ON chat_messages;

CREATE POLICY "Chat messages insertable by project members" ON chat_messages
  FOR INSERT WITH CHECK (
    is_project_member(project_id, auth.uid()) AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Chat messages deletable by sender or owner" ON chat_messages;

CREATE POLICY "Chat messages deletable by sender or owner" ON chat_messages
  FOR DELETE USING (
    user_id = auth.uid() OR is_project_owner(project_id, auth.uid())
  );

-- Project stickers: viewable/insertable by project members
ALTER TABLE project_stickers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Stickers viewable by project members" ON project_stickers;

CREATE POLICY "Stickers viewable by project members" ON project_stickers
  FOR SELECT USING (is_project_member(project_id, auth.uid()));

DROP POLICY IF EXISTS "Stickers insertable by project members" ON project_stickers;

CREATE POLICY "Stickers insertable by project members" ON project_stickers
  FOR INSERT WITH CHECK (
    is_project_member(project_id, auth.uid()) AND uploaded_by = auth.uid()
  );

DROP POLICY IF EXISTS "Stickers deletable by uploader or owner" ON project_stickers;

CREATE POLICY "Stickers deletable by uploader or owner" ON project_stickers
  FOR DELETE USING (
    uploaded_by = auth.uid() OR is_project_owner(project_id, auth.uid())
  );

-- Notifications: Users can only see their own
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notifications viewable by owner" ON notifications;

CREATE POLICY "Notifications viewable by owner" ON notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Notifications insertable by system" ON notifications;

CREATE POLICY "Notifications insertable by system" ON notifications
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Notifications updatable by owner" ON notifications;

CREATE POLICY "Notifications updatable by owner" ON notifications
  FOR UPDATE USING (user_id = auth.uid());

-- ============================================================
-- STORAGE BUCKET SETUP
-- ============================================================
-- Go to Supabase Dashboard > Storage > New Bucket:
-- Bucket name: project-files
-- Public: YES
-- File size limit: 50MB
-- Allowed MIME types: image/*, application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document

-- Storage RLS Policies (run in SQL editor after creating bucket):
-- DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage;

DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
CREATE POLICY "Allow authenticated uploads" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'project-files');
--
-- DROP POLICY IF EXISTS "Allow public read" ON storage;

DROP POLICY IF EXISTS "Allow public read" ON storage.objects;
CREATE POLICY "Allow public read" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'project-files');
--
-- DROP POLICY IF EXISTS "Allow owners to delete" ON storage;

DROP POLICY IF EXISTS "Allow owners to delete" ON storage.objects;
CREATE POLICY "Allow owners to delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'project-files' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Bucket for chat stickers: created directly via SQL (rather than the
-- Dashboard click-through above) since it's simpler to keep this file the
-- single source of truth for both buckets.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-stickers', 'project-stickers', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow authenticated sticker uploads" ON storage.objects;
CREATE POLICY "Allow authenticated sticker uploads" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'project-stickers');

DROP POLICY IF EXISTS "Allow public sticker read" ON storage.objects;
CREATE POLICY "Allow public sticker read" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'project-stickers');

DROP POLICY IF EXISTS "Allow uploader to delete stickers" ON storage.objects;
CREATE POLICY "Allow uploader to delete stickers" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'project-stickers' AND owner = auth.uid());

-- ============================================================
-- REALTIME SUBSCRIPTIONS
-- ============================================================
-- Enable Realtime for these tables in Dashboard > Database > Replication:
-- - projects
-- - tasks
-- - files
-- - notifications

-- chat_messages needs live delivery for the chat feature, added directly
-- rather than relying on the manual Dashboard toggle above.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END $$;

-- ============================================================
-- INDEXES (for performance)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_profiles_timezone ON profiles(timezone);
CREATE INDEX IF NOT EXISTS idx_profiles_language ON profiles(language);
CREATE INDEX IF NOT EXISTS idx_chat_messages_project ON chat_messages(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_stickers_project ON project_stickers(project_id);


-- ============================================================
-- SUBSCRIPTIONS TABLE (Stripe billing)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  status TEXT DEFAULT 'inactive' CHECK (status IN ('active', 'canceled', 'past_due', 'inactive')),
  price_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Add is_pro to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT FALSE;

-- RLS for subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own subscription" ON subscriptions;

CREATE POLICY "Users can view own subscription" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Index for subscription lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);

-- ============================================================
-- PRO TIER LIMITS — file size tracking for storage quota
-- ============================================================
-- Free: 4 projects, 5 members/project, 1GB storage/project
-- Pro ($5/mo): unlimited projects, unlimited members, 5GB storage/project
ALTER TABLE files ADD COLUMN IF NOT EXISTS size BIGINT DEFAULT 0;

-- The stripe-webhook function inserts a 'payment_failed' notification on
-- invoice.payment_failed, but the original CHECK constraint (below) didn't
-- allow that type — the insert would silently fail. Widen it for existing
-- databases (CREATE TABLE IF NOT EXISTS above only helps fresh installs).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('task_assigned', 'task_completed', 'deadline_warning', 'hourly_reminder', 'project_invite', 'payment_failed'));

-- Atomic, RLS-safe join: a non-member can't SELECT project_members to
-- count them (see RLS policy above), so the 5-member free cap has to be
-- enforced inside a SECURITY DEFINER function rather than client-side.
CREATE OR REPLACE FUNCTION public.join_project_with_limit(p_project_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_member_count INTEGER;
  v_owner_is_pro BOOLEAN;
  v_already_member BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM project_members WHERE project_id = p_project_id AND user_id = auth.uid()
  ) INTO v_already_member;

  IF v_already_member THEN
    RETURN 'already_member';
  END IF;

  SELECT COUNT(*) INTO v_member_count FROM project_members WHERE project_id = p_project_id;

  SELECT COALESCE(p.is_pro, FALSE) INTO v_owner_is_pro
  FROM project_members pm
  JOIN profiles p ON p.id = pm.user_id
  WHERE pm.project_id = p_project_id AND pm.role = 'owner'
  LIMIT 1;

  IF NOT COALESCE(v_owner_is_pro, FALSE) AND v_member_count >= 5 THEN
    RETURN 'limit_reached';
  END IF;

  INSERT INTO project_members (project_id, user_id, role)
  VALUES (p_project_id, auth.uid(), 'member');

  RETURN 'joined';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.join_project_with_limit(UUID) TO authenticated;
