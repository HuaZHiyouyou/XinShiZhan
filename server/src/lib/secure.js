import { db, nowIso } from '../db.js';
import { getSecurityPolicy } from './site.js';
import * as channel from './secureChannel.js';
import { HttpError } from './secureChannel.js';

/**
 * 认证安全防护层：限流、锁定、留痕、加密通道闸门与安全响应头。
 *
 * 原则：所有判定都在服务端完成，前端只负责渲染结论。
 * 前端即使被改写、被跳过、被直接调接口，也无法绕开这里的任何一道闸门。
 */

export const ENC_HEADER = 'x-xsz-enc';
export const SID_HEADER = 'x-xsz-sid';

/** 只有显式声明部署在反向代理之后，才相信 X-Forwarded-For，否则以真实套接字地址为准，
 *  避免攻击者伪造 XFF 头来绕过按 IP 的限流与锁定。 */
const TRUST_PROXY = String(process.env.XSZ_TRUST_PROXY || '').trim().toLowerCase();
const TRUST_PROXY_ENABLED = TRUST_PROXY === '1' || TRUST_PROXY === 'true' || TRUST_PROXY === 'yes';

export function clientIp(req) {
  if (TRUST_PROXY_ENABLED) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded.slice(0, 64);
  }
  const socketIp = req.socket?.remoteAddress || req.ip || '';
  return String(socketIp).replace(/^::ffff:/, '').slice(0, 64);
}

export function userAgentOf(req) {
  return String(req.headers['user-agent'] || '').slice(0, 300);
}

/* ------------------------------------------------------------------ 事件留痕 */

export function logAuthEvent({ req = null, ip = '', username = '', kind, detail = {} }) {
  const address = ip || (req ? clientIp(req) : '');
  const safeDetail = JSON.stringify(detail || {}).slice(0, 900);
  db.prepare(
    'INSERT INTO auth_events (ip, username, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(address, String(username || '').slice(0, 40), String(kind), safeDetail, nowIso());
}

export function countAuthEvents({ ip = null, username = null, kinds, sinceIso }) {
  const where = ['created_at >= ?'];
  const params = [sinceIso];
  if (kinds?.length) {
    where.push(`kind IN (${kinds.map(() => '?').join(',')})`);
    params.push(...kinds);
  }
  if (ip) {
    where.push('ip = ?');
    params.push(ip);
  }
  if (username) {
    where.push('username = ?');
    params.push(username);
  }
  return db
    .prepare(`SELECT COUNT(*) AS c FROM auth_events WHERE ${where.join(' AND ')}`)
    .get(...params).c;
}

export function recentAuthEvents(limit = 80) {
  return db
    .prepare('SELECT id, ip, username, kind, detail, created_at FROM auth_events ORDER BY id DESC LIMIT ?')
    .all(Math.max(1, Math.min(300, Number(limit) || 80)))
    .map((row) => ({
      id: row.id,
      ip: row.ip,
      username: row.username,
      kind: row.kind,
      detail: safeParse(row.detail),
      createdAt: row.created_at,
    }));
}

function safeParse(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------- 锁定 */

export function activeLock(scope, key) {
  if (!key) return null;
  const row = db
    .prepare(
      `SELECT id, scope, key, reason, attempts, until, created_at FROM auth_locks
       WHERE scope = ? AND key = ? AND lifted_at IS NULL AND until > ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(scope, String(key), nowIso());
  return row || null;
}

export function listActiveLocks(limit = 50) {
  return db
    .prepare(
      `SELECT id, scope, key, reason, attempts, until, created_at FROM auth_locks
       WHERE lifted_at IS NULL AND until > ? ORDER BY until DESC LIMIT ?`
    )
    .all(nowIso(), Math.max(1, Math.min(200, Number(limit) || 50)))
    .map((row) => ({
      id: row.id,
      scope: row.scope,
      key: row.key,
      reason: row.reason,
      attempts: row.attempts,
      until: row.until,
      createdAt: row.created_at,
    }));
}

function lockCount(scope, key) {
  return db
    .prepare('SELECT COUNT(*) AS c FROM auth_locks WHERE scope = ? AND key = ?')
    .get(scope, String(key)).c;
}

function createLock(scope, key, reason, attempts) {
  const policy = getSecurityPolicy();
  const escalate = Math.min(6, lockCount(scope, key));
  const minutes = Math.min(policy.lockMaxMinutes, policy.lockMinutes * 2 ** escalate);
  const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO auth_locks (scope, key, reason, attempts, until, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(scope, String(key), reason, attempts, until, nowIso());
  return { until, minutes };
}

export function releaseLock(id, actorId = null) {
  const row = db.prepare('SELECT * FROM auth_locks WHERE id = ?').get(Number(id));
  if (!row) return false;
  db.prepare('UPDATE auth_locks SET lifted_at = ?, lifted_by = ? WHERE id = ?').run(nowIso(), actorId, row.id);
  return true;
}

export function releaseLocksByScope(scope, key, actorId = null) {
  db.prepare('UPDATE auth_locks SET lifted_at = ?, lifted_by = ? WHERE scope = ? AND key = ? AND lifted_at IS NULL').run(
    nowIso(),
    actorId,
    scope,
    String(key)
  );
}

function secondsUntil(iso) {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
}

/** 进入认证流程前的闸门：命中锁定直接拒绝，并告知还要等多久 */
export function assertNotLocked(req, username = '') {
  const ip = clientIp(req);
  const ipLock = activeLock('ip', ip);
  if (ipLock) {
    const error = new HttpError(423, '当前网络环境触发安全保护，请稍后再试');
    error.retryAfter = secondsUntil(ipLock.until);
    error.scope = 'ip';
    throw error;
  }
  if (username) {
    const userLock = activeLock('user', username);
    if (userLock) {
      const error = new HttpError(423, '该账号尝试次数过多，已临时锁定');
      error.retryAfter = secondsUntil(userLock.until);
      error.scope = 'user';
      throw error;
    }
  }
}

const FAIL_KINDS = ['login.fail', 'register.fail', 'guest.fail', 'pow.fail', 'envelope.fail', 'honeypot'];

/**
 * 记录一次失败，并在超过阈值时升级为锁定。
 * 返回本次失败后客户端还需要等待的秒数（0 表示未锁定）。
 */
export function registerFailure(req, { username = '', kind = 'login.fail', reason = '', detail = {} }) {
  const policy = getSecurityPolicy();
  const ip = clientIp(req);
  logAuthEvent({ req, username, kind, detail: { reason, ...detail } });

  const since = new Date(Date.now() - policy.loginWindowMinutes * 60 * 1000).toISOString();
  let retryAfter = 0;
  let scope = '';

  if (username) {
    const userFails = countAuthEvents({ username, kinds: FAIL_KINDS, sinceIso: since });
    if (userFails >= policy.loginMaxFailPerUser) {
      const lock = createLock('user', username, reason || '连续认证失败', userFails);
      retryAfter = secondsUntil(lock.until);
      scope = 'user';
    }
  }

  if (!scope) {
    const ipFails = countAuthEvents({ ip, kinds: FAIL_KINDS, sinceIso: since });
    if (ipFails >= policy.loginMaxPerIp) {
      const lock = createLock('ip', ip, reason || '同一来源认证失败过多', ipFails);
      retryAfter = secondsUntil(lock.until);
      scope = 'ip';
    }
  }

  return { retryAfter, scope };
}

/** 成功登录后清掉该用户与来源 IP 的历史锁定，避免误伤 */
export function clearFailures(req, username) {
  const ip = clientIp(req);
  releaseLocksByScope('user', username);
  const ipLock = activeLock('ip', ip);
  if (ipLock && ipLock.reason !== 'manual') releaseLock(ipLock.id);
}

/**
 * 根据失败次数动态提升工作量证明难度：越像机器，代价越高。
 *
 * 斜率刻意保持平缓（每 4 次失败 +1 比特，最多 +4）：
 * 正常用户偶尔输错一两次密码几乎感知不到，
 * 而已经触发锁定的攻击者本来就会被 assertNotLocked 直接挡在门外。
 */
export function powDifficultyFor(req, username = '') {
  const policy = getSecurityPolicy();
  if (!policy.powEnabled) return 0;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const fails = Math.max(
    username ? countAuthEvents({ username, kinds: FAIL_KINDS, sinceIso: since }) : 0,
    countAuthEvents({ ip: clientIp(req), kinds: FAIL_KINDS, sinceIso: since })
  );
  const step = Math.min(4, Math.floor(fails / 4));
  return Math.min(policy.powMaxBits, policy.powBaseBits + step);
}

export function verifyPow(req, { cid, solution, username = '' }) {
  const policy = getSecurityPolicy();
  if (!policy.powEnabled) return true;
  if (!cid || !solution) {
    registerFailure(req, { username, kind: 'pow.fail', reason: '缺少安全校验凭据' });
    throw new HttpError(428, '缺少安全校验，请刷新页面后重试');
  }
  const ok = channel.consumeChallenge({ cid, solution, ip: clientIp(req) });
  if (!ok) {
    registerFailure(req, { username, kind: 'pow.fail', reason: '安全校验未通过' });
    throw new HttpError(428, '安全校验未通过，请重新尝试');
  }
  return true;
}

/* -------------------------------------------------------------------- 限流 */

const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60 * 1000).unref?.();

/**
 * 内存滑动窗口限流：窗口内计数超限即拒绝。
 * 用于握手、挑战、登录等高频被脚本攻击的接口，以及全站 API 的粗粒度保护。
 */
export function rateLimit({ name, windowMs, max, status = 429, message = '请求过于频繁，请稍后再试', keyFn }) {
  return (req, res, next) => {
    const key = `${name}:${keyFn ? keyFn(req) : clientIp(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      logAuthEvent({ req, kind: 'rate.limit', detail: { name, retryAfter } });
      return res.status(status).json({ error: message, retryAfter });
    }
    if (bucket.count > max * 0.8) res.set('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    return next();
  };
}

/** 全站 API 粗粒度限流，阈值由管理员在后台调整 */
export function apiRateLimit() {
  const policy = getSecurityPolicy();
  return rateLimit({
    name: 'api',
    windowMs: policy.apiWindowMinutes * 60 * 1000,
    max: policy.apiMaxPerIp,
    message: '访问过于频繁，请稍后再试',
  });
}

/* -------------------------------------------------------------- 加密通道闸门 */

/**
 * 加密通道中间件：
 * - 请求带 X-Xsz-Enc/X-Xsz-Sid 时，验签 + 解密后把明文交给业务；
 * - 策略要求强制加密却未加密时直接拒绝（428），杜绝绕过前端直接打接口；
 * - 业务响应自动用同一会话密钥加密回传。
 */
export function secureChannel({ required = true } = {}) {
  return (req, res, next) => {
    const policy = getSecurityPolicy();
    const flagged = String(req.headers[ENC_HEADER] || '') === '1';
    const sid = String(req.headers[SID_HEADER] || '');

    if (flagged && sid) {
      try {
        const pathname = new URL(req.originalUrl, 'http://internal.local').pathname;
        const hasBody = req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0;
        const opened = hasBody
          ? channel.openEnvelope(req.body, { sid, method: req.method, pathname, ip: clientIp(req) })
          : channel.openHeaderRequest(req.headers, { sid, method: req.method, pathname, ip: clientIp(req) });
        req.secureSession = opened.session;
        req.secureMeta = { nonce: opened.nonce, ts: opened.ts };
        if (opened.payload) req.body = opened.payload;
      } catch (error) {
        const status = error.status || 400;
        if (status >= 400) {
          logAuthEvent({ req, kind: 'envelope.fail', detail: { status, path: req.path } });
        }
        return res.status(status).json({ error: error.message || '安全校验失败，请刷新页面后重试' });
      }
    } else if (required && policy.enforceEncryptedChannel) {
      logAuthEvent({ req, kind: 'channel.missing', detail: { path: req.path } });
      return res.status(428).json({ error: '该接口要求加密通道，请刷新页面后重试' });
    }

    if (req.secureSession) {
      const session = req.secureSession;
      const original = res.json.bind(res);
      res.json = (payload) => {
        try {
          res.set(ENC_HEADER, '1');
          return original(channel.sealResponse(session, payload ?? null));
        } catch {
          return original({ error: '响应加密失败，请重试' });
        }
      };
    }

    return next();
  };
}

/* ---------------------------------------------------------------- 安全响应头 */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
].join('; ');

/** 屏蔽任何可能泄露源码与密钥的路径：源码目录、环境文件、sourcemap、数据库 */
const BLOCKED_PATH_RE =
  /^\/(server|src|node_modules|data|scripts|\.git|\.env|\.vscode)(\/|$)|\.(map|env|db|db-wal|db-shm|sqlite|key|pem|ts|tsx|jsx|mjs|sql)$/i;

export function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': CSP,
  });

  if (req.path.startsWith('/api')) {
    /* 认证与后台数据一律不缓存，避免共享设备上残留 */
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
  } else {
    res.set('Cache-Control', 'no-cache');
  }

  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (req.secure || proto === 'https') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (BLOCKED_PATH_RE.test(req.path)) {
    logAuthEvent({ req, kind: 'source.probe', detail: { path: req.path } });
    return res.status(404).json({ error: '资源不存在' });
  }

  return next();
}
