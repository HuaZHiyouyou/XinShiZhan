import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');

/**
 * 数据目录：默认 `server/data`，可用 XSZ_DATA_DIR 指向别处。
 * 用途：一份代码跑多个实例，或生成一份可独立分发的「纯净数据」（见 opensource/）。
 */
export const DATA_DIR = process.env.XSZ_DATA_DIR
  ? path.resolve(process.env.XSZ_DATA_DIR)
  : path.join(SERVER_ROOT, 'data');
export const UPLOAD_DIR = path.join(SERVER_ROOT, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'images'), { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'audio'), { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'xinshizhan.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

/** 老库补列：schema.sql 的 CREATE TABLE IF NOT EXISTS 不会给已存在的表加字段 */
function ensureColumns(table, columns) {
  const existing = new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name)
  );
  Object.entries(columns).forEach(([name, ddl]) => {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  });
}

ensureColumns('users', {
  avatar_url: "TEXT NOT NULL DEFAULT ''",
  intro: "TEXT NOT NULL DEFAULT ''",
  gender: "TEXT NOT NULL DEFAULT 'secret'",
  age: 'INTEGER',
  birthday: 'TEXT',
  occupation: "TEXT NOT NULL DEFAULT ''",
  location: "TEXT NOT NULL DEFAULT ''",
  hobbies: "TEXT NOT NULL DEFAULT '[]'",
  /* 用户编号与昵称 */
  uid: 'INTEGER',
  nickname: "TEXT NOT NULL DEFAULT ''",
  nickname_changed_at: 'TEXT',
  account_changed_at: 'TEXT',
  /* 邮箱 / 手机号（预留，受站点开关控制） */
  email: "TEXT NOT NULL DEFAULT ''",
  email_verified: 'INTEGER NOT NULL DEFAULT 0',
  email_verified_at: 'TEXT',
  phone: "TEXT NOT NULL DEFAULT ''",
  phone_verified: 'INTEGER NOT NULL DEFAULT 0',
  phone_verified_at: 'TEXT',
  /* 实名信息（预留，受站点开关控制，密文存储） */
  real_name: "TEXT NOT NULL DEFAULT ''",
  id_number: "TEXT NOT NULL DEFAULT ''",
  real_verified: 'INTEGER NOT NULL DEFAULT 0',
  real_verified_at: 'TEXT',
  /* 真实来源留痕：注册 IP 与最近一次登录 IP，便于核对与风控复盘 */
  register_ip: "TEXT NOT NULL DEFAULT ''",
  last_login_ip: "TEXT NOT NULL DEFAULT ''",
});

ensureColumns('posts', {
  deleted_at: 'TEXT',
  deleted_by: 'INTEGER',
});

/* 举报处理时写给举报人的说明：让「已处理」不再是一句空话 */
ensureColumns('reports', {
  handled_note: "TEXT NOT NULL DEFAULT ''",
});

/*
 * 站内信的「弹窗提醒」标记：
 * popup=1 表示这封信要在收件人**下次进站**时弹一次，
 * popup_seen_at 记下弹过的时刻 —— 弹过就不再弹，不会每次打开都来打扰。
 */
ensureColumns('notifications', {
  popup: 'INTEGER NOT NULL DEFAULT 0',
  popup_seen_at: 'TEXT',
});

ensureColumns('users', {
  avatar_pending: "TEXT NOT NULL DEFAULT ''",
  avatar_status: "TEXT NOT NULL DEFAULT 'none'",
  avatar_submitted_at: 'TEXT',
});

/**
 * 用户编号（uid）：从 100001 起按注册顺序递增，全局唯一。
 * 老库里的历史账号按 id 升序一次性补齐，保证任何账号都有编号。
 */
export const UID_BASE = 100000;

db.prepare('SELECT id FROM users WHERE uid IS NULL ORDER BY id ASC')
  .all()
  .forEach((row, index) => {
    db.prepare('UPDATE users SET uid = ? WHERE id = ?').run(UID_BASE + index + 1, row.id);
  });

const usedUids = new Set(
  db
    .prepare('SELECT uid FROM users WHERE uid IS NOT NULL')
    .all()
    .map((row) => Number(row.uid))
);

/** 分配下一个可用编号：与已有编号去重，避免手工改库后产生冲突 */
export function allocateUid() {
  let next = UID_BASE + 1;
  const maxRow = db.prepare('SELECT MAX(uid) AS m FROM users').get();
  if (maxRow?.m) next = Math.max(next, Number(maxRow.m) + 1);
  while (usedUids.has(next)) next += 1;
  usedUids.add(next);
  return next;
}

/* 索引在建列之后创建：老库先补列再补编号，此处不能放在 schema.sql 里 */
db.exec('CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid)');

/* 找回密码申请：用户提交后由客服/站长核实处理，全程留痕 */
db.exec(`CREATE TABLE IF NOT EXISTS recovery_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uid INTEGER,
  method TEXT NOT NULL DEFAULT 'service',
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT NOT NULL DEFAULT '',
  channel_snapshot TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  handled_by INTEGER,
  handled_at TEXT,
  handled_note TEXT NOT NULL DEFAULT ''
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_recovery_status ON recovery_requests(status, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_requests(user_id)');

/* 访客登录留痕：每次访客进入都记录 IP 与设备信息，便于审计 */
db.exec(`CREATE TABLE IF NOT EXISTS guest_logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  anon_name TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_guest_logins_created ON guest_logins(created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_guest_logins_ip ON guest_logins(ip)');

/* 认证安全事件：登录/注册/握手/校验失败等全部留痕，既是审计也是限流计数依据 */
db.exec(`CREATE TABLE IF NOT EXISTS auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_auth_events_ip ON auth_events(ip, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(username, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_auth_events_kind ON auth_events(kind, created_at DESC)');

/* 锁定记录：按 IP 与按用户名双维度锁定，支持递增时长与管理员手动解锁 */
db.exec(`CREATE TABLE IF NOT EXISTS auth_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  lifted_at TEXT,
  lifted_by INTEGER
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_auth_locks_active ON auth_locks(scope, key, lifted_at)');

/* 服务端会话：令牌短时效且可被吊销，登出/封禁/改角色立即失效 */
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

db.exec('CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(deleted_at)');

/**
 * 一次性迁移：旧默认的最短密码长度是 8 位。
 * 新策略放宽到 6 位（只守长度底线，强度交给前端提示），
 * 所以「仍是旧默认值」的站点跟着一起放宽；被管理员显式改过的值原样保留。
 */
function migratePasswordPolicy() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'site_config'").get();
  if (!row) return;
  let parsed;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return;
  }
  if (parsed?.security?.minPasswordLength !== 8) return;
  parsed.security.minPasswordLength = 6;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'site_config'").run(JSON.stringify(parsed));
  console.log('[db] migrated minPasswordLength: 8 -> 6');
}

migratePasswordPolicy();

export function nowIso() {
  return new Date().toISOString();
}

export function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}