// ============================================================
// ProjectSync — Complete App with Supabase Backend
// Replace the placeholders below with your actual Supabase credentials
// ============================================================

const SUPABASE_URL = 'https://lanvvptfxnfjfupwpnuj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhbnZ2cHRmeG5mamZ1cHdwbnVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxOTM5ODAsImV4cCI6MjA5OTc2OTk4MH0.H_jc0WBma0gIO0c6sjcr57bbZcnk-dtZZImUybpT-Z8';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// PLAN LIMITS — Free vs Pro ($5/mo)
// ============================================================
const PLAN_LIMITS = {
  free: { projects: 5, members: 8, storageBytes: 1 * 1024 * 1024 * 1024 },
  pro: { projects: Infinity, members: Infinity, storageBytes: 5 * 1024 * 1024 * 1024 },
};

const BUILTIN_STICKERS = ['😀', '😂', '❤️', '🎉', '🔥', '👍', '👏', '😢', '😮', '🙏', '💯', '✅', '❌', '🥳', '😴', '🤔'];

const LANGUAGES = {
  en: { code: 'EN', name: 'English' },
  ms: { code: 'MS', name: 'Bahasa Melayu' },
  zh: { code: '中文', name: '中文' },
  es: { code: 'ES', name: 'Español' },
  ja: { code: 'JA', name: '日本語' },
  ko: { code: 'KO', name: '한국어' },
};

const EDU_LEVELS = {
  middle: { label: 'Middle School', badgeClass: 'edu-middle' },
  high: { label: 'High School', badgeClass: 'edu-high' },
  uni: { label: 'University', badgeClass: 'edu-uni' },
  self: { label: 'Self-Learner', badgeClass: 'edu-self' },
};

const app = {
  user: null,
  userProfile: null,
  projects: [],
  currentProject: null,
  taskFilter: 'all',
  projectTab: 'tasks',
  stickerTab: 'builtin',
  chatChannel: null,
  aiSuggestions: [],
  emailAuthMode: 'signin',

  // ===================== INIT =====================
  async init() {
    this.showLoading(true);
    this.initTheme();
    this.initLanguage();

    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session) {
      this.user = session.user;
      await this.loadUserProfile();
      this.showMainApp();
      await this.loadProjects();
    } else {
      this.showAuthScreen();
    }

    this.showLoading(false);

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        this.user = session.user;
        await this.loadUserProfile();
        this.showMainApp();
        await this.loadProjects();
      } else if (event === 'SIGNED_OUT') {
        this.user = null;
        this.userProfile = null;
        this.unsubscribeChat();
        this.showAuthScreen();
      }
    });
  },

  // ===================== THEME =====================
  initTheme() {
    this.updateThemeButtons();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('theme') || 'system') === 'system') this.applyTheme();
    });
  },

  applyTheme() {
    const stored = localStorage.getItem('theme') || 'system';
    const isDark = stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
  },

  setTheme(mode) {
    localStorage.setItem('theme', mode);
    this.applyTheme();
    this.updateThemeButtons();
  },

  updateThemeButtons() {
    const mode = localStorage.getItem('theme') || 'system';
    ['light', 'dark', 'system'].forEach(m => {
      const btn = document.getElementById('themeBtn' + m.charAt(0).toUpperCase() + m.slice(1));
      if (btn) btn.classList.toggle('active', m === mode);
    });
  },

  // ===================== LANGUAGE =====================
  initLanguage() {
    this.language = localStorage.getItem('language') || 'en';
    this.applyLanguageUI();
  },

  setLanguage(lang) {
    if (!LANGUAGES[lang]) return;
    this.language = lang;
    localStorage.setItem('language', lang);
    this.applyLanguageUI();
    this.hideLanguagePicker();
  },

  applyLanguageUI() {
    const info = LANGUAGES[this.language] || LANGUAGES.en;

    const indicator = document.getElementById('langIndicator');
    if (indicator) indicator.textContent = info.code;

    const currentLanguageEl = document.getElementById('currentLanguage');
    if (currentLanguageEl) currentLanguageEl.textContent = info.name;

    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === this.language);
    });

    Object.keys(LANGUAGES).forEach(code => {
      const check = document.getElementById('check-' + code);
      if (check) check.classList.toggle('hidden', code !== this.language);
    });
  },

  showLanguagePicker() {
    this.openSheet('languageModal');
  },

  hideLanguagePicker() {
    this.closeSheet('languageModal');
  },

  // ===================== EDUCATION LEVEL =====================
  setEduLevel(level) {
    if (!EDU_LEVELS[level]) return;
    this.eduLevel = level;
    document.querySelectorAll('.edu-level-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.edu === level);
    });
  },

  renderEduLevelBadge() {
    const badge = document.getElementById('eduLevelBadge');
    if (!badge) return;
    const info = EDU_LEVELS[this.userProfile?.edu_level] || EDU_LEVELS.high;
    badge.innerHTML = '<span class="edu-level-badge ' + info.badgeClass + '">' + info.label + '</span>';
  },

  // ===================== SHEETS / MODALS =====================
  // Shared open/close for bottom sheets and the notifications side panel.
  // Sheets sit closed (sheet-hidden / side-hidden) by default in the DOM;
  // openSheet un-hides the wrapper then removes that class a frame later so
  // the transition actually runs, and closeSheet reverses it — waiting for
  // transitionend (with a timeout fallback) before re-hiding the wrapper —
  // so close mirrors open instead of teleporting away.
  openSheet(modalId) {
    const modal = document.getElementById(modalId);
    const panel = modal.querySelector('.sheet-panel, .side-panel');
    const overlay = modal.querySelector('.modal-overlay');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
      if (overlay) overlay.classList.remove('overlay-hidden');
      if (panel) panel.classList.remove('sheet-hidden', 'side-hidden');
    });
  },

  closeSheet(modalId) {
    const modal = document.getElementById(modalId);
    if (modal.classList.contains('hidden')) return;

    const panel = modal.querySelector('.sheet-panel, .side-panel');
    const overlay = modal.querySelector('.modal-overlay');
    if (overlay) overlay.classList.add('overlay-hidden');

    if (!panel) {
      modal.classList.add('hidden');
      return;
    }

    const finish = () => modal.classList.add('hidden');
    panel.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 300);
    panel.classList.add(panel.classList.contains('side-panel') ? 'side-hidden' : 'sheet-hidden');
  },

  // ===================== AUTH =====================
  showAuthScreen() {
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
  },

  showMainApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    this.updateHeader();
  },

  async signInWithGoogle() {
    this.showLoading(true);
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/app' }
    });
    if (error) this.showToast(error.message, 'error');
    this.showLoading(false);
  },

  showEmailAuth() {
    this.openSheet('emailAuthModal');
    this.emailAuthMode = 'signin';
    this.updateEmailAuthUI();
  },

  hideEmailAuth() {
    this.closeSheet('emailAuthModal');
  },

  toggleEmailAuthMode() {
    this.emailAuthMode = this.emailAuthMode === 'signin' ? 'signup' : 'signin';
    this.updateEmailAuthUI();
  },

  updateEmailAuthUI() {
    const isSignIn = this.emailAuthMode === 'signin';
    document.getElementById('emailAuthTitle').textContent = isSignIn ? 'Sign In' : 'Sign Up';
    document.getElementById('emailAuthBtnText').textContent = isSignIn ? 'Sign In' : 'Create Account';
    document.getElementById('emailAuthToggleText').textContent = isSignIn ? "Don't have an account?" : "Already have an account?";
    document.getElementById('emailAuthToggleBtn').textContent = isSignIn ? 'Sign Up' : 'Sign In';
  },

  async handleEmailAuth() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;

    if (!email || !password) {
      this.showToast('Please fill in all fields', 'error');
      return;
    }
    if (password.length < 6) {
      this.showToast('Password must be at least 6 characters', 'error');
      return;
    }

    this.showLoading(true);

    if (this.emailAuthMode === 'signin') {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) this.showToast(error.message, 'error');
      else {
        this.hideEmailAuth();
        this.showToast('Welcome back!', 'success');
      }
    } else {
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) this.showToast(error.message, 'error');
      else {
        this.hideEmailAuth();
        this.showToast('Account created! Check your email to verify.', 'success');
      }
    }

    this.showLoading(false);
  },

  async signOut() {
    this.showLoading(true);
    await supabaseClient.auth.signOut();
    this.hideProfile();
    this.showLoading(false);
  },

  // ===================== USER PROFILE =====================
  async loadUserProfile() {
    if (!this.user) return;

    // edu_level is only included when the auth-screen selector was actually
    // touched this session (undefined keys are dropped by JSON.stringify),
    // so returning users don't have their saved level silently overwritten.
    const { data, error } = await supabaseClient
      .from('profiles')
      .upsert({
        id: this.user.id,
        email: this.user.email,
        name: this.user.user_metadata?.full_name || this.user.email.split('@')[0],
        avatar_url: this.user.user_metadata?.avatar_url || '',
        school: 'SMK Bukit Mertajam',
        edu_level: this.eduLevel,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' })
      .select()
      .single();

    if (data) {
      this.userProfile = data;
      this.updateHeader();
      this.renderEduLevelBadge();
    }
  },

  updateHeader() {
    if (!this.user) return;
    const name = this.user.user_metadata?.full_name || this.user.email.split('@')[0];
    document.getElementById('headerGreeting').textContent = 'Hey, ' + name.split(' ')[0] + '!';
    const avatarUrl = this.user.user_metadata?.avatar_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=2563eb&color=fff';
    document.getElementById('headerAvatar').src = avatarUrl;
    document.getElementById('profileAvatar').src = avatarUrl;
    document.getElementById('profileName').textContent = name;
    document.getElementById('profileEmail').textContent = this.user.email;
  },

  // ===================== PROJECTS =====================
  async loadProjects() {
    this.showLoading(true);

    const { data: memberships } = await supabaseClient
      .from('project_members')
      .select('project_id')
      .eq('user_id', this.user.id);

    if (!memberships?.length) {
      this.projects = [];
      this.renderDashboard();
      this.showLoading(false);
      return;
    }

    const projectIds = memberships.map(m => m.project_id);

    const { data: projects, error } = await supabaseClient
      .from('projects')
      .select(`
        *,
        tasks:tasks(*),
        files:files(*),
        members:project_members(user_id, role, profiles(id, name, avatar_url, is_pro))
      `)
      .in('id', projectIds)
      .order('created_at', { ascending: false });

    if (error) {
      this.showToast('Failed to load projects', 'error');
      console.error(error);
    } else {
      this.projects = projects || [];
      this.renderDashboard();
    }

    this.showLoading(false);
  },

  renderDashboard() {
    const totalProjects = this.projects.length;
    let totalPending = 0;
    let totalDone = 0;

    this.projects.forEach(p => {
      const tasks = p.tasks || [];
      totalPending += tasks.filter(t => t.status !== 'done').length;
      totalDone += tasks.filter(t => t.status === 'done').length;
    });

    document.getElementById('statTotal').textContent = totalProjects;
    document.getElementById('statPending').textContent = totalPending;
    document.getElementById('statDone').textContent = totalDone;

    const telegramBanner = document.getElementById('telegramBanner');
    if (this.userProfile?.telegram_chat_id) {
      telegramBanner.classList.add('hidden');
    } else {
      telegramBanner.classList.remove('hidden');
    }

    const allTasks = [];
    this.projects.forEach(p => {
      (p.tasks || []).forEach(t => {
        if (t.status !== 'done' && t.due_date) {
          allTasks.push({ ...t, projectName: p.name });
        }
      });
    });

    allTasks.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    const upcoming = allTasks.slice(0, 3);

    let deadlinesHtml = '';
    if (upcoming.length === 0) {
      deadlinesHtml = '<div class="bg-white dark:bg-slate-800 rounded-2xl p-6 text-center card-shadow"><div class="w-12 h-12 bg-success-50 dark:bg-success-500/10 rounded-full flex items-center justify-center mx-auto mb-2"><i class="fas fa-check text-success-500"></i></div><p class="text-sm text-slate-400 dark:text-slate-500">No upcoming deadlines!</p></div>';
    } else {
      deadlinesHtml = upcoming.map(t => {
        const daysLeft = Math.ceil((new Date(t.due_date) - new Date()) / (1000 * 60 * 60 * 24));
        const isUrgent = daysLeft <= 1;
        const isSoon = daysLeft <= 3;
        const colorClass = isUrgent ? 'bg-accent-50 dark:bg-accent-500/10 border-accent-200 dark:border-accent-500/30' : isSoon ? 'bg-warning-50 dark:bg-warning-500/10 border-warning-200 dark:border-warning-500/30' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-800';
        const iconColor = isUrgent ? 'text-accent-500' : isSoon ? 'text-warning-500' : 'text-slate-400 dark:text-slate-500';
        const dueText = daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Due today' : daysLeft === 1 ? 'Due tomorrow' : daysLeft + ' days left';

        return '<div class="' + colorClass + ' border rounded-2xl p-4 card-shadow flex items-center gap-3 cursor-pointer btn-press" onclick="app.openProject(\'' + t.project_id + '\')"><div class="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 flex items-center justify-center flex-shrink-0"><i class="fas fa-clock ' + iconColor + ' text-sm"></i></div><div class="flex-1 min-w-0"><p class="font-medium text-sm text-slate-800 dark:text-slate-100 truncate">' + this.escapeHtml(t.title) + '</p><p class="text-xs text-slate-400 dark:text-slate-500">' + this.escapeHtml(t.projectName) + ' &bull; ' + dueText + '</p></div><span class="text-xs font-medium ' + (isUrgent ? 'text-accent-500' : isSoon ? 'text-warning-500' : 'text-slate-400 dark:text-slate-500') + '">' + dueText + '</span></div>';
      }).join('');
    }

    document.getElementById('deadlinesList').innerHTML = deadlinesHtml;

    let projectsHtml = '';
    if (this.projects.length === 0) {
      projectsHtml = '<div class="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center card-shadow"><div class="w-16 h-16 bg-primary-50 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-3"><i class="fas fa-folder-open text-primary-400 text-xl"></i></div><p class="text-slate-400 dark:text-slate-500 text-sm mb-1">No projects yet</p><p class="text-slate-300 dark:text-slate-600 text-xs">Tap + to create your first project</p></div>';
    } else {
      projectsHtml = this.projects.map(p => {
        const tasks = p.tasks || [];
        const total = tasks.length;
        const done = tasks.filter(t => t.status === 'done').length;
        const progress = total > 0 ? Math.round((done / total) * 100) : 0;
        const members = (p.members || []).slice(0, 3);
        const daysLeft = p.deadline ? Math.ceil((new Date(p.deadline) - new Date()) / (1000 * 60 * 60 * 24)) : null;

        let memberAvatars = '';
        members.forEach(m => {
          const avatar = m.profiles?.avatar_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(m.profiles?.name || '?') + '&background=random';
          memberAvatars += '<img src="' + avatar + '" class="w-7 h-7 rounded-full border-2 border-white dark:border-slate-800 object-cover" alt="">';
        });
        const extraMembers = (p.members || []).length > 3 ? '<div class="w-7 h-7 rounded-full border-2 border-white dark:border-slate-800 bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-[9px] font-bold text-slate-500 dark:text-slate-400">+' + ((p.members || []).length - 3) + '</div>' : '';

        return '<div class="bg-white dark:bg-slate-800 rounded-2xl p-5 card-shadow cursor-pointer btn-press" onclick="app.openProject(\'' + p.id + '\')"><div class="flex items-start justify-between mb-3"><div><div class="flex items-center gap-2 mb-1"><span class="text-xs font-medium px-2 py-0.5 bg-primary-50 dark:bg-primary-900/30 text-primary-600 rounded-md">' + this.escapeHtml(p.subject || 'General') + '</span>' + (daysLeft !== null ? '<span class="text-xs ' + (daysLeft <= 1 ? 'text-accent-500' : daysLeft <= 3 ? 'text-warning-500' : 'text-slate-400 dark:text-slate-500') + '">' + (daysLeft <= 0 ? 'Overdue' : daysLeft + ' days left') + '</span>' : '') + '</div><h3 class="font-bold text-slate-800 dark:text-slate-100 text-sm">' + this.escapeHtml(p.name) + '</h3></div><div class="w-10 h-10 relative flex-shrink-0"><svg class="w-10 h-10 progress-ring" viewBox="0 0 36 36"><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e2e8f0" stroke-width="3"/><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="' + (progress === 100 ? '#22c55e' : progress > 50 ? '#3b82f6' : '#f59e0b') + '" stroke-width="3" stroke-dasharray="' + progress + ', 100" stroke-linecap="round"/></svg><span class="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300">' + progress + '%</span></div></div><div class="flex items-center justify-between"><div class="flex -space-x-2">' + memberAvatars + extraMembers + '</div><p class="text-xs text-slate-400 dark:text-slate-500">' + done + '/' + total + ' tasks done</p></div></div>';
      }).join('');
    }

    document.getElementById('projectsList').innerHTML = projectsHtml;
  },

  // ===================== PLAN / LIMITS =====================
  planLimits(isPro) {
    return isPro ? PLAN_LIMITS.pro : PLAN_LIMITS.free;
  },

  projectOwnerIsPro(project) {
    const owner = (project.members || []).find(m => m.role === 'owner');
    return !!owner?.profiles?.is_pro;
  },

  isProjectLeader(project) {
    return (project.members || []).some(m => m.user_id === this.user.id && m.role === 'owner');
  },

  projectStorageUsed(project) {
    return (project.files || []).reduce((sum, f) => sum + (f.size || 0), 0);
  },

  formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + 'MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + 'KB';
    return bytes + 'B';
  },

  promptUpgrade(message) {
    this.showToast(message, 'error');
    if (window.stripePayments) stripePayments.showUpgradeModal();
  },

  // ===================== PROJECT DETAIL =====================
  async openProject(projectId) {
    this.currentProject = this.projects.find(p => p.id === projectId);
    if (!this.currentProject) return;

    document.getElementById('dashboardView').classList.add('hidden');
    document.getElementById('projectDetailView').classList.remove('hidden');

    document.getElementById('navHomeIcon').classList.remove('text-primary-600');
    document.getElementById('navHomeIcon').classList.add('text-slate-400', 'dark:text-slate-500');
    document.getElementById('navHomeText').classList.remove('text-primary-600');
    document.getElementById('navHomeText').classList.add('text-slate-400', 'dark:text-slate-500');

    this.renderProjectDetail();
    this.setProjectTab('tasks');
  },

  renderProjectDetail() {
    const p = this.currentProject;
    const tasks = p.tasks || [];
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    const daysLeft = p.deadline ? Math.ceil((new Date(p.deadline) - new Date()) / (1000 * 60 * 60 * 24)) : null;

    let deadlineText = '';
    if (p.deadline) {
      const dateStr = new Date(p.deadline).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
      const daysText = daysLeft !== null ? ' &bull; <span class="' + (daysLeft <= 1 ? 'text-accent-500' : daysLeft <= 3 ? 'text-warning-500' : '') + '">' + (daysLeft <= 0 ? 'Overdue' : daysLeft + ' days left') + '</span>' : '';
      deadlineText = '<p class="text-xs text-slate-400 dark:text-slate-500 mt-1"><i class="far fa-calendar mr-1"></i> Due ' + dateStr + daysText + '</p>';
    }

    document.getElementById('projectHeader').innerHTML = '<div class="flex items-start justify-between mb-3"><div><span class="text-xs font-medium px-2 py-0.5 bg-primary-50 dark:bg-primary-900/30 text-primary-600 rounded-md">' + this.escapeHtml(p.subject || 'General') + '</span><h2 class="font-bold text-slate-800 dark:text-slate-100 text-lg mt-2">' + this.escapeHtml(p.name) + '</h2>' + deadlineText + '</div></div><div class="flex items-center gap-3"><div class="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden"><div class="h-full rounded-full transition-all duration-500 ' + (progress === 100 ? 'bg-success-500' : progress > 50 ? 'bg-primary-500' : 'bg-warning-500') + '" style="width: ' + progress + '%"></div></div><span class="text-xs font-bold text-slate-600 dark:text-slate-300">' + progress + '%</span></div>';
  },

  // ===================== PROJECT TABS =====================
  setProjectTab(tab) {
    this.projectTab = tab;
    const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

    ['tasks', 'chat', 'files', 'members'].forEach(t => {
      const btn = document.getElementById('ptab' + cap(t));
      if (t === tab) {
        btn.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-slate-100', 'card-shadow');
        btn.classList.remove('text-slate-400', 'dark:text-slate-500');
      } else {
        btn.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-slate-100', 'card-shadow');
        btn.classList.add('text-slate-400', 'dark:text-slate-500');
      }
    });

    // Cross-fade the panel swap instead of an instant hidden-class toggle.
    // The old panel is found by DOM state (not the tab arg) so the very
    // first call for a freshly opened project — where Tasks is already the
    // visible panel — shows content immediately with no pointless fade.
    const newPanel = document.getElementById('projectPanel' + cap(tab));
    const oldPanel = ['tasks', 'chat', 'files', 'members']
      .map(t => document.getElementById('projectPanel' + cap(t)))
      .find(panel => panel !== newPanel && !panel.classList.contains('hidden'));

    const showNewPanel = () => {
      if (tab === 'tasks') this.renderTasks();
      if (tab === 'files') this.renderFiles();
      if (tab === 'members') this.renderMembers();
      if (tab === 'chat') {
        this.loadChatMessages();
        this.subscribeToChat(this.currentProject.id);
      } else {
        this.unsubscribeChat();
      }

      newPanel.classList.remove('hidden');
      newPanel.classList.add('panel-fade-hidden');
      requestAnimationFrame(() => newPanel.classList.remove('panel-fade-hidden'));
    };

    if (!oldPanel) {
      showNewPanel();
      return;
    }

    oldPanel.classList.add('panel-fade-hidden');
    setTimeout(() => {
      oldPanel.classList.add('hidden');
      oldPanel.classList.remove('panel-fade-hidden');
      showNewPanel();
    }, 120);
  },

  setTaskFilter(filter) {
    this.taskFilter = filter;

    ['all', 'todo', 'in_progress', 'done'].forEach(f => {
      const btnId = 'filter' + f.charAt(0).toUpperCase() + f.slice(1).replace('_', '');
      const btn = document.getElementById(btnId);
      if (f === filter) {
        btn.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-slate-100', 'card-shadow');
        btn.classList.remove('text-slate-400', 'dark:text-slate-500');
      } else {
        btn.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-slate-100', 'card-shadow');
        btn.classList.add('text-slate-400', 'dark:text-slate-500');
      }
    });

    this.renderTasks();
  },

  renderTasks() {
    const p = this.currentProject;
    let tasks = p.tasks || [];

    const isLeader = this.isProjectLeader(p);
    document.getElementById('addTaskBtn').classList.toggle('hidden', !isLeader);
    document.getElementById('aiBreakdownBtn').classList.toggle('hidden', !isLeader);

    if (this.taskFilter !== 'all') {
      tasks = tasks.filter(t => t.status === this.taskFilter);
    }

    tasks.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return new Date(a.due_date || '9999') - new Date(b.due_date || '9999');
    });

    let html = '';
    if (tasks.length === 0) {
      html = '<div class="text-center py-8"><div class="w-12 h-12 bg-slate-50 dark:bg-slate-900 rounded-full flex items-center justify-center mx-auto mb-2"><i class="fas fa-clipboard-check text-slate-300 dark:text-slate-600 text-lg"></i></div><p class="text-xs text-slate-400 dark:text-slate-500">No tasks here</p></div>';
    } else {
      html = tasks.map(t => {
        const assignee = p.members?.find(m => m.user_id === t.assignee)?.profiles;
        const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done';
        const assigneeName = assignee ? assignee.name?.split(' ')[0] || '?' : '?';
        const assigneeAvatar = assignee?.avatar_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(assigneeName) + '&background=random&size=16';

        let statusBtn = '';
        if (t.status === 'done') {
          statusBtn = '<button onclick="app.cycleTaskStatus(\'' + t.id + '\')" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 btn-press bg-success-500 border-success-500"><i class="fas fa-check text-white text-[10px]"></i></button>';
        } else if (t.status === 'in_progress') {
          statusBtn = '<button onclick="app.cycleTaskStatus(\'' + t.id + '\')" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 btn-press border-primary-500 bg-primary-50 dark:bg-primary-900/30"><div class="w-2 h-2 bg-primary-500 rounded-full"></div></button>';
        } else {
          statusBtn = '<button onclick="app.cycleTaskStatus(\'' + t.id + '\')" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 btn-press border-slate-300 dark:border-slate-600"></button>';
        }

        const titleClass = t.status === 'done' ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100';
        const descHtml = t.description ? '<p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5 line-clamp-2">' + this.escapeHtml(t.description) + '</p>' : '';

        const assigneeHtml = assignee ? '<div class="flex items-center gap-1"><img src="' + assigneeAvatar + '" class="w-4 h-4 rounded-full object-cover"><span class="text-[10px] text-slate-400 dark:text-slate-500">' + this.escapeHtml(assigneeName) + '</span></div>' : '';

        const dueHtml = t.due_date ? '<span class="text-[10px] ' + (isOverdue ? 'text-accent-500 font-medium' : 'text-slate-400 dark:text-slate-500') + '"><i class="far fa-clock mr-0.5"></i>' + new Date(t.due_date).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) + '</span>' : '';

        const priorityClass = t.priority === 'high' ? 'bg-accent-50 dark:bg-accent-500/10 text-accent-500' : t.priority === 'medium' ? 'bg-warning-50 dark:bg-warning-500/10 text-warning-500' : 'bg-success-50 dark:bg-success-500/10 text-success-500';

        return '<div class="bg-white dark:bg-slate-800 rounded-2xl p-4 card-shadow task-card priority-' + (t.priority || 'medium') + ' ' + (isOverdue ? 'bg-accent-50 dark:bg-accent-500/10' : '') + '"><div class="flex items-start gap-3">' + statusBtn + '<div class="flex-1 min-w-0"><p class="font-medium text-sm ' + titleClass + '">' + this.escapeHtml(t.title) + '</p>' + descHtml + '<div class="flex items-center gap-2 mt-2">' + assigneeHtml + dueHtml + '<span class="text-[10px] px-1.5 py-0.5 rounded ' + priorityClass + '">' + t.priority + '</span></div></div><button onclick="app.deleteTask(\'' + t.id + '\')" class="text-slate-300 dark:text-slate-600 hover:text-accent-400 btn-press p-1"><i class="fas fa-trash-alt text-xs"></i></button></div></div>';
      }).join('');
    }

    document.getElementById('tasksList').innerHTML = html;

    const assigneeSelect = document.getElementById('newTaskAssignee');
    let options = '<option value="">Select member...</option>';
    (p.members || []).forEach(m => {
      options += '<option value="' + m.user_id + '">' + this.escapeHtml(m.profiles?.name || 'Unknown') + '</option>';
    });
    assigneeSelect.innerHTML = options;
  },

  renderFiles() {
    const p = this.currentProject;
    const files = p.files || [];

    const isPro = this.projectOwnerIsPro(p);
    const limits = this.planLimits(isPro);
    const used = this.projectStorageUsed(p);
    const pct = Math.min(100, Math.round((used / limits.storageBytes) * 100));
    const barColor = pct >= 90 ? 'bg-accent-500' : pct >= 70 ? 'bg-warning-500' : 'bg-primary-500';

    document.getElementById('storageUsageBar').innerHTML =
      '<div class="flex items-center justify-between mb-1"><span class="text-[10px] text-slate-400 dark:text-slate-500 font-medium">' + this.formatBytes(used) + ' of ' + this.formatBytes(limits.storageBytes) + ' used' + (isPro ? ' (Pro)' : '') + '</span></div>' +
      '<div class="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden"><div class="h-full ' + barColor + ' rounded-full transition-all duration-500" style="width:' + pct + '%"></div></div>';

    let html = '';
    if (files.length === 0) {
      html = '<div class="text-center py-4"><p class="text-xs text-slate-400 dark:text-slate-500">No files uploaded yet</p></div>';
    } else {
      html = files.map(f => {
        let icon = 'fa-file text-slate-400';
        if (f.name?.endsWith('.pdf')) icon = 'fa-file-pdf text-accent-500';
        else if (f.name?.match(/\.(jpg|jpeg|png|gif)$/i)) icon = 'fa-file-image text-primary-500';
        else if (f.name?.match(/\.(doc|docx)$/i)) icon = 'fa-file-word text-blue-500';

        return '<a href="' + f.url + '" target="_blank" class="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-xl p-3 card-shadow btn-press"><div class="w-10 h-10 bg-slate-50 dark:bg-slate-900 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fas ' + icon + ' text-lg"></i></div><div class="flex-1 min-w-0"><p class="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">' + this.escapeHtml(f.name) + '</p><p class="text-[10px] text-slate-400 dark:text-slate-500">' + new Date(f.created_at).toLocaleDateString('en-MY') + '</p></div><i class="fas fa-external-link-alt text-slate-300 dark:text-slate-600 text-xs"></i></a>';
      }).join('');
    }
    document.getElementById('filesList').innerHTML = html;
  },

  renderMembers() {
    const members = this.currentProject.members || [];
    const html = members.map(m => {
      const avatar = m.profiles?.avatar_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(m.profiles?.name || '?') + '&background=random&size=24';
      const roleBadge = m.role === 'owner' ? '<span class="text-[9px] bg-primary-100 dark:bg-primary-900/30 text-primary-600 px-1.5 py-0.5 rounded font-medium">Leader</span>' : '';
      return '<div class="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-xl px-3 py-2 card-shadow"><img src="' + avatar + '" class="w-6 h-6 rounded-full object-cover" alt=""><span class="text-xs font-medium text-slate-700 dark:text-slate-300">' + this.escapeHtml(m.profiles?.name?.split(' ')[0] || '?') + '</span>' + roleBadge + '</div>';
    }).join('');
    document.getElementById('membersList').innerHTML = html;
  },

  // ===================== CHAT =====================
  async loadChatMessages() {
    const { data, error } = await supabaseClient
      .from('chat_messages')
      .select('*, profiles(name, avatar_url)')
      .eq('project_id', this.currentProject.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error(error);
      return;
    }

    this.chatMessages = data || [];
    this.renderChatMessages();
  },

  subscribeToChat(projectId) {
    if (this.chatChannel) return;

    this.chatChannel = supabaseClient
      .channel('chat:' + projectId)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: 'project_id=eq.' + projectId
      }, async (payload) => {
        const sender = (this.currentProject.members || []).find(m => m.user_id === payload.new.user_id)?.profiles;
        this.chatMessages = this.chatMessages || [];
        this.chatMessages.push({ ...payload.new, profiles: sender });
        // Only a live-arriving message gets an enter transition — bulk loads
        // (opening the chat tab, switching projects) render instantly.
        this._chatEnterId = payload.new.id;
        this.renderChatMessages();
      })
      .subscribe();
  },

  unsubscribeChat() {
    if (this.chatChannel) {
      supabaseClient.removeChannel(this.chatChannel);
      this.chatChannel = null;
    }
  },

  renderChatMessages() {
    const messages = this.chatMessages || [];
    const container = document.getElementById('chatMessages');
    if (!container) return;

    if (messages.length === 0) {
      container.innerHTML = '<div class="text-center py-8"><p class="text-xs text-slate-400 dark:text-slate-500">No messages yet — say hi!</p></div>';
      return;
    }

    const GROUP_GAP_MS = 5 * 60 * 1000;
    const enterId = this._chatEnterId;
    this._chatEnterId = null;

    container.innerHTML = messages.map((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const isFirstInGroup = !prev || prev.user_id !== m.user_id || (new Date(m.created_at) - new Date(prev.created_at)) > GROUP_GAP_MS;
      const isLastInGroup = !next || next.user_id !== m.user_id || (new Date(next.created_at) - new Date(m.created_at)) > GROUP_GAP_MS;

      const isMe = m.user_id === this.user.id;
      const name = m.profiles?.name?.split(' ')[0] || '?';
      const avatar = m.profiles?.avatar_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=random&size=24';
      const time = new Date(m.created_at).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });

      let bodyHtml;
      if (m.sticker_emoji) {
        bodyHtml = '<span class="text-5xl leading-none">' + m.sticker_emoji + '</span>';
      } else if (m.sticker_url) {
        bodyHtml = '<img src="' + m.sticker_url + '" class="w-24 h-24 object-contain">';
      } else {
        const bubbleClass = isMe ? 'bg-primary-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 card-shadow';
        bodyHtml = '<div class="' + bubbleClass + ' rounded-2xl px-4 py-2.5 text-sm break-words">' + this.escapeHtml(m.content) + '</div>';
      }

      const nameHtml = (!isMe && isFirstInGroup) ? '<span class="text-[10px] font-medium text-slate-400 dark:text-slate-500 mb-1">' + this.escapeHtml(name) + '</span>' : '';
      const timeHtml = isLastInGroup ? '<span class="text-[9px] text-slate-300 dark:text-slate-600 mt-0.5">' + time + '</span>' : '';
      const avatarHtml = !isMe ? (isLastInGroup ? '<img src="' + avatar + '" class="w-6 h-6 rounded-full object-cover flex-shrink-0" alt="">' : '<div class="w-6 flex-shrink-0"></div>') : '';
      const rowMargin = isFirstInGroup ? (i === 0 ? '' : 'mt-3 ') : 'mt-0.5 ';
      const enterClass = m.id === enterId ? ' msg-enter' : '';

      return '<div class="msg-row' + enterClass + ' ' + rowMargin + 'flex ' + (isMe ? 'justify-end' : 'justify-start') + '">' +
        '<div class="inline-flex items-end gap-2 max-w-[80%] ' + (isMe ? 'flex-row-reverse' : '') + '">' +
        avatarHtml +
        '<div class="flex flex-col min-w-0 ' + (isMe ? 'items-end' : 'items-start') + '">' + nameHtml + bodyHtml + timeHtml + '</div></div></div>';
    }).join('');

    if (enterId) {
      requestAnimationFrame(() => {
        const el = container.querySelector('.msg-enter');
        if (el) el.classList.remove('msg-enter');
      });
    }

    window.scrollTo({ top: document.body.scrollHeight });
  },

  async sendChatMessage() {
    const input = document.getElementById('chatInput');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';

    const { error } = await supabaseClient.from('chat_messages').insert({
      project_id: this.currentProject.id,
      user_id: this.user.id,
      content
    });

    if (error) {
      this.showToast('Failed to send message', 'error');
      console.error(error);
    }
  },

  async sendSticker(emoji, url) {
    this.hideStickerPicker();

    const { error } = await supabaseClient.from('chat_messages').insert({
      project_id: this.currentProject.id,
      user_id: this.user.id,
      sticker_emoji: emoji || null,
      sticker_url: url || null
    });

    if (error) {
      this.showToast('Failed to send sticker', 'error');
      console.error(error);
    }
  },

  // ===================== STICKERS =====================
  showStickerPicker() {
    this.openSheet('stickerPickerModal');
    this.setStickerTab('builtin');
  },

  hideStickerPicker() {
    this.closeSheet('stickerPickerModal');
  },

  setStickerTab(tab) {
    this.stickerTab = tab;
    const builtinBtn = document.getElementById('stickerTabBuiltin');
    const yoursBtn = document.getElementById('stickerTabYours');
    const builtinPanel = document.getElementById('stickerPanelBuiltin');
    const yoursPanel = document.getElementById('stickerPanelYours');

    if (tab === 'builtin') {
      builtinBtn.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-slate-100', 'card-shadow');
      builtinBtn.classList.remove('text-slate-400', 'dark:text-slate-500');
      yoursBtn.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-slate-100', 'card-shadow');
      yoursBtn.classList.add('text-slate-400', 'dark:text-slate-500');
      builtinPanel.classList.remove('hidden');
      yoursPanel.classList.add('hidden');
      this.renderBuiltinStickers();
    } else {
      yoursBtn.classList.add('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-slate-100', 'card-shadow');
      yoursBtn.classList.remove('text-slate-400', 'dark:text-slate-500');
      builtinBtn.classList.remove('bg-white', 'dark:bg-slate-700', 'text-slate-800', 'dark:text-slate-100', 'card-shadow');
      builtinBtn.classList.add('text-slate-400', 'dark:text-slate-500');
      yoursPanel.classList.remove('hidden');
      builtinPanel.classList.add('hidden');
      this.loadProjectStickers();
    }
  },

  renderBuiltinStickers() {
    document.getElementById('stickerPanelBuiltin').innerHTML = BUILTIN_STICKERS.map(emoji =>
      '<button onclick="app.sendSticker(' + JSON.stringify(emoji).replace(/"/g, '&quot;') + ')" class="sticker-tile aspect-square flex items-center justify-center text-3xl bg-slate-50 dark:bg-slate-900 rounded-xl btn-press">' + emoji + '</button>'
    ).join('');
  },

  async loadProjectStickers() {
    const { data, error } = await supabaseClient
      .from('project_stickers')
      .select('*')
      .eq('project_id', this.currentProject.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    this.currentProject.stickers = data || [];
    this.renderYourStickers();
  },

  renderYourStickers() {
    const stickers = this.currentProject.stickers || [];
    const uploadTile = '<label class="sticker-tile flex flex-col items-center justify-center gap-1 bg-slate-50 dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl aspect-square cursor-pointer text-slate-400 dark:text-slate-500" onclick="document.getElementById(\'stickerUpload\').click()"><i class="fas fa-plus text-lg"></i></label>';

    const stickerTiles = stickers.map(s =>
      '<button onclick="app.sendSticker(null, ' + JSON.stringify(s.url).replace(/"/g, '&quot;') + ')" class="sticker-tile aspect-square bg-slate-50 dark:bg-slate-900 rounded-xl overflow-hidden btn-press"><img src="' + s.url + '" class="w-full h-full object-contain" alt=""></button>'
    ).join('');

    document.getElementById('stickerPanelYoursGrid').innerHTML = uploadTile + stickerTiles;
  },

  async handleStickerUpload(input) {
    const file = input.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      this.showToast('Stickers must be under 2MB', 'error');
      input.value = '';
      return;
    }

    this.showLoading(true);

    const fileExt = file.name.split('.').pop();
    const fileName = Date.now() + '_' + Math.random().toString(36).substring(7) + '.' + fileExt;
    const filePath = this.currentProject.id + '/' + fileName;

    const { error: uploadError } = await supabaseClient.storage
      .from('project-stickers')
      .upload(filePath, file);

    if (uploadError) {
      this.showToast('Sticker upload failed', 'error');
      this.showLoading(false);
      input.value = '';
      return;
    }

    const { data: { publicUrl } } = supabaseClient.storage
      .from('project-stickers')
      .getPublicUrl(filePath);

    const { error } = await supabaseClient.from('project_stickers').insert({
      project_id: this.currentProject.id,
      uploaded_by: this.user.id,
      name: file.name,
      url: publicUrl,
      path: filePath
    });

    if (error) {
      this.showToast('Failed to save sticker', 'error');
    } else {
      await this.loadProjectStickers();
      this.showToast('Sticker added!', 'success');
    }

    input.value = '';
    this.showLoading(false);
  },

  // ===================== STATS (Pro) =====================
  showProjectStats() {
    const p = this.currentProject;
    const isPro = this.projectOwnerIsPro(p);

    if (!isPro) {
      this.promptUpgrade('Project Insights — completion rate, overdue tracking, and member activity — is a Pro feature. Upgrade for $5/month.');
      return;
    }

    const tasks = p.tasks || [];
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
    const overdue = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done');

    const memberStats = (p.members || []).map(m => {
      const memberTasks = tasks.filter(t => t.assignee === m.user_id);
      const memberDone = memberTasks.filter(t => t.status === 'done').length;
      return { name: m.profiles?.name || 'Unknown', avatar: m.profiles?.avatar_url, total: memberTasks.length, done: memberDone };
    }).sort((a, b) => b.done - a.done);

    const memberHtml = memberStats.length ? memberStats.map(m => {
      const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
      const avatar = m.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(m.name) + '&background=random&size=24';
      return '<div class="flex items-center gap-3 mb-3"><img src="' + avatar + '" class="w-7 h-7 rounded-full object-cover flex-shrink-0" alt=""><div class="flex-1 min-w-0"><div class="flex items-center justify-between mb-1"><span class="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">' + this.escapeHtml((m.name || '?').split(' ')[0]) + '</span><span class="text-[10px] text-slate-400 dark:text-slate-500">' + m.done + '/' + m.total + ' done</span></div><div class="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden"><div class="h-full bg-primary-500 rounded-full" style="width:' + pct + '%"></div></div></div></div>';
    }).join('') : '<p class="text-xs text-slate-400 dark:text-slate-500">No members yet</p>';

    document.getElementById('statsContent').innerHTML =
      '<div class="grid grid-cols-2 gap-3 mb-6">' +
        '<div class="bg-slate-50 dark:bg-slate-900 rounded-xl p-4"><div class="text-2xl font-bold text-slate-800 dark:text-slate-100">' + completionRate + '%</div><div class="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">Completion rate</div></div>' +
        '<div class="bg-slate-50 dark:bg-slate-900 rounded-xl p-4"><div class="text-2xl font-bold ' + (overdue.length > 0 ? 'text-accent-500' : 'text-slate-800 dark:text-slate-100') + '">' + overdue.length + '</div><div class="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">Overdue tasks</div></div>' +
      '</div>' +
      '<h3 class="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Member activity</h3>' +
      memberHtml;

    this.openSheet('statsModal');
  },

  hideStats() {
    this.closeSheet('statsModal');
  },

  // ===================== CRUD =====================
  showNewProject() {
    this.openSheet('newProjectModal');
    document.getElementById('newProjName').value = '';
    document.getElementById('newProjSubject').value = '';
    document.getElementById('newProjDeadline').value = '';
  },

  hideNewProject() {
    this.closeSheet('newProjectModal');
  },

  async createProject() {
    const name = document.getElementById('newProjName').value.trim();
    const subject = document.getElementById('newProjSubject').value;
    const deadline = document.getElementById('newProjDeadline').value;

    if (!name) {
      this.showToast('Please enter a project name', 'error');
      return;
    }

    const limits = this.planLimits(!!this.userProfile?.is_pro);
    if (this.projects.length >= limits.projects) {
      this.hideNewProject();
      this.promptUpgrade('Free plan is limited to ' + limits.projects + ' projects. Upgrade to Pro for unlimited projects.');
      return;
    }

    this.showLoading(true);

    const { data: project, error } = await supabaseClient
      .from('projects')
      .insert({ name, subject: subject || null, deadline: deadline || null, created_by: this.user.id })
      .select()
      .single();

    if (error) {
      this.showToast('Failed to create project', 'error');
      console.error(error);
    } else {
      await supabaseClient.from('project_members').insert({ project_id: project.id, user_id: this.user.id, role: 'owner' });
      this.hideNewProject();
      this.showToast('Project created!', 'success');
      await this.loadProjects();
    }

    this.showLoading(false);
  },

  showNewTask() {
    if (!this.isProjectLeader(this.currentProject)) {
      this.showToast('Only the project leader can add tasks', 'error');
      return;
    }
    this.openSheet('newTaskModal');
    document.getElementById('newTaskTitle').value = '';
    document.getElementById('newTaskDesc').value = '';
    document.getElementById('newTaskAssignee').value = '';
    document.getElementById('newTaskPriority').value = 'medium';
    document.getElementById('newTaskDue').value = '';
  },

  hideNewTask() {
    this.closeSheet('newTaskModal');
  },

  async createTask() {
    const title = document.getElementById('newTaskTitle').value.trim();
    const description = document.getElementById('newTaskDesc').value.trim();
    const assignee = document.getElementById('newTaskAssignee').value || null;
    const priority = document.getElementById('newTaskPriority').value;
    const dueDate = document.getElementById('newTaskDue').value || null;

    if (!title) {
      this.showToast('Please enter a task title', 'error');
      return;
    }

    this.showLoading(true);

    const { data: task, error } = await supabaseClient
      .from('tasks')
      .insert({ project_id: this.currentProject.id, title, description: description || null, assignee, priority, due_date: dueDate, status: 'todo', created_by: this.user.id })
      .select()
      .single();

    if (error) {
      this.showToast('Failed to add task', 'error');
      console.error(error);
    } else {
      this.hideNewTask();
      this.showToast('Task added!', 'success');

      if (assignee && assignee !== this.user.id) {
        await supabaseClient.from('notifications').insert({
          user_id: assignee,
          type: 'task_assigned',
          title: 'New task assigned',
          message: 'You were assigned "' + title + '" in ' + this.currentProject.name,
          project_id: this.currentProject.id,
          task_id: task.id,
          read: false
        });
      }

      await this.loadProjects();
      this.currentProject = this.projects.find(p => p.id === this.currentProject.id);
      this.renderTasks();
    }

    this.showLoading(false);
  },

  // ===================== AI TASK BREAKDOWN (Pro) =====================
  showAiBreakdown() {
    if (!this.isProjectLeader(this.currentProject)) {
      this.showToast('Only the project leader can use AI Breakdown', 'error');
      return;
    }
    if (!this.projectOwnerIsPro(this.currentProject)) {
      this.hideAiBreakdown();
      this.promptUpgrade('AI Task Breakdown is a Pro feature. Upgrade for $5/month.');
      return;
    }
    this.resetAiBreakdown();
    this.openSheet('aiBreakdownModal');
  },

  hideAiBreakdown() {
    this.closeSheet('aiBreakdownModal');
  },

  resetAiBreakdown() {
    this.aiSuggestions = [];
    document.getElementById('aiBreakdownBrief').value = '';
    document.getElementById('aiBreakdownInputStep').classList.remove('hidden');
    document.getElementById('aiBreakdownResultsStep').classList.add('hidden');
  },

  async generateAiBreakdown() {
    const brief = document.getElementById('aiBreakdownBrief').value.trim();
    if (!brief) {
      this.showToast('Paste an assignment brief first', 'error');
      return;
    }

    const btn = document.getElementById('aiBreakdownGenerateBtn');
    const icon = document.getElementById('aiBreakdownBtnIcon');
    const text = document.getElementById('aiBreakdownBtnText');
    btn.disabled = true;
    btn.classList.add('opacity-50', 'pointer-events-none');
    icon.className = 'fas fa-spinner fa-spin';
    text.textContent = 'Generating...';

    const { data, error } = await supabaseClient.functions.invoke('ai-task-breakdown', {
      body: { project_id: this.currentProject.id, subject: this.currentProject.subject, brief }
    });

    btn.disabled = false;
    btn.classList.remove('opacity-50', 'pointer-events-none');
    icon.className = 'fas fa-wand-magic-sparkles';
    text.textContent = 'Generate Tasks';

    if (error || data?.error || !data?.tasks?.length) {
      this.showToast(data?.error || 'AI Breakdown failed, please try again', 'error');
      return;
    }

    this.aiSuggestions = data.tasks.map(t => ({ ...t, selected: true }));
    this.renderAiSuggestions();
    document.getElementById('aiBreakdownInputStep').classList.add('hidden');
    document.getElementById('aiBreakdownResultsStep').classList.remove('hidden');
  },

  renderAiSuggestions() {
    const priorityClass = { high: 'bg-accent-50 dark:bg-accent-500/10 text-accent-500', medium: 'bg-warning-50 dark:bg-warning-500/10 text-warning-500', low: 'bg-success-50 dark:bg-success-500/10 text-success-500' };

    document.getElementById('aiBreakdownList').innerHTML = this.aiSuggestions.map((t, i) => {
      return '<div class="flex items-start gap-3 bg-slate-50 dark:bg-slate-900 rounded-xl p-3">' +
        '<input type="checkbox" ' + (t.selected ? 'checked' : '') + ' onclick="app.toggleAiSuggestion(' + i + ')" class="mt-1 w-4 h-4 accent-primary-600 flex-shrink-0">' +
        '<div class="flex-1 min-w-0">' +
        '<input type="text" value="' + this.escapeHtml(t.title) + '" oninput="app.updateAiSuggestionTitle(' + i + ', this.value)" class="w-full bg-transparent text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none">' +
        '<p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">' + this.escapeHtml(t.description) + '</p>' +
        '</div>' +
        '<span class="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ' + (priorityClass[t.priority] || priorityClass.medium) + '">' + t.priority + '</span>' +
        '</div>';
    }).join('');
  },

  toggleAiSuggestion(i) {
    this.aiSuggestions[i].selected = !this.aiSuggestions[i].selected;
  },

  updateAiSuggestionTitle(i, value) {
    this.aiSuggestions[i].title = value;
  },

  async addSelectedAiTasks() {
    const selected = this.aiSuggestions.filter(t => t.selected && t.title.trim());
    if (!selected.length) {
      this.showToast('Select at least one task', 'error');
      return;
    }

    this.showLoading(true);

    const { error } = await supabaseClient.from('tasks').insert(selected.map(t => ({
      project_id: this.currentProject.id,
      title: t.title.trim(),
      description: t.description || null,
      priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
      status: 'todo',
      created_by: this.user.id
    })));

    if (error) {
      this.showToast('Failed to add tasks', 'error');
      console.error(error);
    } else {
      this.hideAiBreakdown();
      this.showToast(selected.length + ' task' + (selected.length > 1 ? 's' : '') + ' added!', 'success');
      await this.loadProjects();
      this.currentProject = this.projects.find(p => p.id === this.currentProject.id);
      this.renderTasks();
    }

    this.showLoading(false);
  },

  async cycleTaskStatus(taskId) {
    const task = this.currentProject.tasks.find(t => t.id === taskId);
    if (!task) return;

    const statusFlow = { todo: 'in_progress', in_progress: 'done', done: 'todo' };
    const newStatus = statusFlow[task.status];

    const { error } = await supabaseClient
      .from('tasks')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', taskId);

    if (error) {
      this.showToast('Failed to update task', 'error');
    } else {
      if (newStatus === 'done') {
        const otherMembers = this.currentProject.members.filter(m => m.user_id !== this.user.id);
        for (const member of otherMembers) {
          await supabaseClient.from('notifications').insert({
            user_id: member.user_id,
            type: 'task_completed',
            title: 'Task completed',
            message: '"' + task.title + '" was marked as done in ' + this.currentProject.name,
            project_id: this.currentProject.id,
            task_id: taskId,
            read: false
          });
        }
      }

      await this.loadProjects();
      this.currentProject = this.projects.find(p => p.id === this.currentProject.id);
      this.renderTasks();
      this.renderDashboard();
      if (newStatus === 'done') this.showToast('Task completed!', 'success');
    }
  },

  async deleteTask(taskId) {
    if (!confirm('Delete this task?')) return;

    const { error } = await supabaseClient.from('tasks').delete().eq('id', taskId);

    if (error) {
      this.showToast('Failed to delete task', 'error');
    } else {
      await this.loadProjects();
      this.currentProject = this.projects.find(p => p.id === this.currentProject.id);
      this.renderTasks();
      this.renderDashboard();
      this.showToast('Task deleted', 'success');
    }
  },

  async handleFileUpload(input) {
    const file = input.files[0];
    if (!file) return;

    const isPro = this.projectOwnerIsPro(this.currentProject);
    const limits = this.planLimits(isPro);
    const used = this.projectStorageUsed(this.currentProject);
    if (used + file.size > limits.storageBytes) {
      input.value = '';
      this.promptUpgrade('This project has hit its ' + this.formatBytes(limits.storageBytes) + ' storage limit. Upgrade to Pro for ' + this.formatBytes(PLAN_LIMITS.pro.storageBytes) + ' per project.');
      return;
    }

    this.showLoading(true);

    const fileExt = file.name.split('.').pop();
    const fileName = Date.now() + '_' + Math.random().toString(36).substring(7) + '.' + fileExt;
    const filePath = this.currentProject.id + '/' + fileName;

    const { error: uploadError } = await supabaseClient.storage
      .from('project-files')
      .upload(filePath, file);

    if (uploadError) {
      this.showToast('Upload failed', 'error');
      this.showLoading(false);
      return;
    }

    const { data: { publicUrl } } = supabaseClient.storage
      .from('project-files')
      .getPublicUrl(filePath);

    const { error } = await supabaseClient.from('files').insert({
      project_id: this.currentProject.id,
      name: file.name,
      url: publicUrl,
      path: filePath,
      size: file.size,
      uploaded_by: this.user.id
    });

    if (error) {
      this.showToast('Failed to save file', 'error');
    } else {
      await this.loadProjects();
      this.currentProject = this.projects.find(p => p.id === this.currentProject.id);
      this.renderFiles();
      this.showToast('File uploaded!', 'success');
    }

    input.value = '';
    this.showLoading(false);
  },

  // ===================== INVITE =====================
  showInviteMember() {
    const p = this.currentProject;
    const link = window.location.origin + '/app?join=' + p.id;
    document.getElementById('inviteLink').value = link;

    const isPro = this.projectOwnerIsPro(p);
    const limits = this.planLimits(isPro);
    const memberCount = (p.members || []).length;
    const limitText = document.getElementById('memberLimitText');
    if (isPro) {
      limitText.textContent = memberCount + ' members · Pro plan (unlimited)';
    } else {
      limitText.textContent = memberCount + ' of ' + limits.members + ' members used (Free plan)';
      limitText.classList.toggle('text-accent-500', memberCount >= limits.members);
    }

    this.openSheet('inviteModal');
  },

  hideInvite() {
    this.closeSheet('inviteModal');
  },

  copyInviteLink() {
    const input = document.getElementById('inviteLink');
    input.select();
    navigator.clipboard.writeText(input.value);
    this.showToast('Link copied!', 'success');
  },

  shareViaWhatsApp() {
    const link = document.getElementById('inviteLink').value;
    const text = encodeURIComponent('Join my project on ProjectSync: ' + link);
    window.open('https://wa.me/?text=' + text, '_blank');
  },

  // ===================== TELEGRAM =====================
  showTelegramLink() {
    this.openSheet('telegramModal');
    document.getElementById('telegramChatId').value = this.userProfile?.telegram_chat_id || '';
  },

  hideTelegram() {
    this.closeSheet('telegramModal');
  },

  async linkTelegram() {
    const chatId = document.getElementById('telegramChatId').value.trim();
    const startHour = document.getElementById('reminderStart').value;
    const endHour = document.getElementById('reminderEnd').value;

    if (!chatId) {
      this.showToast('Please enter your Telegram Chat ID', 'error');
      return;
    }

    this.showLoading(true);

    const { error } = await supabaseClient
      .from('profiles')
      .update({
        telegram_chat_id: chatId,
        reminder_start_hour: parseInt(startHour),
        reminder_end_hour: parseInt(endHour),
        telegram_linked: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', this.user.id);

    if (error) {
      this.showToast('Failed to link Telegram', 'error');
      console.error(error);
    } else {
      this.userProfile.telegram_chat_id = chatId;
      this.userProfile.telegram_linked = true;
      this.hideTelegram();
      this.showToast('Telegram linked! You will now receive reminders.', 'success');
      this.renderDashboard();
      this.checkTelegramStatus();
    }

    this.showLoading(false);
  },

  checkTelegramStatus() {
    const statusText = document.getElementById('telegramStatusText');
    const linkBtn = document.getElementById('telegramLinkBtn');

    if (this.userProfile?.telegram_linked) {
      statusText.textContent = 'Linked ✓';
      statusText.classList.add('text-success-500');
      linkBtn.textContent = 'Manage';
    } else {
      statusText.textContent = 'Not linked';
      linkBtn.textContent = 'Link';
    }
  },

  // ===================== NOTIFICATIONS =====================
  async showNotifications() {
    this.openSheet('notificationsModal');

    const { data: notifications } = await supabaseClient
      .from('notifications')
      .select('*')
      .eq('user_id', this.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const list = document.getElementById('notificationsList');

    if (!notifications?.length) {
      list.innerHTML = '<div class="text-center py-8"><div class="w-12 h-12 bg-slate-50 dark:bg-slate-900 rounded-full flex items-center justify-center mx-auto mb-2"><i class="fas fa-bell-slash text-slate-300 dark:text-slate-600"></i></div><p class="text-sm text-slate-400 dark:text-slate-500">No notifications yet</p></div>';
    } else {
      list.innerHTML = notifications.map(n => {
        const icons = {
          task_assigned: 'fa-tasks text-primary-500',
          task_completed: 'fa-check-circle text-success-500',
          deadline_warning: 'fa-exclamation-circle text-accent-500',
          hourly_reminder: 'fa-clock text-warning-500'
        };
        const iconClass = icons[n.type] || 'fa-bell text-slate-400';
        const bgClass = n.read ? 'bg-white dark:bg-slate-800' : 'bg-primary-50 dark:bg-primary-900/20';
        const iconBg = n.read ? 'bg-slate-50 dark:bg-slate-900' : 'bg-white dark:bg-slate-800';
        const unreadDot = !n.read ? '<div class="w-2 h-2 bg-primary-500 rounded-full flex-shrink-0 mt-1.5"></div>' : '';

        return '<div class="flex items-start gap-3 p-3 rounded-xl ' + bgClass + ' card-shadow"><div class="w-9 h-9 rounded-lg ' + iconBg + ' flex items-center justify-center flex-shrink-0"><i class="fas ' + iconClass + '"></i></div><div class="flex-1 min-w-0"><p class="text-sm font-medium text-slate-800 dark:text-slate-100">' + this.escapeHtml(n.title) + '</p><p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">' + this.escapeHtml(n.message) + '</p><p class="text-[10px] text-slate-300 dark:text-slate-600 mt-1">' + this.timeAgo(n.created_at) + '</p></div>' + unreadDot + '</div>';
      }).join('');

      await supabaseClient.from('notifications')
        .update({ read: true })
        .eq('user_id', this.user.id)
        .eq('read', false);

      document.getElementById('notifBadge').classList.add('hidden');
    }
  },

  hideNotifications() {
    this.closeSheet('notificationsModal');
  },

  // ===================== PROFILE =====================
  showProfile() {
    this.openSheet('profileModal');
    this.checkTelegramStatus();
    this.updateProStatus();
    this.renderEduLevelBadge();
  },

  updateProStatus() {
    const isPro = !!this.userProfile?.is_pro;
    const text = document.getElementById('proStatusText');
    const btn = document.getElementById('proUpgradeBtn');
    if (!text || !btn) return;

    if (isPro) {
      text.textContent = 'Active — thanks for supporting ProjectSync!';
      btn.textContent = 'Active';
      btn.disabled = true;
      btn.classList.add('opacity-50', 'pointer-events-none');
    } else {
      text.textContent = '$5/month, cancel anytime';
      btn.textContent = 'Upgrade';
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'pointer-events-none');
    }
  },

  hideProfile() {
    this.closeSheet('profileModal');
  },

  showSettings() {
    this.showProfile();
  },

  showDashboard() {
    this.unsubscribeChat();

    document.getElementById('projectDetailView').classList.add('hidden');
    document.getElementById('dashboardView').classList.remove('hidden');

    document.getElementById('navHomeIcon').classList.remove('text-slate-400', 'dark:text-slate-500');
    document.getElementById('navHomeIcon').classList.add('text-primary-600');
    document.getElementById('navHomeText').classList.remove('text-slate-400', 'dark:text-slate-500');
    document.getElementById('navHomeText').classList.add('text-primary-600');

    this.renderDashboard();
  },

  showAllDeadlines() {
    this.showToast('Full deadline calendar coming soon!', 'success');
  },

  // ===================== UTILITIES =====================
  showToast(message, type) {
    const toast = document.getElementById('toast');
    const panel = toast.querySelector('.toast-panel');
    const icon = document.getElementById('toastIcon');
    const msg = document.getElementById('toastMessage');

    msg.textContent = message;
    icon.className = type === 'error' ? 'fas fa-exclamation-circle text-accent-500' : 'fas fa-check-circle text-success-400';

    clearTimeout(this._toastHideTimer);
    clearTimeout(this._toastCloseTimer);

    toast.classList.remove('hidden');
    requestAnimationFrame(() => panel.classList.remove('toast-hidden'));

    this._toastHideTimer = setTimeout(() => {
      panel.classList.add('toast-hidden');
      this._toastCloseTimer = setTimeout(() => toast.classList.add('hidden'), 200);
    }, 3000);
  },

  showLoading(show) {
    document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
  },

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  timeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    return days + 'd ago';
  }
};

// ===================== HANDLE INVITE LINKS =====================
async function handleInviteLink() {
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('join');

  if (projectId) {
    const checkAuth = setInterval(async () => {
      if (app.user) {
        clearInterval(checkAuth);

        const { data: result, error } = await supabaseClient.rpc('join_project_with_limit', { p_project_id: projectId });

        if (error) {
          app.showToast('Failed to join project', 'error');
        } else if (result === 'limit_reached') {
          app.promptUpgrade("This project hit the Free plan's 5-member limit. Ask the owner to upgrade to Pro.");
        } else if (result === 'joined') {
          app.showToast('You joined the project!', 'success');
        }

        await app.loadProjects();
        if (app.projects.some(p => p.id === projectId)) {
          app.openProject(projectId);
        } else {
          app.showDashboard();
        }

        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }, 500);

    setTimeout(() => clearInterval(checkAuth), 10000);
  }
}

// ===================== INIT APP =====================
document.addEventListener('DOMContentLoaded', () => {
  app.init();
  handleInviteLink();
});
