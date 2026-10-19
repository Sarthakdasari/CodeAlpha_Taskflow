const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { db, initDatabase } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  }
});

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'trello_asana_super_secret_key_2026';

// Initialize DB schema & seeds
initDatabase();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to convert BigInts to Number in SQLite query results
function sanitizeRow(row) {
  if (!row) return row;
  const copy = { ...row };
  for (const key of Object.keys(copy)) {
    if (typeof copy[key] === 'bigint') {
      copy[key] = Number(copy[key]);
    }
  }
  return copy;
}

function sanitizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(sanitizeRow);
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = decodedUser;
    next();
  });
}

// ======================== AUTH ROUTES ======================== //

// Register
app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, password, role_title } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    const colors = ['#2563eb', '#7c3aed', '#db2777', '#059669', '#d97706', '#dc2626'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const result = db.prepare(`
      INSERT INTO users (name, email, password, role_title, avatar_color)
      VALUES (?, ?, ?, ?, ?)
    `).run(name.trim(), email.toLowerCase().trim(), hashedPassword, role_title || 'Team Member', randomColor);

    const newUserId = Number(result.lastInsertRowid);
    const user = sanitizeRow(db.prepare('SELECT id, name, email, role_title, avatar_color, created_at FROM users WHERE id = ?').get(newUserId));

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ message: 'User registered successfully', token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const rawUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!rawUser) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = bcrypt.compareSync(password, rawUser.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = sanitizeRow({
      id: rawUser.id,
      name: rawUser.name,
      email: rawUser.email,
      role_title: rawUser.role_title,
      avatar_color: rawUser.avatar_color,
      created_at: rawUser.created_at
    });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ message: 'Logged in successfully', token, user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Current User Profile
app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = sanitizeRow(db.prepare('SELECT id, name, email, role_title, avatar_color, created_at FROM users WHERE id = ?').get(req.user.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// List all users (for task assignments & member adding)
app.get('/api/users', authenticateToken, (req, res) => {
  const users = sanitizeRows(db.prepare('SELECT id, name, email, role_title, avatar_color FROM users ORDER BY name ASC').all());
  res.json({ users });
});

// ======================== PROJECT ROUTES ======================== //

// Get all projects for logged-in user
app.get('/api/projects', authenticateToken, (req, res) => {
  try {
    const projects = sanitizeRows(db.prepare(`
      SELECT p.*, u.name as owner_name, u.avatar_color as owner_color,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as member_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as completed_task_count
      FROM projects p
      JOIN users u ON p.owner_id = u.id
      WHERE p.owner_id = ?
         OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
      ORDER BY p.created_at DESC
    `).all(req.user.id, req.user.id));

    res.json({ projects });
  } catch (err) {
    console.error('Fetch projects error:', err);
    res.status(500).json({ error: 'Failed to retrieve projects' });
  }
});

// Create new project
app.post('/api/projects', authenticateToken, (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Project title is required' });
    }

    const insertResult = db.prepare(`
      INSERT INTO projects (title, description, owner_id)
      VALUES (?, ?, ?)
    `).run(title.trim(), description ? description.trim() : '', req.user.id);

    const projectId = Number(insertResult.lastInsertRowid);

    // Add owner as a project member with 'owner' role
    db.prepare(`
      INSERT INTO project_members (project_id, user_id, role)
      VALUES (?, ?, 'owner')
    `).run(projectId, req.user.id);

    const project = sanitizeRow(db.prepare(`
      SELECT p.*, u.name as owner_name, 1 as member_count, 0 as task_count, 0 as completed_task_count
      FROM projects p
      JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `).get(projectId));

    res.status(201).json({ message: 'Project created successfully', project });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get single project details & members
app.get('/api/projects/:id', authenticateToken, (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const project = sanitizeRow(db.prepare(`
      SELECT p.*, u.name as owner_name, u.avatar_color as owner_color
      FROM projects p
      JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `).get(projectId));

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const members = sanitizeRows(db.prepare(`
      SELECT u.id, u.name, u.email, u.role_title, u.avatar_color, pm.role, pm.joined_at
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ?
      ORDER BY pm.role = 'owner' DESC, u.name ASC
    `).all(projectId));

    res.json({ project, members });
  } catch (err) {
    console.error('Get project error:', err);
    res.status(500).json({ error: 'Failed to get project details' });
  }
});

// Add member to project
app.post('/api/projects/:id/members', authenticateToken, (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { email, user_id } = req.body;

    let targetUser;
    if (user_id) {
      targetUser = sanitizeRow(db.prepare('SELECT id, name, email, avatar_color FROM users WHERE id = ?').get(user_id));
    } else if (email) {
      targetUser = sanitizeRow(db.prepare('SELECT id, name, email, avatar_color FROM users WHERE email = ?').get(email.toLowerCase().trim()));
    }

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found in system' });
    }

    const existingMember = db.prepare('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, targetUser.id);
    if (existingMember) {
      return res.status(409).json({ error: 'User is already a member of this project' });
    }

    db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, "member")').run(projectId, targetUser.id);

    // Create notification
    db.prepare(`
      INSERT INTO notifications (user_id, actor_id, project_id, message)
      VALUES (?, ?, ?, ?)
    `).run(targetUser.id, req.user.id, projectId, `${req.user.name} added you to project #${projectId}`);

    io.to(`user-${targetUser.id}`).emit('notification:new', {
      message: `${req.user.name} added you to a project!`,
      projectId
    });

    io.to(`project-${projectId}`).emit('member:joined', {
      projectId,
      user: targetUser
    });

    res.status(201).json({ message: 'Member added successfully', member: targetUser });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Delete project
app.delete('/api/projects/:id', authenticateToken, (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const project = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (Number(project.owner_id) !== req.user.id) {
      return res.status(403).json({ error: 'Only the project owner can delete this project' });
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

    io.to(`project-${projectId}`).emit('project:deleted', { projectId });

    res.json({ message: 'Project deleted successfully' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// ======================== TASK ROUTES ======================== //

// Get tasks for a project
app.get('/api/projects/:projectId/tasks', authenticateToken, (req, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const tasks = sanitizeRows(db.prepare(`
      SELECT t.*,
        u_assignee.name as assignee_name, u_assignee.avatar_color as assignee_color,
        u_creator.name as creator_name,
        (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) as comment_count
      FROM tasks t
      LEFT JOIN users u_assignee ON t.assigned_to = u_assignee.id
      JOIN users u_creator ON t.created_by = u_creator.id
      WHERE t.project_id = ?
      ORDER BY t.position ASC, t.created_at ASC
    `).all(projectId));

    res.json({ tasks });
  } catch (err) {
    console.error('Fetch tasks error:', err);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Create task card
app.post('/api/projects/:projectId/tasks', authenticateToken, (req, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const { title, description, status, priority, tag, due_date, assigned_to } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Task title is required' });
    }

    const taskStatus = status || 'todo';
    const taskPriority = priority || 'medium';
    const taskTag = tag || 'Feature';

    // Position calculation
    const maxPosRow = db.prepare('SELECT MAX(position) as max_pos FROM tasks WHERE project_id = ? AND status = ?').get(projectId, taskStatus);
    const nextPos = (maxPosRow && maxPosRow.max_pos !== null) ? Number(maxPosRow.max_pos) + 1 : 0;

    const result = db.prepare(`
      INSERT INTO tasks (project_id, title, description, status, priority, tag, due_date, assigned_to, created_by, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      title.trim(),
      description ? description.trim() : '',
      taskStatus,
      taskPriority,
      taskTag,
      due_date || null,
      assigned_to ? Number(assigned_to) : null,
      req.user.id,
      nextPos
    );

    const taskId = Number(result.lastInsertRowid);
    const task = sanitizeRow(db.prepare(`
      SELECT t.*,
        u_assignee.name as assignee_name, u_assignee.avatar_color as assignee_color,
        u_creator.name as creator_name,
        0 as comment_count
      FROM tasks t
      LEFT JOIN users u_assignee ON t.assigned_to = u_assignee.id
      JOIN users u_creator ON t.created_by = u_creator.id
      WHERE t.id = ?
    `).get(taskId));

    // Send notification if assigned
    if (task.assigned_to && task.assigned_to !== req.user.id) {
      db.prepare(`
        INSERT INTO notifications (user_id, actor_id, project_id, task_id, message)
        VALUES (?, ?, ?, ?, ?)
      `).run(task.assigned_to, req.user.id, projectId, taskId, `${req.user.name} assigned you to "${task.title}"`);

      io.to(`user-${task.assigned_to}`).emit('notification:new', {
        message: `${req.user.name} assigned you to "${task.title}"`,
        projectId,
        taskId
      });
    }

    // Broadcast WebSocket event
    io.to(`project-${projectId}`).emit('task:created', { task });

    res.status(201).json({ message: 'Task created successfully', task });
  } catch (err) {
    console.error('Create task error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update task details
app.put('/api/tasks/:id', authenticateToken, (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { title, description, status, priority, tag, due_date, assigned_to } = req.body;

    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    db.prepare(`
      UPDATE tasks
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          status = COALESCE(?, status),
          priority = COALESCE(?, priority),
          tag = COALESCE(?, tag),
          due_date = COALESCE(?, due_date),
          assigned_to = COALESCE(?, assigned_to),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title ? title.trim() : null,
      description !== undefined ? description.trim() : null,
      status || null,
      priority || null,
      tag || null,
      due_date || null,
      assigned_to !== undefined ? (assigned_to ? Number(assigned_to) : null) : null,
      taskId
    );

    const updatedTask = sanitizeRow(db.prepare(`
      SELECT t.*,
        u_assignee.name as assignee_name, u_assignee.avatar_color as assignee_color,
        u_creator.name as creator_name,
        (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) as comment_count
      FROM tasks t
      LEFT JOIN users u_assignee ON t.assigned_to = u_assignee.id
      JOIN users u_creator ON t.created_by = u_creator.id
      WHERE t.id = ?
    `).get(taskId));

    io.to(`project-${updatedTask.project_id}`).emit('task:updated', { task: updatedTask });

    res.json({ message: 'Task updated successfully', task: updatedTask });
  } catch (err) {
    console.error('Update task error:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Move task card (status & position drag-and-drop)
app.patch('/api/tasks/:id/status', authenticateToken, (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { status, position } = req.body;

    const existing = db.prepare('SELECT project_id, status FROM tasks WHERE id = ?').get(taskId);
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const newStatus = status || existing.status;
    const newPos = position !== undefined ? Number(position) : 0;

    db.prepare(`
      UPDATE tasks
      SET status = ?, position = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newStatus, newPos, taskId);

    const task = sanitizeRow(db.prepare(`
      SELECT t.*,
        u_assignee.name as assignee_name, u_assignee.avatar_color as assignee_color,
        u_creator.name as creator_name,
        (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) as comment_count
      FROM tasks t
      LEFT JOIN users u_assignee ON t.assigned_to = u_assignee.id
      JOIN users u_creator ON t.created_by = u_creator.id
      WHERE t.id = ?
    `).get(taskId));

    // Broadcast move event
    io.to(`project-${Number(existing.project_id)}`).emit('task:moved', {
      taskId,
      status: newStatus,
      position: newPos,
      task
    });

    res.json({ message: 'Task status updated', task });
  } catch (err) {
    console.error('Move task error:', err);
    res.status(500).json({ error: 'Failed to move task' });
  }
});

// Delete task
app.delete('/api/tasks/:id', authenticateToken, (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);

    io.to(`project-${Number(task.project_id)}`).emit('task:deleted', {
      taskId,
      projectId: Number(task.project_id)
    });

    res.json({ message: 'Task deleted successfully' });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// ======================== COMMENT ROUTES ======================== //

// Get comments for task
app.get('/api/tasks/:taskId/comments', authenticateToken, (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const comments = sanitizeRows(db.prepare(`
      SELECT c.*, u.name as user_name, u.avatar_color as user_color, u.role_title
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.task_id = ?
      ORDER BY c.created_at ASC
    `).all(taskId));

    res.json({ comments });
  } catch (err) {
    console.error('Fetch comments error:', err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Add comment to task
app.post('/api/tasks/:taskId/comments', authenticateToken, (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content cannot be empty' });
    }

    const task = db.prepare('SELECT id, title, project_id, assigned_to, created_by FROM tasks WHERE id = ?').get(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const insertResult = db.prepare(`
      INSERT INTO comments (task_id, user_id, content)
      VALUES (?, ?, ?)
    `).run(taskId, req.user.id, content.trim());

    const commentId = Number(insertResult.lastInsertRowid);
    const comment = sanitizeRow(db.prepare(`
      SELECT c.*, u.name as user_name, u.avatar_color as user_color, u.role_title
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `).get(commentId));

    // Notify assigned user if someone else commented
    if (task.assigned_to && Number(task.assigned_to) !== req.user.id) {
      db.prepare(`
        INSERT INTO notifications (user_id, actor_id, project_id, task_id, message)
        VALUES (?, ?, ?, ?, ?)
      `).run(Number(task.assigned_to), req.user.id, Number(task.project_id), taskId, `${req.user.name} commented on "${task.title}"`);

      io.to(`user-${Number(task.assigned_to)}`).emit('notification:new', {
        message: `${req.user.name} commented on "${task.title}"`,
        projectId: Number(task.project_id),
        taskId
      });
    }

    // Broadcast to project room
    io.to(`project-${Number(task.project_id)}`).emit('comment:added', {
      taskId,
      comment
    });

    res.status(201).json({ message: 'Comment added', comment });
  } catch (err) {
    console.error('Post comment error:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// ======================== NOTIFICATION ROUTES ======================== //

app.get('/api/notifications', authenticateToken, (req, res) => {
  try {
    const notifications = sanitizeRows(db.prepare(`
      SELECT n.*, u.name as actor_name, u.avatar_color as actor_color
      FROM notifications n
      JOIN users u ON n.actor_id = u.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 20
    `).all(req.user.id));

    res.json({ notifications });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

app.put('/api/notifications/:id/read', authenticateToken, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

app.put('/api/notifications/read-all', authenticateToken, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// ======================== WEBSOCKET HANDLERS ======================== //

io.on('connection', (socket) => {
  // Join project room
  socket.on('join:project', (projectId) => {
    socket.join(`project-${projectId}`);
  });

  socket.on('leave:project', (projectId) => {
    socket.leave(`project-${projectId}`);
  });

  // Join user room for targeted notifications
  socket.on('join:user', (userId) => {
    socket.join(`user-${userId}`);
  });
});

// Fallback to index.html for SPA feel
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 TaskFlow Project Management server is running at http://localhost:${PORT}`);
});
