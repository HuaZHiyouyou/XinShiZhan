import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { allocateUid, db, nowIso } from '../db.js';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  JWT_SECRET,
  PASSWORD_PEPPER,
  SESSION_COOKIE,
  decryptField,
  randomId,
  safeEqual,
  tokenHash,
} from './secrets.js';
import { getSecurityPolicy } from './site.js';
import { anonIdentity } from './anon.js';

const HASH_PREFIX = 'p1$';

/**
 * 角色分层：
 * - superadmin：超级管理员，站点所有者，只能由服务端启动流程自举指定（默认 huazhiyou）；
 * - admin：管理员，负责审核与内容处理，可封禁普通账号，但改不了站点开关与角色；
 * - reviewer：审核员，只做内容审批；
 * - user / guest：普通用户与访客。
 */
export const SUPER_ROLE = 'superadmin';
const ADMIN_ROLES = ['admin', SUPER_ROLE];
const STAFF_ROLES = ['reviewer', 'admin', SUPER_ROLE];

/**
 * 密码存储：pepper（服务端主密钥派生） + SHA-256 摘要 + bcrypt(12)。
 * 即使数据库文件被拖走，缺少服务端 pepper 也无法离线爆破；
 * 摘要化还顺带解决了 bcrypt 72 字节截断问题。
 */
function pepperedDigest(password) {
  return crypto
    .createHash('sha256')
    .update(PASSWORD_PEPPER)
    .update(Buffer.from(':', 'utf8'))
    .update(Buffer.from(String(password), 'utf8'))
    .digest('base64');
}

export function hashPassword(password) {
  return HASH_PREFIX + bcrypt.hashSync(pepperedDigest(password), 12);
}

export function verifyPassword(password, hash) {
  if (!hash) return false;
  try {
    if (String(hash).startsWith(HASH_PREFIX)) {
      return bcrypt.compareSync(pepperedDigest(password), String(hash).slice(HASH_PREFIX.length));
    }
    /* 兼容早期版本的明文 bcrypt 哈希，登录成功后会被自动升级 */
    return bcrypt.compareSync(String(password), String(hash));
  } catch {
    return false;
  }
}

export function needsRehash(hash) {
  return !String(hash || '').startsWith(HASH_PREFIX);
}

export function upgradePasswordHash(userId, password) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
}

function parseHobbies(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.map((item) => String(item)).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function activeBanOf(userId) {
  const row = db
    .prepare(
      `SELECT reason, until FROM bans
       WHERE user_id = ? AND lifted_at IS NULL AND (until IS NULL OR until > ?)
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, nowIso());
  return row ? { reason: row.reason, until: row.until } : null;
}

function unreadNotificationsOf(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(userId).c;
}

/** 对外输出的用户视图：不含 password_hash 等任何敏感列 */
export function publicUser(user) {
  return {
    id: user.id,
    /* 用户编号：注册即分配，对外可见的账号标识 */
    uid: user.uid ?? null,
    username: user.username,
    anonName: user.anon_name,
    /* 用户自定义昵称；为空表示仍使用系统分配的匿名身份 */
    nickname: user.nickname || '',
    anonColor: user.anon_color,
    avatarUrl: user.avatar_url || '',
    avatarPending: user.avatar_pending || '',
    avatarStatus: user.avatar_status || 'none',
    isGuest: String(user.username || '').startsWith('guest_'),
    role: user.role || 'user',
    /* 超级管理员标记：前端据此决定是否展示站点级开关 */
    isSuperAdmin: user.role === SUPER_ROLE,
    status: user.status || 'active',
    violationCount: user.violation_count ?? 0,
    bio: user.bio || '',
    intro: user.intro || '',
    gender: user.gender || 'secret',
    age: user.age ?? null,
    birthday: user.birthday ?? null,
    occupation: user.occupation || '',
    location: user.location || '',
    hobbies: parseHobbies(user.hobbies),
    /* 邮箱 / 手机号 / 实名：只回给本人（该视图仅用于当前登录用户），证件号解密后可编辑 */
    email: user.email || '',
    phone: user.phone || '',
    realName: user.real_name ? decryptField(user.real_name) : '',
    idNumber: user.id_number ? decryptField(user.id_number) : '',
    verified: {
      email: Boolean(user.email_verified),
      phone: Boolean(user.phone_verified),
      realName: Boolean(user.real_verified),
    },
    createdAt: user.created_at,
    unreadNotifications: unreadNotificationsOf(user.id),
    ban: activeBanOf(user.id),
  };
}

/* ------------------------------------------------------------- Cookie 处理 */

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function isHttpsRequest(req) {
  if (!req) return false;
  if (req.secure) return true;
  return String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

/**
 * 登录态只放进 httpOnly Cookie（Path 限定 /api），脚本读不到、页面请求也带不上，
 * 同时保留 Authorization 头以兼容非浏览器客户端。
 */
export function buildSessionCookie(value, { maxAgeSeconds, req }) {
  /* Strict：跨站发起的请求根本带不上登录态，配合加密通道签名形成双重 CSRF 防线。
     站内 XHR 属于同站请求，不受影响。 */
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, 'Path=/api', 'HttpOnly', 'SameSite=Strict'];
  if (Number.isFinite(maxAgeSeconds)) parts.push(`Max-Age=${Math.max(0, Math.round(maxAgeSeconds))}`);
  if (isHttpsRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(req) {
  return buildSessionCookie('', { maxAgeSeconds: 0, req });
}

export function attachSessionCookie(res, req, token, ttlSeconds) {
  res.setHeader('Set-Cookie', buildSessionCookie(token, { maxAgeSeconds: ttlSeconds, req }));
}

/* --------------------------------------------------------------- 令牌与会话 */

export function signToken(user, sid, ttlMinutes) {
  return jwt.sign({ sub: String(user.id), sid }, JWT_SECRET, {
    expiresIn: `${ttlMinutes}m`,
    issuer: 'xsz',
    audience: 'xsz-web',
  });
}

/** 创建一条服务端会话记录：令牌短时效、可吊销、与设备绑定 */
export function createServerSession({ user, req = null, token }) {
  const policy = getSecurityPolicy();
  const ttlMs = policy.sessionTtlMinutes * 60 * 1000;
  const now = Date.now();
  const sid = randomId(12);
  const finalToken = token || signToken({ id: user.id }, sid, policy.sessionTtlMinutes);
  db.prepare(
    `INSERT INTO sessions (sid, user_id, token_hash, ip, user_agent, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sid,
    user.id,
    tokenHash(finalToken),
    String(req?.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64),
    String(req?.headers?.['user-agent'] || '').slice(0, 300),
    new Date(now).toISOString(),
    new Date(now + ttlMs).toISOString(),
    new Date(now).toISOString()
  );
  return { token: finalToken, sid, ttlSeconds: Math.round(ttlMs / 1000) };
}

export function revokeSession(sid) {
  if (!sid) return;
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE sid = ? AND revoked_at IS NULL').run(nowIso(), sid);
}

export function revokeUserSessions(userId, { exceptSid = null } = {}) {
  if (exceptSid) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND sid <> ? AND revoked_at IS NULL').run(
      nowIso(),
      userId,
      exceptSid
    );
    return;
  }
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), userId);
}

function extendSession(sid, ttlMinutes) {
  const now = Date.now();
  db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE sid = ?').run(
    new Date(now + ttlMinutes * 60 * 1000).toISOString(),
    new Date(now).toISOString(),
    sid
  );
}

/**
 * 校验令牌：签名 → 会话未被吊销 → 会话未过期 → 用户存在且未被封禁。
 * 令牌与会话记录双向绑定，复制令牌到别处、或登出后重用都会失败。
 */
export function resolveToken(token, req = null) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(String(token), JWT_SECRET, { issuer: 'xsz', audience: 'xsz-web' });
  } catch {
    return null;
  }
  const sid = String(payload.sid || '');
  if (!sid) return null;

  const session = db.prepare('SELECT * FROM sessions WHERE sid = ?').get(sid);
  if (!session || session.revoked_at) return null;
  const now = Date.now();
  if (new Date(session.expires_at).getTime() <= now) return null;
  if (session.token_hash && !safeEqual(session.token_hash, tokenHash(token))) return null;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(payload.sub));
  if (!user || user.status === 'banned') {
    revokeSession(sid);
    return null;
  }

  /* 滑动续期：令牌与会话同时向前推，最多每分钟写一次库 */
  const policy = getSecurityPolicy();
  const lastSeen = new Date(session.last_seen_at).getTime();
  if (now - lastSeen > 60 * 1000) extendSession(sid, policy.sessionTtlMinutes);

  return { user: publicUser(user), sid };
}

export function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
}

export function requireAuth(req, res, next) {
  const resolved = resolveToken(bearerToken(req), req);
  if (!resolved) return res.status(401).json({ error: '需要登录' });
  req.user = resolved.user;
  req.sessionId = resolved.sid;
  return next();
}

export function attachUser(req, _res, next) {
  const resolved = resolveToken(bearerToken(req), req);
  if (resolved) {
    req.user = resolved.user;
    req.sessionId = resolved.sid;
  }
  next();
}

/** 当前生效的封禁记录（无则 null） */
export function activeBan(userId) {
  return activeBanOf(userId);
}

/**
 * 写入权限闸门：登录 + 非访客 + 未被封禁。
 *
 * 访客账号**只读**：不能发言，也不能修改资料 / 账号 / 上传任何东西。
 * 这条规则写死在服务端，不提供开关——「访客只能看」是一个产品承诺，
 * 不应该存在某个配置把它悄悄打开。
 */
export function requireRegistered(req, res, next) {
  const resolved = resolveToken(bearerToken(req), req);
  if (!resolved) return res.status(401).json({ error: '需要登录' });

  const user = resolved.user;
  if (user.isGuest) {
    return res.status(403).json({ error: '访客账号仅可浏览，注册后即可使用该功能' });
  }
  if (user.status === 'banned' || activeBanOf(user.id)) {
    return res.status(403).json({ error: '账号已被封禁，暂时无法进行该操作' });
  }

  req.user = user;
  req.sessionId = resolved.sid;
  return next();
}

/** 内容互动（发布 / 留言 / 弹幕 / 点赞 / 举报）与资料写入使用同一道闸门 */
export const requireSpeaking = requireRegistered;

export function requireStaff(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '需要登录' });
  if (!STAFF_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: '需要审核员或管理员权限' });
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '需要登录' });
  if (!ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: '需要管理员权限' });
  return next();
}

/**
 * 站点级开关（身份验证、内容策略、角色分配、人工核验）只有超级管理员能操作。
 * 普通管理员即便拿到了合法会话，也改不了这些会影响全站的配置。
 */
export function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '需要登录' });
  if (req.user.role !== SUPER_ROLE) return res.status(403).json({ error: '该操作仅限超级管理员' });
  return next();
}

/* ------------------------------------------------------------- 管理员自举 */

/**
 * 确保站点始终存在超级管理员账号（用户名/密码由服务端常量或环境变量决定，
 * 绝不出现在前端产物中）。首次启动会创建，历史遗留的弱口令管理员会被迁移。
 *
 * 超级管理员不可通过任何接口授予，只能由这里自举：默认 huazhiyou，
 * 可用 XSZ_ADMIN_USER / XSZ_ADMIN_PASS 覆盖。
 * @returns {{ action: string, username: string }}
 */
export function ensureAdminAccount() {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(ADMIN_USERNAME);
  if (existing) {
    /* 每次启动都把该账号钉在超级管理员上，防止被误降权后无人能改站点开关 */
    db.prepare(`UPDATE users SET role = ?, status = 'active' WHERE id = ?`).run(SUPER_ROLE, existing.id);
    /* 仅当仍是弱口令或运维显式要求重置时才改写密码 */
    const weak = verifyPassword('admin123', existing.password_hash) || verifyPassword(ADMIN_USERNAME, existing.password_hash);
    const force = String(process.env.XSZ_ADMIN_RESET || '').trim() === '1';
    if (weak || force) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(ADMIN_PASSWORD), existing.id);
      revokeUserSessions(existing.id);
      return { action: force ? 'reset' : 'hardened', username: ADMIN_USERNAME };
    }
    return { action: existing.role === SUPER_ROLE ? 'exists' : 'promoted', username: ADMIN_USERNAME };
  }

  const legacy = db
    .prepare(`SELECT * FROM users WHERE role IN ('admin', ?) AND username IN ('admin','administrator','root') LIMIT 1`)
    .get(SUPER_ROLE);
  if (legacy) {
    const identity = anonIdentity(ADMIN_USERNAME);
    db.prepare(
      'UPDATE users SET username = ?, anon_name = ?, anon_color = ?, password_hash = ?, role = ?, status = ? WHERE id = ?'
    ).run(
      ADMIN_USERNAME,
      identity.name,
      identity.color,
      hashPassword(ADMIN_PASSWORD),
      SUPER_ROLE,
      'active',
      legacy.id
    );
    revokeUserSessions(legacy.id);
    return { action: 'migrated', username: ADMIN_USERNAME, from: legacy.username };
  }

  const identity = anonIdentity(ADMIN_USERNAME);
  db.prepare(
    `INSERT INTO users (uid, username, password_hash, anon_name, anon_color, role, bio, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '这里是值班室，有问题随时说。', 'active', ?)`
  ).run(allocateUid(), ADMIN_USERNAME, hashPassword(ADMIN_PASSWORD), identity.name, identity.color, SUPER_ROLE, nowIso());
  return { action: 'created', username: ADMIN_USERNAME };
}
