// TaskFlow Client Application
let state = {
  token: localStorage.getItem('taskflow_token') || null,
  currentUser: JSON.parse(localStorage.getItem('taskflow_user') || 'null'),
  projects: [],
  activeProject: null,
  projectMembers: [],
  tasks: [],
  allUsers: [],
  notifications: [],
  filter: 'all',
  activeDetailTaskId: null
};

// Initialize Socket.io
const socket = io();

// DOM Elements
const authModal = document.getElementById('authModal');
const formLogin = document.getElementById('formLogin');
const formRegister = document.getElementById('formRegister');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const currentUserAvatar = document.getElementById('currentUserAvatar');
const currentUserName = document.getElementById('currentUserName');
const currentUserRole = document.getElementById('currentUserRole');
const btnLogout = document.getElementById('btnLogout');
const demoUserSwitcher = document.getElementById('demoUserSwitcher');

const projectsList = document.getElementById('projectsList');
const projectMembersList = document.getElementById('projectMembersList');
const activeProjectTitle = document.getElementById('activeProjectTitle');
const activeProjectDesc = document.getElementById('activeProjectDesc');
const btnNewProject = document.getElementById('btnNewProject');
const btnInviteMember = document.getElementById('btnInviteMember');

const btnOpenNewTaskModal = document.getElementById('btnOpenNewTaskModal');
const taskModal = document.getElementById('taskModal');
const formCreateTask = document.getElementById('formCreateTask');
const taskInputStatus = document.getElementById('taskInputStatus');
const taskInputAssignee = document.getElementById('taskInputAssignee');

const taskDetailModal = document.getElementById('taskDetailModal');
const formAddComment = document.getElementById('formAddComment');
const btnDeleteTask = document.getElementById('btnDeleteTask');
const detailStatusSelect = document.getElementById('detailStatusSelect');

const projectModal = document.getElementById('projectModal');
const formCreateProject = document.getElementById('formCreateProject');
const inviteModal = document.getElementById('inviteModal');
const formInviteMember = document.getElementById('formInviteMember');
const inviteUserSelect = document.getElementById('inviteUserSelect');

const btnNotifications = document.getElementById('btnNotifications');
const notificationsDropdown = document.getElementById('notificationsDropdown');
const notificationsList = document.getElementById('notificationsList');
const unreadCountBadge = document.getElementById('unreadCountBadge');
const btnMarkAllRead = document.getElementById('btnMarkAllRead');

const toastContainer = document.getElementById('toastContainer');

// ======================== INITIALIZATION ======================== //

async function init() {
  setupEventListeners();
  setupSocketListeners();

  if (state.token && state.currentUser) {
    try {
      const res = await api('/api/auth/me');
      state.currentUser = res.user;
      localStorage.setItem('taskflow_user', JSON.stringify(res.user));
      renderUserBox();
      authModal.classList.add('hidden');
      await loadInitialData();
    } catch (err) {
      console.warn('Session expired or invalid, please login.');
      logout();
    }
  } else {
    authModal.classList.remove('hidden');
  }
}

// ======================== API HELPER ======================== //

async function api(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const response = await fetch(url, { ...options, headers });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'API Request failed');
  }

  return data;
}

// ======================== AUTHENTICATION ======================== //

async function login(email, password) {
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    state.token = data.token;
    state.currentUser = data.user;
    localStorage.setItem('taskflow_token', data.token);
    localStorage.setItem('taskflow_user', JSON.stringify(data.user));

    authModal.classList.add('hidden');
    renderUserBox();
    showToast(`Welcome back, ${data.user.name}!`, 'success');
    await loadInitialData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.quickLogin = function(email) {
  login(email, 'password123');
};

function logout() {
  state.token = null;
  state.currentUser = null;
  state.projects = [];
  state.activeProject = null;
  state.tasks = [];
  localStorage.removeItem('taskflow_token');
  localStorage.removeItem('taskflow_user');
  authModal.classList.remove('hidden');
}

function renderUserBox() {
  if (!state.currentUser) return;
  currentUserAvatar.textContent = state.currentUser.name.charAt(0);
  currentUserAvatar.style.backgroundColor = state.currentUser.avatar_color || '#3b82f6';
  currentUserName.textContent = state.currentUser.name;
  currentUserRole.textContent = state.currentUser.role_title || 'Team Member';

  // Join user's individual socket room for personal notifications
  socket.emit('join:user', state.currentUser.id);
}

// ======================== DATA LOADING ======================== //

async function loadInitialData() {
  try {
    // Load all users (for assignment & invite dropdowns)
    const usersData = await api('/api/users');
    state.allUsers = usersData.users;
    populateUserDropdowns();

    // Load projects
    const projectsData = await api('/api/projects');
    state.projects = projectsData.projects;

    if (state.projects.length > 0) {
      await selectProject(state.projects[0].id);
    } else {
      activeProjectTitle.textContent = 'No Projects Found';
      activeProjectDesc.textContent = 'Create your first project from the sidebar to get started.';
      renderKanban();
    }

    renderProjectsList();
    await loadNotifications();
  } catch (err) {
    console.error('Failed to load initial data:', err);
    showToast('Failed to load project data', 'error');
  }
}

async function selectProject(projectId) {
  try {
    if (state.activeProject) {
      socket.emit('leave:project', state.activeProject.id);
    }

    const data = await api(`/api/projects/${projectId}`);
    state.activeProject = data.project;
    state.projectMembers = data.members;

    activeProjectTitle.textContent = state.activeProject.title;
    activeProjectDesc.textContent = state.activeProject.description || 'No description provided';

    socket.emit('join:project', projectId);

    renderProjectsList();
    renderProjectMembers();
    populateTaskAssigneeDropdown();

    // Fetch tasks for this project
    const tasksData = await api(`/api/projects/${projectId}/tasks`);
    state.tasks = tasksData.tasks;
    renderKanban();
  } catch (err) {
    console.error('Error selecting project:', err);
    showToast(err.message, 'error');
  }
}

function populateUserDropdowns() {
  // Demo Switcher
  demoUserSwitcher.innerHTML = '<option value="" disabled selected>👥 Switch Demo User</option>';
  state.allUsers.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.email;
    opt.textContent = `${u.name} (${u.role_title})`;
    demoUserSwitcher.appendChild(opt);
  });

  // Invite user select
  inviteUserSelect.innerHTML = '<option value="" disabled selected>Choose colleague...</option>';
  state.allUsers.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `${u.name} (${u.email})`;
    inviteUserSelect.appendChild(opt);
  });
}

function populateTaskAssigneeDropdown() {
  taskInputAssignee.innerHTML = '<option value="">Unassigned</option>';
  state.projectMembers.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name} (${m.role_title || m.role})`;
    taskInputAssignee.appendChild(opt);
  });
}

// ======================== SIDEBAR RENDERING ======================== //

function renderProjectsList() {
  projectsList.innerHTML = '';
  state.projects.forEach(p => {
    const li = document.createElement('li');
    li.className = `project-item ${state.activeProject && state.activeProject.id === p.id ? 'active' : ''}`;
    li.innerHTML = `
      <span>📌 ${escapeHtml(p.title)}</span>
      <span class="column-count">${p.task_count || 0}</span>
    `;
    li.addEventListener('click', () => selectProject(p.id));
    projectsList.appendChild(li);
  });
}

function renderProjectMembers() {
  projectMembersList.innerHTML = '';
  state.projectMembers.forEach(m => {
    const li = document.createElement('li');
    li.className = 'member-item';
    li.innerHTML = `
      <div class="avatar avatar-sm" style="background-color: ${m.avatar_color || '#3b82f6'}">${m.name.charAt(0)}</div>
      <div class="member-meta">
        <span class="name">${escapeHtml(m.name)}</span>
        <span class="role-text">${escapeHtml(m.role_title || m.role)}</span>
      </div>
    `;
    projectMembersList.appendChild(li);
  });
}

// ======================== KANBAN RENDERING & DND ======================== //

function renderKanban() {
  const columns = {
    todo: document.getElementById('col-todo'),
    in_progress: document.getElementById('col-in_progress'),
    review: document.getElementById('col-review'),
    done: document.getElementById('col-done')
  };

  const counts = {
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0
  };

  // Clear lists
  Object.values(columns).forEach(col => col.innerHTML = '');

  // Filter tasks
  const filtered = state.tasks.filter(task => {
    if (state.filter === 'mine') {
      return task.assigned_to === state.currentUser?.id;
    }
    if (state.filter === 'urgent') {
      return task.priority === 'urgent' || task.priority === 'high';
    }
    return true;
  });

  filtered.forEach(task => {
    const colKey = task.status || 'todo';
    if (columns[colKey]) {
      counts[colKey]++;
      const card = createTaskCardElement(task);
      columns[colKey].appendChild(card);
    }
  });

  // Update counts
  document.getElementById('count-todo').textContent = counts.todo;
  document.getElementById('count-in_progress').textContent = counts.in_progress;
  document.getElementById('count-review').textContent = counts.review;
  document.getElementById('count-done').textContent = counts.done;
}

function createTaskCardElement(task) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.draggable = true;
  card.dataset.id = task.id;

  const priorityIcons = {
    urgent: '🔴 Urgent',
    high: '🟠 High',
    medium: '🟡 Medium',
    low: '🟢 Low'
  };

  const assigneeInitial = task.assignee_name ? task.assignee_name.charAt(0) : '?';
  const assigneeBg = task.assignee_color || '#6b7280';
  const dueDateStr = task.due_date ? `📅 ${task.due_date}` : '';

  card.innerHTML = `
    <div class="card-top">
      <span class="tag-badge">${escapeHtml(task.tag || 'Task')}</span>
      <span class="priority-pill ${task.priority}">${priorityIcons[task.priority] || task.priority}</span>
    </div>
    <h4 class="card-title">${escapeHtml(task.title)}</h4>
    ${task.description ? `<p class="card-desc">${escapeHtml(task.description)}</p>` : ''}
    <div class="card-footer">
      <div class="card-meta">
        ${dueDateStr ? `<span class="due-date-chip">${dueDateStr}</span>` : ''}
        <span class="comment-badge">💬 ${task.comment_count || 0}</span>
      </div>
      <div class="avatar avatar-sm" style="background-color: ${assigneeBg}" title="${task.assignee_name ? `Assigned to: ${task.assignee_name}` : 'Unassigned'}">
        ${assigneeInitial}
      </div>
    </div>
  `;

  // Drag and Drop Events
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.id);
    card.classList.add('dragging');
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });

  // Click to open detail modal
  card.addEventListener('click', () => {
    openTaskDetail(task.id);
  });

  return card;
}

// Setup Column Drag Over / Drop Handlers
function setupDragAndDrop() {
  const columns = document.querySelectorAll('.task-list');

  columns.forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.parentElement.classList.add('drag-over');
    });

    col.addEventListener('dragleave', () => {
      col.parentElement.classList.remove('drag-over');
    });

    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.parentElement.classList.remove('drag-over');
      const taskId = Number(e.dataTransfer.getData('text/plain'));
      const targetStatus = col.dataset.status;

      const task = state.tasks.find(t => t.id === taskId);
      if (task && task.status !== targetStatus) {
        // Optimistic UI update
        task.status = targetStatus;
        renderKanban();

        try {
          await api(`/api/tasks/${taskId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: targetStatus })
          });
        } catch (err) {
          showToast('Failed to update task status', 'error');
          // Revert if error
          await selectProject(state.activeProject.id);
        }
      }
    });
  });
}

// ======================== TASK DETAILS & COMMENTS ======================== //

async function openTaskDetail(taskId) {
  try {
    state.activeDetailTaskId = taskId;
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById('detailTaskTitle').textContent = task.title;
    document.getElementById('detailTaskDesc').textContent = task.description || 'No description provided.';
    document.getElementById('detailTaskTag').textContent = task.tag || 'Task';
    document.getElementById('detailTaskPriority').textContent = task.priority.toUpperCase();
    document.getElementById('detailTaskPriority').className = `priority-pill ${task.priority}`;
    document.getElementById('detailTaskStatus').textContent = task.status.replace('_', ' ').toUpperCase();

    // Assignee
    const avatar = document.getElementById('detailAssigneeAvatar');
    const nameEl = document.getElementById('detailAssigneeName');
    if (task.assignee_name) {
      avatar.textContent = task.assignee_name.charAt(0);
      avatar.style.backgroundColor = task.assignee_color || '#3b82f6';
      nameEl.textContent = task.assignee_name;
    } else {
      avatar.textContent = '?';
      avatar.style.backgroundColor = '#6b7280';
      nameEl.textContent = 'Unassigned';
    }

    document.getElementById('detailDueDate').textContent = task.due_date || 'No deadline';
    document.getElementById('detailCreatedBy').textContent = task.creator_name || 'System';
    detailStatusSelect.value = task.status;

    // Load comments
    await loadComments(taskId);

    taskDetailModal.classList.remove('hidden');
  } catch (err) {
    showToast('Failed to load task details', 'error');
  }
}

async function loadComments(taskId) {
  try {
    const data = await api(`/api/tasks/${taskId}/comments`);
    const container = document.getElementById('commentsContainer');
    document.getElementById('commentCount').textContent = data.comments.length;

    if (data.comments.length === 0) {
      container.innerHTML = '<p class="empty-state">No comments yet. Start the conversation!</p>';
      return;
    }

    container.innerHTML = '';
    data.comments.forEach(c => {
      const card = createCommentCard(c);
      container.appendChild(card);
    });

    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error('Failed to load comments:', err);
  }
}

function createCommentCard(c) {
  const div = document.createElement('div');
  div.className = 'comment-card';
  const initial = c.user_name ? c.user_name.charAt(0) : 'U';
  const timeStr = new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  div.innerHTML = `
    <div class="avatar avatar-sm" style="background-color: ${c.user_color || '#3b82f6'}">${initial}</div>
    <div class="comment-content">
      <div class="comment-header">
        <span class="comment-author">${escapeHtml(c.user_name)}</span>
        <span class="comment-time">${timeStr}</span>
      </div>
      <p class="comment-text">${escapeHtml(c.content)}</p>
    </div>
  `;
  return div;
}

// ======================== NOTIFICATIONS ======================== //

async function loadNotifications() {
  try {
    const data = await api('/api/notifications');
    state.notifications = data.notifications;
    renderNotifications();
  } catch (err) {
    console.error('Failed to load notifications:', err);
  }
}

function renderNotifications() {
  const unread = state.notifications.filter(n => !n.is_read).length;
  if (unread > 0) {
    unreadCountBadge.textContent = unread;
    unreadCountBadge.style.display = 'inline-block';
  } else {
    unreadCountBadge.style.display = 'none';
  }

  if (state.notifications.length === 0) {
    notificationsList.innerHTML = '<li class="empty-state">No new notifications</li>';
    return;
  }

  notificationsList.innerHTML = '';
  state.notifications.forEach(n => {
    const li = document.createElement('li');
    li.className = `notification-item ${n.is_read ? '' : 'unread'}`;
    const timeStr = new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `
      <div class="avatar avatar-sm" style="background-color: ${n.actor_color || '#3b82f6'}">${n.actor_name ? n.actor_name.charAt(0) : '🔔'}</div>
      <div>
        <p style="color: var(--text-main); font-weight: 500;">${escapeHtml(n.message)}</p>
        <span style="font-size: 0.7rem; color: var(--text-dim);">${timeStr}</span>
      </div>
    `;
    li.addEventListener('click', async () => {
      if (!n.is_read) {
        await api(`/api/notifications/${n.id}/read`, { method: 'PUT' });
        n.is_read = 1;
        renderNotifications();
      }
      if (n.task_id) {
        openTaskDetail(n.task_id);
      }
    });
    notificationsList.appendChild(li);
  });
}

// ======================== WEBSOCKET REAL-TIME EVENTS ======================== //

function setupSocketListeners() {
  socket.on('task:created', (data) => {
    if (state.activeProject && data.task.project_id === state.activeProject.id) {
      // Check if already in tasks
      if (!state.tasks.some(t => t.id === data.task.id)) {
        state.tasks.push(data.task);
        renderKanban();
        if (data.task.created_by !== state.currentUser?.id) {
          showToast(`⚡ New task added: "${data.task.title}"`, 'info');
        }
      }
    }
  });

  socket.on('task:moved', (data) => {
    const task = state.tasks.find(t => t.id === data.taskId);
    if (task) {
      task.status = data.status;
      renderKanban();
    }
  });

  socket.on('task:updated', (data) => {
    const index = state.tasks.findIndex(t => t.id === data.task.id);
    if (index !== -1) {
      state.tasks[index] = data.task;
      renderKanban();
      if (state.activeDetailTaskId === data.task.id) {
        openTaskDetail(data.task.id);
      }
    }
  });

  socket.on('task:deleted', (data) => {
    state.tasks = state.tasks.filter(t => t.id !== data.taskId);
    renderKanban();
    if (state.activeDetailTaskId === data.taskId) {
      taskDetailModal.classList.add('hidden');
    }
  });

  socket.on('comment:added', (data) => {
    // Update comment badge count on card
    const task = state.tasks.find(t => t.id === data.taskId);
    if (task) {
      task.comment_count = (task.comment_count || 0) + 1;
      renderKanban();
    }

    // If modal is open for this task, append comment immediately!
    if (state.activeDetailTaskId === data.taskId) {
      const container = document.getElementById('commentsContainer');
      const emptyState = container.querySelector('.empty-state');
      if (emptyState) emptyState.remove();

      container.appendChild(createCommentCard(data.comment));
      container.scrollTop = container.scrollHeight;
      document.getElementById('commentCount').textContent = Number(document.getElementById('commentCount').textContent) + 1;
    }
  });

  socket.on('notification:new', (data) => {
    showToast(`🔔 ${data.message}`, 'info');
    loadNotifications();
  });

  socket.on('member:joined', async (data) => {
    if (state.activeProject && data.projectId === state.activeProject.id) {
      state.projectMembers.push(data.user);
      renderProjectMembers();
      populateTaskAssigneeDropdown();
      showToast(`👋 ${data.user.name} joined this project!`, 'info');
    }
  });
}

// ======================== EVENT LISTENERS ======================== //

function setupEventListeners() {
  // Tabs in Auth Modal
  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    formRegister.classList.remove('hidden');
    formLogin.classList.add('hidden');
  });

  // Login Submit
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    await login(email, password);
  });

  // Register Submit
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const name = document.getElementById('regName').value;
      const email = document.getElementById('regEmail').value;
      const role_title = document.getElementById('regRole').value;
      const password = document.getElementById('regPassword').value;

      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, role_title, password })
      });

      state.token = data.token;
      state.currentUser = data.user;
      localStorage.setItem('taskflow_token', data.token);
      localStorage.setItem('taskflow_user', JSON.stringify(data.user));

      authModal.classList.add('hidden');
      renderUserBox();
      showToast('Account created successfully!', 'success');
      await loadInitialData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Logout
  btnLogout.addEventListener('click', logout);

  // Demo user switcher
  demoUserSwitcher.addEventListener('change', (e) => {
    const email = e.target.value;
    if (email) {
      login(email, 'password123');
    }
  });

  // Filter Buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderKanban();
    });
  });

  // Modals Close buttons
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-backdrop').forEach(modal => {
        if (modal.id !== 'authModal') {
          modal.classList.add('hidden');
        }
      });
    });
  });

  // Open New Task Modal
  btnOpenNewTaskModal.addEventListener('click', () => {
    if (!state.activeProject) {
      showToast('Please select or create a project first', 'error');
      return;
    }
    formCreateTask.reset();
    document.getElementById('taskInputId').value = '';
    document.getElementById('taskModalTitle').textContent = 'Create New Task';
    taskModal.classList.remove('hidden');
  });

  // Open from Column '+' button
  document.querySelectorAll('.btn-add-card-column').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.activeProject) return;
      formCreateTask.reset();
      document.getElementById('taskInputId').value = '';
      taskInputStatus.value = btn.dataset.status;
      document.getElementById('taskModalTitle').textContent = `Add Task to ${btn.dataset.status.toUpperCase()}`;
      taskModal.classList.remove('hidden');
    });
  });

  // Create Task Form Submit
  formCreateTask.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = {
        title: document.getElementById('taskInputTitle').value,
        description: document.getElementById('taskInputDesc').value,
        status: taskInputStatus.value,
        priority: document.getElementById('taskInputPriority').value,
        tag: document.getElementById('taskInputTag').value,
        due_date: document.getElementById('taskInputDueDate').value,
        assigned_to: taskInputAssignee.value || null
      };

      await api(`/api/projects/${state.activeProject.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      taskModal.classList.add('hidden');
      showToast('Task created!', 'success');
      // Wait for socket broadcast or refresh
      const tasksData = await api(`/api/projects/${state.activeProject.id}/tasks`);
      state.tasks = tasksData.tasks;
      renderKanban();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Change status directly in Task Detail
  detailStatusSelect.addEventListener('change', async (e) => {
    if (!state.activeDetailTaskId) return;
    const newStatus = e.target.value;
    try {
      await api(`/api/tasks/${state.activeDetailTaskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      const task = state.tasks.find(t => t.id === state.activeDetailTaskId);
      if (task) task.status = newStatus;
      document.getElementById('detailTaskStatus').textContent = newStatus.replace('_', ' ').toUpperCase();
      renderKanban();
      showToast('Status updated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Post Comment Submit
  formAddComment.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('commentInputContent');
    const content = input.value.trim();
    if (!content || !state.activeDetailTaskId) return;

    try {
      await api(`/api/tasks/${state.activeDetailTaskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content })
      });
      input.value = '';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Delete Task
  btnDeleteTask.addEventListener('click', async () => {
    if (!state.activeDetailTaskId) return;
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
      await api(`/api/tasks/${state.activeDetailTaskId}`, { method: 'DELETE' });
      taskDetailModal.classList.add('hidden');
      state.tasks = state.tasks.filter(t => t.id !== state.activeDetailTaskId);
      renderKanban();
      showToast('Task deleted', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Open Create Project Modal
  btnNewProject.addEventListener('click', () => {
    formCreateProject.reset();
    projectModal.classList.remove('hidden');
  });

  // Submit Create Project
  formCreateProject.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const title = document.getElementById('projectInputTitle').value;
      const description = document.getElementById('projectInputDesc').value;

      const data = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ title, description })
      });

      projectModal.classList.add('hidden');
      state.projects.unshift(data.project);
      await selectProject(data.project.id);
      showToast('Project created successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Open Invite Member Modal
  btnInviteMember.addEventListener('click', () => {
    if (!state.activeProject) return;
    inviteModal.classList.remove('hidden');
  });

  // Submit Invite Member
  formInviteMember.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const userId = inviteUserSelect.value;
      if (!userId) return;

      await api(`/api/projects/${state.activeProject.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId })
      });

      inviteModal.classList.add('hidden');
      showToast('Team member added to project!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Notifications Toggle
  btnNotifications.addEventListener('click', () => {
    notificationsDropdown.classList.toggle('hidden');
  });

  // Mark all notifications read
  btnMarkAllRead.addEventListener('click', async () => {
    await api('/api/notifications/read-all', { method: 'PUT' });
    state.notifications.forEach(n => n.is_read = 1);
    renderNotifications();
  });

  // Close notifications when clicking outside
  document.addEventListener('click', (e) => {
    if (!btnNotifications.contains(e.target) && !notificationsDropdown.contains(e.target)) {
      notificationsDropdown.classList.add('hidden');
    }
  });

  setupDragAndDrop();
}

// ======================== TOAST UTILITY ======================== //

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start application
window.addEventListener('DOMContentLoaded', init);
