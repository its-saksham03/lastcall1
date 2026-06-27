import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'lastcall.db');

// Initialize sqlite database connection
const db = new DatabaseSync(DB_FILE);

// Setup schema tables
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    deadline TEXT NOT NULL,
    priority TEXT NOT NULL,
    description TEXT,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS calendar_blocks (
    id TEXT PRIMARY KEY,
    taskId TEXT NOT NULL,
    title TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    status TEXT NOT NULL,
    googleEventId TEXT,
    createdAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL,
    action TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS auth_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

console.log('SQLite Database operational at:', DB_FILE);

// Tasks Helpers
export function getTasks() {
  const stmt = db.prepare('SELECT * FROM tasks');
  return stmt.all();
}

export function addTask(task) {
  const id = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const title = task.title;
  const deadline = task.deadline;
  const priority = task.priority || 'medium';
  const description = task.description || '';
  const source = task.source || 'manual';
  const status = 'pending';
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO tasks (id, title, deadline, priority, description, source, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, title, deadline, priority, description, source, status, now, now);

  return { id, title, deadline, priority, description, source, status, createdAt: now, updatedAt: now };
}

export function updateTask(id, updates) {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!existing) return null;

  const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  
  const stmt = db.prepare(`
    UPDATE tasks 
    SET title = ?, deadline = ?, priority = ?, description = ?, source = ?, status = ?, updatedAt = ?
    WHERE id = ?
  `);
  stmt.run(merged.title, merged.deadline, merged.priority, merged.description, merged.source, merged.status, merged.updatedAt, id);
  
  return merged;
}

export function deleteTask(id) {
  const stmt = db.prepare('DELETE FROM tasks WHERE id = ?');
  stmt.run(id);

  // Clean up any calendar blocks associated with this task
  const blockStmt = db.prepare('DELETE FROM calendar_blocks WHERE taskId = ?');
  blockStmt.run(id);
}

// Activity Log Helpers
export function getActivityLog() {
  const stmt = db.prepare('SELECT * FROM activity_log ORDER BY timestamp DESC');
  const rows = stmt.all();
  return rows.map(r => ({
    ...r,
    action: r.action ? JSON.parse(r.action) : null
  }));
}

export function addActivityLog({ type, description, details = '', status = 'done', action = null }) {
  const id = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const now = new Date().toISOString();
  const actionStr = action ? JSON.stringify(action) : null;

  const stmt = db.prepare(`
    INSERT INTO activity_log (id, timestamp, type, description, details, status, action)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, now, type, description, details, status, actionStr);

  return { id, timestamp: now, type, description, details, status, action };
}

export function updateActivityLog(id, updates) {
  const existing = db.prepare('SELECT * FROM activity_log WHERE id = ?').get(id);
  if (!existing) return null;

  const merged = { ...existing, ...updates };
  // Handle action parameter update if exists
  const actionStr = merged.action && typeof merged.action === 'object' ? JSON.stringify(merged.action) : merged.action;

  const stmt = db.prepare(`
    UPDATE activity_log
    SET timestamp = ?, type = ?, description = ?, details = ?, status = ?, action = ?
    WHERE id = ?
  `);
  stmt.run(merged.timestamp, merged.type, merged.description, merged.details, merged.status, actionStr, id);

  return {
    ...merged,
    action: merged.action ? (typeof merged.action === 'string' ? JSON.parse(merged.action) : merged.action) : null
  };
}

// Calendar Blocks Helpers
export function getCalendarBlocks() {
  const stmt = db.prepare('SELECT * FROM calendar_blocks');
  return stmt.all();
}

export function addCalendarBlock(block) {
  const id = block.id || 'block_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const taskId = block.taskId;
  const title = block.title;
  const start = block.start;
  const end = block.end;
  const status = 'scheduled';
  const googleEventId = block.googleEventId || null;
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO calendar_blocks (id, taskId, title, start, end, status, googleEventId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, taskId, title, start, end, status, googleEventId, now);

  return { id, taskId, title, start, end, status, googleEventId, createdAt: now };
}

export function clearCalendarBlocksForTask(taskId) {
  const stmt = db.prepare('DELETE FROM calendar_blocks WHERE taskId = ?');
  stmt.run(taskId);
}

// OAuth Credentials & Profile Helpers
export function getOAuthTokens() {
  const row = db.prepare("SELECT value FROM auth_state WHERE key = 'oauth_tokens'").get();
  return row ? JSON.parse(row.value) : null;
}

export function setOAuthTokens(tokens) {
  const tokensStr = JSON.stringify(tokens);
  const stmt = db.prepare(`
    INSERT INTO auth_state (key, value)
    VALUES ('oauth_tokens', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(tokensStr);
}

export function getUserProfile() {
  const row = db.prepare("SELECT value FROM auth_state WHERE key = 'user_profile'").get();
  return row ? JSON.parse(row.value) : null;
}

export function setUserProfile(profile) {
  const profileStr = JSON.stringify(profile);
  const stmt = db.prepare(`
    INSERT INTO auth_state (key, value)
    VALUES ('user_profile', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(profileStr);
}

export function clearAuth() {
  const stmt = db.prepare("DELETE FROM auth_state WHERE key IN ('oauth_tokens', 'user_profile', 'latest_plan')");
  stmt.run();
}

export function getLatestPlan() {
  const row = db.prepare("SELECT value FROM auth_state WHERE key = 'latest_plan'").get();
  return row ? JSON.parse(row.value) : null;
}

export function setLatestPlan(plan) {
  const planStr = JSON.stringify(plan);
  const stmt = db.prepare(`
    INSERT INTO auth_state (key, value)
    VALUES ('latest_plan', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(planStr);
}

export function resetAll() {
  db.exec('DELETE FROM tasks');
  db.exec('DELETE FROM calendar_blocks');
  db.exec('DELETE FROM activity_log');
  db.exec('DELETE FROM auth_state');
}
