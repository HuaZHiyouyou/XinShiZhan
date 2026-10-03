PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  anon_name TEXT NOT NULL,
  anon_color TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  violation_count INTEGER NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  avatar_pending TEXT NOT NULL DEFAULT '',
  avatar_status TEXT NOT NULL DEFAULT 'none',
  avatar_submitted_at TEXT,
  intro TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT 'secret',
  age INTEGER,
  birthday TEXT,
  occupation TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  hobbies TEXT NOT NULL DEFAULT '[]',
  /* 用户编号：每个账号一份、全局唯一且自增，注册即分配，作为对外可见的账号标识 */
  uid INTEGER UNIQUE,
  /* 昵称：用户自定义的站内显示名；为空时退回系统分配的匿名身份 anon_name */
  nickname TEXT NOT NULL DEFAULT '',
  nickname_changed_at TEXT,
  account_changed_at TEXT,
  /* 邮箱 / 手机号：预留字段，验证能力由站点开关控制，未开启时不可写 */
  email TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  email_verified_at TEXT,
  phone TEXT NOT NULL DEFAULT '',
  phone_verified INTEGER NOT NULL DEFAULT 0,
  phone_verified_at TEXT,
  /* 实名信息：预留字段，证件号与姓名落库前加密存储，仅本人可读 */
  real_name TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  real_verified INTEGER NOT NULL DEFAULT 0,
  real_verified_at TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  until TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  lifted_at TEXT,
  lifted_by INTEGER
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  mood TEXT NOT NULL DEFAULT 'plain',
  tags TEXT NOT NULL DEFAULT '[]',
  images TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'public',
  review_status TEXT NOT NULL DEFAULT 'pending',
  review_mode TEXT NOT NULL DEFAULT 'auto',
  reject_reason TEXT,
  auto_flags TEXT NOT NULL DEFAULT '[]',
  lifecycle TEXT NOT NULL DEFAULT 'live',
  publish_at TEXT,
  expires_at TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  danmaku_count INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  deleted_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_by INTEGER,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_review ON posts(review_status);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'published',
  review_mode TEXT NOT NULL DEFAULT 'auto',
  reject_reason TEXT,
  auto_flags TEXT NOT NULL DEFAULT '[]',
  like_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  reviewed_by INTEGER,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_post ON messages(post_id);

CREATE TABLE IF NOT EXISTS danmaku (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER,
  content TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'azure',
  effect TEXT NOT NULL DEFAULT 'glow',
  mode TEXT NOT NULL DEFAULT 'scroll',
  review_status TEXT NOT NULL DEFAULT 'published',
  review_mode TEXT NOT NULL DEFAULT 'auto',
  reject_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_danmaku_created ON danmaku(created_at DESC);

CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  handled_by INTEGER,
  created_at TEXT NOT NULL,
  handled_at TEXT,
  handled_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  /* 1 = 收件人下次进站时弹窗提醒一次（站内回复可选），弹过就不再弹 */
  popup INTEGER NOT NULL DEFAULT 0,
  popup_seen_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS music_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '未知',
  album TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'builtin',
  uploaded_by INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);