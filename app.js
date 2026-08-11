// ============================================================
// ProjectSync — Complete App with Supabase Backend
// Replace the placeholders below with your actual Supabase credentials
// ============================================================

const SUPABASE_URL = 'https://lanvvptfxnfjfupwpnuj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhbnZ2cHRmeG5mamZ1cHdwbnVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxOTM5ODAsImV4cCI6MjA5OTc2OTk4MH0.H_jc0WBma0gIO0c6sjcr57bbZcnk-dtZZImUybpT-Z8';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = {
  user: null,
  userProfile: null,
  projects: [],
  currentProject: null,
  taskFilter: 'all',
  emailAuthMode: 'signin',

  // ===================== INIT =====================
  async init() {
    this.showLoading(true);

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
        this.showAuthScreen();
      }
    });
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
    document.getElementById('emailAuthModal').classList.remove('hidden');
    this.emailAuthMode = 'signin';
    this.updateEmailAuthUI();
  },

  hideEmailAuth() {
    document.getElementById('emailAuthModal').classList.add('hidden');
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

    const { data, error } = await supabaseClient
      .from('profiles')
      .upsert({
        id: this.user.id,
        email: this.user.email,
        name: this.user.user_metadata?.full_name || this.user.email.split('@')[0],
        avatar_url: this.user.user_metadata?.avatar_url || '',
        school: 'SMK Bukit Mertajam',
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' })
      .select()
      .single();

    if (data) {
      this.userProfile = data;
      this.updateHeader();
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
        members:project_members(user_id, role, profiles(id, name, avatar_url))
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
      deadlinesHtml = '<div class="bg-white rounded-2xl p-6 text-center card-shadow"><div class="w-12 h-12 bg-success-50 rounded-full flex items-center justify-center mx-auto mb-2"><i class="fas fa-check text-success-500"></i></div><p class="text-sm text-slate-400">No upcoming deadlines!</p></div>';
    } else {
      deadlinesHtml = upcoming.map(t => {
        const daysLeft = Math.ceil((new Date(t.due_date) - new Date()) / (1000 * 60 * 60 * 24));
        const isUrgent = daysLeft <= 1;
        const isSoon = daysLeft <= 3;
        const colorClass = isUrgent ? 'bg-accent-50 border-accent-200' : isSoon ? 'bg-warning-50 border-warning-200' : 'bg-white border-slate-100';
        const iconColor = isUrgent ? 'text-accent-500' : isSoon ? 'text-warning-500' : 'text-slate-400';
        const dueText = daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Due today' : daysLeft === 1 ? 'Due tomorrow' : daysLeft + ' days left';

        return '<div class="' + colorClass + ' border rounded-2xl p-4 card-shadow flex items-center gap-3 cursor-pointer btn-press" onclick="app.openProject(\'' + t.project_id + '\')"><div class="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0"><i class="fas fa-clock ' + iconColor + ' text-sm"></i></div><div class="flex-1 min-w-0"><p class="font-medium text-sm text-slate-800 truncate">' + this.escapeHtml(t.title) + '</p><p class="text-xs text-slate-400">' + this.escapeHtml(t.projectName) + ' &bull; ' + dueText + '</p></div><span class="text-xs font-medium ' + (isUrgent ? 'text-accent-500' : isSoon ? 'text-warning-500' : 'text-slate-400') + '">' + dueText + '</span></div>';
      }).join('');
    }

    document.getElementById('deadlinesList').innerHTML = deadlinesHtml;

    let projectsHtml = '';
    if (this.projects.length === 0) {
      projectsHtml = '<div class="bg-white rounded-2xl p-8 text-center card-shadow"><div class="w-16 h-16 bg-primary-50 rounded-full flex items-center justify-center mx-auto mb-3"><i class="fas fa-folder-open text-primary-400 text-xl"></i></div><p class="text-slate-400 text-sm mb-1">No projects yet</p><p class="text-slate-300 text-xs">Tap + to create your first project</p></div>';
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
          memberAvatars += '<img src="' + avatar + '" class="w-7 h-7 rounded-full border-2 border-white object-cover" alt="">';
        });
        const extraMembers = (p.members || []).length > 3 ? '<div class="w-7 h-7 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[9px] font-bold text-slate-500">+' + ((p.members || []).length - 3) + '</div>' : '';

        return '<div class="bg-white rounded-2xl p-5 card-shadow cursor-pointer btn-press" onclick="app.openProject(\'' + p.id + '\')"><div class="flex items-start justify-between mb-3"><div><div class="flex items-center gap-2 mb-1"><span class="text-xs font-medium px-2 py-0.5 bg-primary-50 text-primary-600 rounded-md">' + this.escapeHtml(p.subject || 'General') + '</span>' + (daysLeft !== null ? '<span class="text-xs ' + (daysLeft <= 1 ? 'text-accent-500' : daysLeft <= 3 ? 'text-warning-500' : 'text-slate-400') + '">' + (daysLeft <= 0 ? 'Overdue' : daysLeft + ' days left') + '</span>' : '') + '</div><h3 class="font-bold text-slate-800 text-sm">' + this.escapeHtml(p.name) + '</h3></div><div class="w-10 h-10 relative flex-shrink-0"><svg class="w-10 h-10 progress-ring" viewBox="0 0 36 36"><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e2e8f0" stroke-width="3"/><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="' + (progress === 100 ? '#22c55e' : progress > 50 ? '#3b82f6' : '#f59e0b') + '" stroke-width="3" stroke-dasharray="' + progress + ', 100" stroke-linecap="round"/></svg><span class="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-600">' + progress + '%</span></div></div><div class="flex items-center justify-between"><div class="flex -space-x-2">' + memberAvatars + extraMembers + '</div><p class="text-xs text-slate-400">' + done + '/' + total + ' tasks done</p></div></div>';
      }).join('');
    }

    document.getElementById('projectsList').innerHTML = projectsHtml;
  },

  // ===================== PROJECT DETAIL =====================
  async openProject(projectId) {
    this.currentProject = this.projects.find(p => p.id === projectId);
    if (!this.currentProject) return;

    document.getElementById('dashboardView').classList.add('hidden');
    document.getElementById('projectDetailView').classList.remove('hidden');

    document.getElementById('navHomeIcon').classList.remove('text-primary-600');
    document.getElementById('navHomeIcon').classList.add('text-slate-400');
    document.getElementById('navHomeText').classList.remove('text-primary-600');
    document.getElementById('navHomeText').classList.add('text-slate-400');

    this.renderProjectDetail();
    this.setTaskFilter('all');
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
      deadlineText = '<p class="text-xs text-slate-400 mt-1"><i class="far fa-calendar mr-1"></i> Due ' + dateStr + daysText + '</p>';
    }

    document.getElementById('projectHeader').innerHTML = '<div class="flex items-start justify-between mb-3"><div><span class="text-xs font-medium px-2 py-0.5 bg-primary-50 text-primary-600 rounded-md">' + this.escapeHtml(p.subject || 'General') + '</span><h2 class="font-bold text-slate-800 text-lg mt-2">' + this.escapeHtml(p.name) + '</h2>' + deadlineText + '</div></div><div class="flex items-center gap-3"><div class="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden"><div class="h-full rounded-full transition-all duration-500 ' + (progress === 100 ? 'bg-success-500' : progress > 50 ? 'bg-primary-500' : 'bg-warning-500') + '" style="width: ' + progress + '%"></div></div><span class="text-xs font-bold text-slate-600">' + progress + '%</span></div>';
  },

  setTaskFilter(filter) {
    this.taskFilter = filter;

    ['all', 'todo', 'in_progress', 'done'].forEach(f => {
      const btnId = 'filter' + f.charAt(0).toUpperCase() + f.slice(1).replace('_', '');
      const btn = document.getElementById(btnId);
      if (f === filter) {
        btn.classList.add('bg-white', 'text-slate-800', 'card-shadow');
        btn.classList.remove('text-slate-400');
      } else {
        btn.classList.remove('bg-white', 'text-slate-800', 'card-shadow');
        btn.classList.add('text-slate-400');
      }
    });

    this.renderTasks();
  },

  renderTasks() {
    const p = this.currentProject;
    let tasks = p.tasks || [];

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
      html = '<div class="text-center py-8"><div class="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-2"><i class="fas fa-clipboard-check text-slate-300 text-lg"></i></div><p class="text-xs text-slate-400">No tasks here</p></div>';
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
          statusBtn = '<button onclick="app.cycleTaskStatus(\'' + t.id + '\')" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 btn-press border-primary-500 bg-primary-50"><div class="w-2 h-2 bg-primary-500 rounded-full"></div></button>';
        } else {
          statusBtn = '<button onclick="app.cycleTaskStatus(\'' + t.id + '\')" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 btn-press border-slate-300"></button>';
        }

        const titleClass = t.status === 'done' ? 'line-through text-slate-400' : 'text-slate-800';
        const descHtml = t.description ? '<p class="text-xs text-slate-400 mt-0.5 line-clamp-2">' + this.escapeHtml(t.description) + '</p>' : '';

        const assigneeHtml = assignee ? '<div class="flex items-center gap-1"><img src="' + assigneeAvatar + '" class="w-4 h-4 rounded-full object-cover"><span class="text-[10px] text-slate-400">' + this.escapeHtml(assigneeName) + '</span></div>' : '';

        const dueHtml = t.due_date ? '<span class="text-[10px] ' + (isOverdue ? 'text-accent-500 font-medium' : 'text-slate-400') + '"><i class="far fa-clock mr-0.5"></i>' + new Date(t.due_date).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) + '</span>' : '';

        const priorityClass = t.priority === 'high' ? 'bg-accent-50 text-accent-500' : t.priority === 'medium' ? 'bg-warning-50 text-warning-500' : 'bg-success-50 text-success-500';

        return '<div class="bg-white rounded-2xl p-4 card-shadow task-card priority-' + (t.priority || 'medium') + ' ' + (isOverdue ? 'bg-accent-50' : '') + '"><div class="flex items-start gap-3">' + statusBtn + '<div class="flex-1 min-w-0"><p class="font-medium text-sm ' + titleClass + '">' + this.escapeHtml(t.title) + '</p>' + descHtml + '<div class="flex items-center gap-2 mt-2">' + assigneeHtml + dueHtml + '<span class="text-[10px] px-1.5 py-0.5 rounded ' + priorityClass + '">' + t.priority + '</span></div></div><button onclick="app.deleteTask(\'' + t.id + '\')" class="text-slate-300 hover:text-accent-400 btn-press p-1"><i class="fas fa-trash-alt text-xs"></i></button></div></div>';
      }).join('');
    }

    document.getElementById('tasksList').innerHTML = html;

    const assigneeSelect = document.getElementById('newTaskAssignee');
    let options = '<option value="">Select member...</option>';
    (p.members || []).forEach(m => {
      options += '<option value="' + m.user_id + '">' + this.escapeHtml(m.profiles?.name || 'Unknown') + '</option>';
    });
    assigneeSelect.innerHTML = options;

    this.renderFiles();
    this.renderMembers();
  },

  renderFiles() {
    const files = this.currentProject.files || [];
    let html = '';
    if (files.length === 0) {
      html = '<div class="text-center py-4"><p class="text-xs text-slate-400">No files uploaded yet</p></div>';
    } else {
      html = files.map(f => {
        let icon = 'fa-file text-slate-400';
        if (f.name?.endsWith('.pdf')) icon = 'fa-file-pdf text-accent-500';
        else if (f.name?.match(/\.(jpg|jpeg|png|gif)$/i)) icon = 'fa-file-image text-primary-500';
        else if (f.name?.match(/\.(doc|docx)$/i)) icon = 'fa-file-word text-blue-500';

        return '<a href="' + f.url + '" target="_blank" class="flex items-center gap-3 bg-white rounded-xl p-3 card-shadow btn-press"><div class="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fas ' + icon + ' text-lg"></i></div><div class="flex-1 min-w-0"><p class="text-sm font-medium text-slate-800 truncate">' + this.escapeHtml(f.name) + '</p><p class="text-[10px] text-slate-400">' + new Date(f.created_at).toLocaleDateString('en-MY') + '</p></div><i class="fas fa-external-link-alt text-slate-300 text-xs"></i></a>';
      }).join('');
    }
    document.getElementById('filesList').innerHTML = html;
  },

  renderMembers() {
    const members = this.currentProject.members || [];
    const html = members.map(m => {
      const avatar = m.profiles?.avatar_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(m.profiles?.name || '?') + '&background=random&size=24';
      const roleBadge = m.role === 'owner' ? '<span class="text-[9px] bg-primary-100 text-primary-600 px-1.5 py-0.5 rounded font-medium">Owner</span>' : '';
      return '<div class="flex items-center gap-2 bg-white rounded-xl px-3 py-2 card-shadow"><img src="' + avatar + '" class="w-6 h-6 rounded-full object-cover" alt=""><span class="text-xs font-medium text-slate-700">' + this.escapeHtml(m.profiles?.name?.split(' ')[0] || '?') + '</span>' + roleBadge + '</div>';
    }).join('');
    document.getElementById('membersList').innerHTML = html;
  },

  // ===================== CRUD =====================
  showNewProject() {
    document.getElementById('newProjectModal').classList.remove('hidden');
    document.getElementById('newProjName').value = '';
    document.getElementById('newProjSubject').value = '';
    document.getElementById('newProjDeadline').value = '';
  },

  hideNewProject() {
    document.getElementById('newProjectModal').classList.add('hidden');
  },

  async createProject() {
    const name = document.getElementById('newProjName').value.trim();
    const subject = document.getElementById('newProjSubject').value;
    const deadline = document.getElementById('newProjDeadline').value;

    if (!name) {
      this.showToast('Please enter a project name', 'error');
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
    document.getElementById('newTaskModal').classList.remove('hidden');
    document.getElementById('newTaskTitle').value = '';
    document.getElementById('newTaskDesc').value = '';
    document.getElementById('newTaskAssignee').value = '';
    document.getElementById('newTaskPriority').value = 'medium';
    document.getElementById('newTaskDue').value = '';
  },

  hideNewTask() {
    document.getElementById('newTaskModal').classList.add('hidden');
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
    const link = window.location.origin + '/app?join=' + this.currentProject.id;
    document.getElementById('inviteLink').value = link;
    document.getElementById('inviteModal').classList.remove('hidden');
  },

  hideInvite() {
    document.getElementById('inviteModal').classList.add('hidden');
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
    document.getElementById('telegramModal').classList.remove('hidden');
    document.getElementById('telegramChatId').value = this.userProfile?.telegram_chat_id || '';
  },

  hideTelegram() {
    document.getElementById('telegramModal').classList.add('hidden');
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
    document.getElementById('notificationsModal').classList.remove('hidden');

    const { data: notifications } = await supabaseClient
      .from('notifications')
      .select('*')
      .eq('user_id', this.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const list = document.getElementById('notificationsList');

    if (!notifications?.length) {
      list.innerHTML = '<div class="text-center py-8"><div class="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-2"><i class="fas fa-bell-slash text-slate-300"></i></div><p class="text-sm text-slate-400">No notifications yet</p></div>';
    } else {
      list.innerHTML = notifications.map(n => {
        const icons = {
          task_assigned: 'fa-tasks text-primary-500',
          task_completed: 'fa-check-circle text-success-500',
          deadline_warning: 'fa-exclamation-circle text-accent-500',
          hourly_reminder: 'fa-clock text-warning-500'
        };
        const iconClass = icons[n.type] || 'fa-bell text-slate-400';
        const bgClass = n.read ? 'bg-white' : 'bg-primary-50';
        const iconBg = n.read ? 'bg-slate-50' : 'bg-white';
        const unreadDot = !n.read ? '<div class="w-2 h-2 bg-primary-500 rounded-full flex-shrink-0 mt-1.5"></div>' : '';

        return '<div class="flex items-start gap-3 p-3 rounded-xl ' + bgClass + ' card-shadow"><div class="w-9 h-9 rounded-lg ' + iconBg + ' flex items-center justify-center flex-shrink-0"><i class="fas ' + iconClass + '"></i></div><div class="flex-1 min-w-0"><p class="text-sm font-medium text-slate-800">' + this.escapeHtml(n.title) + '</p><p class="text-xs text-slate-400 mt-0.5">' + this.escapeHtml(n.message) + '</p><p class="text-[10px] text-slate-300 mt-1">' + this.timeAgo(n.created_at) + '</p></div>' + unreadDot + '</div>';
      }).join('');

      await supabaseClient.from('notifications')
        .update({ read: true })
        .eq('user_id', this.user.id)
        .eq('read', false);

      document.getElementById('notifBadge').classList.add('hidden');
    }
  },

  hideNotifications() {
    document.getElementById('notificationsModal').classList.add('hidden');
  },

  // ===================== PROFILE =====================
  showProfile() {
    document.getElementById('profileModal').classList.remove('hidden');
    this.checkTelegramStatus();
    this.updateProStatus();
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
      text.textContent = '$3/month, cancel anytime';
      btn.textContent = 'Upgrade';
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'pointer-events-none');
    }
  },

  hideProfile() {
    document.getElementById('profileModal').classList.add('hidden');
  },

  showSettings() {
    this.showProfile();
  },

  showDashboard() {
    document.getElementById('projectDetailView').classList.add('hidden');
    document.getElementById('dashboardView').classList.remove('hidden');

    document.getElementById('navHomeIcon').classList.remove('text-slate-400');
    document.getElementById('navHomeIcon').classList.add('text-primary-600');
    document.getElementById('navHomeText').classList.remove('text-slate-400');
    document.getElementById('navHomeText').classList.add('text-primary-600');

    this.renderDashboard();
  },

  showAllDeadlines() {
    this.showToast('Full deadline calendar coming soon!', 'success');
  },

  // ===================== UTILITIES =====================
  showToast(message, type) {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const msg = document.getElementById('toastMessage');

    msg.textContent = message;
    icon.className = type === 'error' ? 'fas fa-exclamation-circle text-accent-500' : 'fas fa-check-circle text-success-400';

    toast.classList.remove('hidden');
    toast.classList.add('fade-in');

    setTimeout(() => {
      toast.classList.add('hidden');
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

        const { data: existing } = await supabaseClient
          .from('project_members')
          .select('*')
          .eq('project_id', projectId)
          .eq('user_id', app.user.id)
          .single();

        if (!existing) {
          await supabaseClient.from('project_members').insert({
            project_id: projectId,
            user_id: app.user.id,
            role: 'member'
          });
          app.showToast('You joined the project!', 'success');
        }

        await app.loadProjects();
        app.openProject(projectId);

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
