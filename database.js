const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'project_management.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role_title TEXT DEFAULT 'Member',
      avatar_color TEXT DEFAULT '#2563eb',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'todo', -- 'todo', 'in_progress', 'review', 'done'
      priority TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
      tag TEXT DEFAULT 'Feature',
      due_date TEXT,
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Reset or seed sample data if users table is empty or needs user 1 / user 2
  const user1 = db.prepare('SELECT id FROM users WHERE email = ?').get('user1@example.com');
  if (!user1) {
    seedInitialData();
  }
}

function seedInitialData() {
  console.log('🌱 Resetting and seeding demo accounts (User 1, User 2, User 3, User 4)...');
  
  // Clear existing data cleanly
  db.exec(`
    DELETE FROM comments;
    DELETE FROM notifications;
    DELETE FROM tasks;
    DELETE FROM project_members;
    DELETE FROM projects;
    DELETE FROM users;
  `);

  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync('password123', salt);

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password, role_title, avatar_color)
    VALUES (?, ?, ?, ?, ?)
  `);

  const u1 = insertUser.run('User 1', 'user1@example.com', hashedPassword, 'Project Lead', '#3b82f6').lastInsertRowid;
  const u2 = insertUser.run('User 2', 'user2@example.com', hashedPassword, 'Frontend Developer', '#ec4899').lastInsertRowid;
  const u3 = insertUser.run('User 3', 'user3@example.com', hashedPassword, 'Backend Engineer', '#10b981').lastInsertRowid;
  const u4 = insertUser.run('User 4', 'user4@example.com', hashedPassword, 'UI/UX Designer', '#8b5cf6').lastInsertRowid;

  // Insert Sample Project
  const insertProject = db.prepare(`
    INSERT INTO projects (title, description, owner_id)
    VALUES (?, ?, ?)
  `);

  const p1 = insertProject.run(
    'Alpha Project Workspace',
    'Collaborative project board with live tasks, assignments, and team chat.',
    Number(u1)
  ).lastInsertRowid;

  // Add members
  const addMember = db.prepare(`
    INSERT INTO project_members (project_id, user_id, role)
    VALUES (?, ?, ?)
  `);

  addMember.run(Number(p1), Number(u1), 'owner');
  addMember.run(Number(p1), Number(u2), 'member');
  addMember.run(Number(p1), Number(u3), 'member');
  addMember.run(Number(p1), Number(u4), 'member');

  // Insert Sample Tasks
  const insertTask = db.prepare(`
    INSERT INTO tasks (project_id, title, description, status, priority, tag, due_date, assigned_to, created_by, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const t1 = insertTask.run(
    Number(p1),
    'Implement WebSocket real-time updates',
    'Broadcast card movements, creation, and comments to all online team members.',
    'in_progress',
    'urgent',
    'Backend',
    '2026-10-25',
    Number(u3),
    Number(u1),
    0
  ).lastInsertRowid;

  const t2 = insertTask.run(
    Number(p1),
    'Design interactive Kanban board UI',
    'Create sleek draggable task columns with priority badges and member avatar chips.',
    'done',
    'high',
    'Design',
    '2026-10-20',
    Number(u4),
    Number(u1),
    0
  ).lastInsertRowid;

  const t3 = insertTask.run(
    Number(p1),
    'Build authentication & session handler',
    'Implement JWT tokens and secure password hashing using bcryptjs.',
    'done',
    'high',
    'Security',
    '2026-10-18',
    Number(u1),
    Number(u2),
    1
  ).lastInsertRowid;

  const t4 = insertTask.run(
    Number(p1),
    'Add task assignment & member invite modal',
    'Allow team members to invite colleagues by selecting their demo account.',
    'todo',
    'medium',
    'Feature',
    '2026-10-28',
    Number(u2),
    Number(u1),
    0
  ).lastInsertRowid;

  const t5 = insertTask.run(
    Number(p1),
    'Create automated notification feed',
    'Notify users when they are assigned to a task or when someone comments.',
    'review',
    'medium',
    'Feature',
    '2026-10-24',
    Number(u2),
    Number(u3),
    0
  ).lastInsertRowid;

  // Insert sample comments
  const insertComment = db.prepare(`
    INSERT INTO comments (task_id, user_id, content)
    VALUES (?, ?, ?)
  `);

  insertComment.run(Number(t1), Number(u1), 'Hey User 3, how is the WebSocket connection test going?');
  insertComment.run(Number(t1), Number(u3), 'Working great User 1! Real-time card drag and live comments are synced.');
  insertComment.run(Number(t2), Number(u1), 'Great job on the UI User 4!');
  insertComment.run(Number(t5), Number(u2), 'Notification bell is connected and shows unread badges.');

  console.log('✅ Demo accounts seeded: User 1, User 2, User 3, User 4');
}

module.exports = {
  db,
  initDatabase
};
