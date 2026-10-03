import { Router } from 'express';
import { allocateUid, db, nowIso } from '../db.js';
import {
  attachSessionCookie,
  clearSessionCookie,
  createServerSession,
  hashPassword,
  needsRehash,
  publicUser,
  requireAuth,
  requireRegistered,
  revokeSession,
  revokeUserSessions,
  upgradePasswordHash,
  verifyPassword,
} from '../lib/auth.js';
import { autoReview, logAudit, notify } from '../lib/moderation.js';
import { anonIdentity } from '../lib/anon.js';
import {
  EMAIL_RE,
  ID_NUMBER_RE,
  PHONE_RE,
  REAL_NAME_RE,
  encryptField,
  isReservedUsername,
  randomId,
} from '../lib/secrets.js';
import {
  HttpError,
  createSession,
  issueChallenge,
  openSecretField,
} from '../lib/secureChannel.js';
import {
  assertNotLocked,
  clearFailures,
  clientIp,
  logAuthEvent,
  powDifficultyFor,
  rateLimit,
  registerFailure,
  secureChannel,
  userAgentOf,
  verifyPow,
} from '../lib/secure.js';
import {
  getSecurityPolicy,
  getSiteConfig,
  getVerification,
  publicSiteConfig,
  recoveryChannelState,
} from '../lib/site.js';

export const authRouter = Router();

/* 用于「用户不存在」时也执行一次等价开销的比较，避免通过响应时差枚举用户名 */
const DUMMY_HASH = hashPassword(randomId(18));

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$/;

function fail(res, error, fallback = '请求处理失败') {
  const status = Number(error?.status) || 500;
  const payload = { error: error?.message || fallback };
  if (error?.retryAfter) payload.retryAfter = error.retryAfter;
  if (status >= 500) console.error('[auth]', error);
  return res.status(status).json(payload);
}

function normalizeUsername(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/** 解出信封内二次加密的密码字段：任何中间层都看不到明文 */
function readSecret(req, value) {
  if (!req.secureSession || !req.secureMeta?.nonce) return String(value ?? '');
  return openSecretField(req.secureSession, req.secureMeta.nonce, value);
}

/* --------------------------------------------------- 预留能力的开关闸门 */

/**
 * 邮箱 / 手机号 / 实名属于「已预留但未实装」的能力：
 * 站点开关关闭时一律拒绝，只有超级管理员开启后才允许填写与后续验证。
 */
function requireVerificationFeature(enabled, label) {
  if (!enabled) throw new HttpError(403, `${label}功能尚未开放，请联系管理员开启`);
}

/* ------------------------------------------------------- 昵称 / 资料校验 */

const NICKNAME_RE = /^[A-Za-z0-9_\-\u4e00-\u9fa5 ]{2,16}$/;

/** 昵称：可为空（表示沿用系统分配的匿名身份），非空时校验字符与长度 */
function normalizeNickname(value) {
  const nickname = cleanText(value, 16);
  if (!nickname) return '';
  if (!NICKNAME_RE.test(nickname)) {
    throw new HttpError(400, '昵称需为 2-16 位中英文、数字、下划线或空格');
  }
  return nickname;
}

/** 邮箱：空表示清除；开启开关后校验格式与占用 */
function resolveEmail(value, current, selfId) {
  const email = cleanText(value, 190);
  if (!email) return '';
  if (!EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确');
  const taken = db
    .prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ?')
    .get(email, selfId);
  if (taken) throw new HttpError(409, '该邮箱已被其他账号使用');
  return email === current ? current : email;
}

/** 手机号：中国大陆手机号格式 */
function resolvePhone(value, current, selfId) {
  const phone = cleanText(value, 20).replace(/[\s-]/g, '');
  if (!phone) return '';
  if (!PHONE_RE.test(phone)) throw new HttpError(400, '手机号格式不正确');
  const taken = db
    .prepare('SELECT id FROM users WHERE phone = ? AND id <> ?')
    .get(phone, selfId);
  if (taken) throw new HttpError(409, '该手机号已被其他账号使用');
  return phone === current ? current : phone;
}

/** 蜜罐字段：真人不会填，脚本会顺手填掉 */
function rejectHoneypot(req, body, username = '') {
  if (String(body?.hp ?? '').length === 0) return;
  registerFailure(req, { username, kind: 'honeypot', reason: '蜜罐字段被填写' });
  throw new HttpError(400, '请求不合法，请刷新页面后重试');
}

/* --------------------------------------------------------------- 限流闸门 */

/**
 * 认证类接口的限流阈值全部跟随站点安全策略（后台可调，统一 10 分钟窗口）。
 * 每次请求现取策略，改完设置立即生效，不必重启服务；
 * 阈值可调也是为了应对共享出口 IP：整层楼的人同时注册不该被写死的数字挡住。
 */
function policyRateLimit({ name, maxKey, windowMinutes, message, floor }) {
  return (req, res, next) => {
    const policy = getSecurityPolicy();
    const max = Math.max(floor, Number(policy[maxKey]) || floor);
    return rateLimit({ name, windowMs: windowMinutes * 60_000, max, message })(req, res, next);
  };
}

const handshakeLimit = policyRateLimit({
  name: 'handshake',
  maxKey: 'handshakeMaxPerIp',
  windowMinutes: 10,
  floor: 5,
  message: '握手过于频繁，请稍后再试',
});

const challengeLimit = policyRateLimit({
  name: 'challenge',
  maxKey: 'challengeMaxPerIp',
  windowMinutes: 10,
  floor: 10,
  message: '安全校验请求过于频繁',
});

const registerLimit = policyRateLimit({
  name: 'register',
  maxKey: 'registerMaxPerIp',
  windowMinutes: 10,
  floor: 3,
  message: '注册过于频繁，请稍后再试',
});

const recoverLimit = policyRateLimit({
  name: 'recover',
  maxKey: 'recoverMaxPerIp',
  windowMinutes: 10,
  floor: 3,
  message: '找回申请过于频繁，请稍后再试',
});

/* ------------------------------------------------------- 公开的最小站点配置 */

authRouter.get('/config', (_req, res) => {
  res.json({ config: publicSiteConfig() });
});

/* ------------------------------------------------------------------- 握手 */

/**
 * ECDH 握手：交换一次性公钥，协商出只属于本次会话的加密/签名密钥。
 * 服务端私钥用完即弃，公钥与别名种子本身不构成秘密，前端也不含任何静态密钥。
 */
authRouter.post(
  '/handshake',
  handshakeLimit,
  (req, res) => {
    try {
      const body = req.body || {};
      if (Number(body.v) !== 1) throw new HttpError(400, '协议版本不受支持');
      const { session, payload } = createSession({
        clientPublic: body.cp,
        ip: clientIp(req),
        fingerprint: body.fp,
      });
      const policy = getSecurityPolicy();
      const pow = policy.powEnabled
        ? issueChallenge({ ip: clientIp(req), bits: powDifficultyFor(req) })
        : null;
      if (pow) payload.pow = pow;
      payload.hb = session.expiresAt;
      logAuthEvent({ req, kind: 'handshake', detail: { sid: session.sid } });
      res.json(payload);
    } catch (error) {
      fail(res, error, '握手失败');
    }
  }
);

/* ------------------------------------------------------- 工作量证明挑战签发 */

authRouter.post(
  '/challenge',
  challengeLimit,
  (req, res) => {
    try {
      const policy = getSecurityPolicy();
      if (!policy.powEnabled) return res.json({ cid: '', prefix: '', bits: 0, ttl: 0, disabled: true });
      const username = normalizeUsername(req.body?.username).slice(0, 20);
      const challenge = issueChallenge({ ip: clientIp(req), bits: powDifficultyFor(req, username) });
      return res.json(challenge);
    } catch (error) {
      return fail(res, error, '安全校验签发失败');
    }
  }
);

/* ------------------------------------------------------------------- 登录 */

/**
 * 登录限流阈值跟随站点安全策略：窗口取 loginWindowMinutes，
 * 次数取 loginMaxPerIp 的 3 倍并保底 20 次，既能挡住暴力尝试，也不会误伤正常用户。
 */
function loginRateLimit(req, res, next) {
  const policy = getSecurityPolicy();
  return rateLimit({
    name: 'login',
    windowMs: Math.max(60_000, policy.loginWindowMinutes * 60_000),
    max: Math.max(20, policy.loginMaxPerIp * 3),
    message: '登录尝试过于频繁，请稍后再试',
  })(req, res, next);
}

authRouter.post(
  '/login',
  loginRateLimit,
  secureChannel({ required: true }),
  async (req, res) => {
    const username = normalizeUsername(req.body?.username).slice(0, 20);
    try {
      rejectHoneypot(req, req.body, username);
      assertNotLocked(req, username);
      verifyPow(req, { cid: req.body?.cid, solution: req.body?.pow, username });

      const password = readSecret(req, req.body?.password);
      if (!username || !password) throw new HttpError(400, '请输入用户名与密码');

      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      const ok = verifyPassword(password, row?.password_hash || DUMMY_HASH);

      if (!row || !ok) {
        const { retryAfter, scope } = registerFailure(req, {
          username,
          kind: 'login.fail',
          reason: '用户名或密码不正确',
          detail: { ua: userAgentOf(req) },
        });
        const payload = { error: '用户名或密码不正确' };
        if (retryAfter) {
          payload.retryAfter = retryAfter;
          payload.locked = true;
          payload.lockScope = scope;
        }
        return res.status(401).json(payload);
      }

      if (row.status === 'banned') {
        logAuthEvent({ req, username, kind: 'login.banned', detail: {} });
        return res.status(403).json({ error: '账号已被封禁' });
      }

      /* 旧版哈希在首次成功登录时静默升级为 pepper 方案 */
      if (needsRehash(row.password_hash)) upgradePasswordHash(row.id, password);

      db.prepare('UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?').run(
        nowIso(),
        clientIp(req),
        row.id
      );
      const user = publicUser({ ...row, last_login_at: nowIso() });
      const created = createServerSession({ user, req });
      attachSessionCookie(res, req, created.token, created.ttlSeconds);
      if (req.secureSession) req.secureSession.userId = user.id;
      clearFailures(req, username);
      logAuthEvent({ req, username, kind: 'login.ok', detail: { uid: user.id } });
      return res.json({ token: created.token, user, expiresIn: created.ttlSeconds });
    } catch (error) {
      return fail(res, error, '登录失败');
    }
  }
);

/* ------------------------------------------------------------------- 注册 */

authRouter.post(
  '/register',
  registerLimit,
  secureChannel({ required: true }),
  async (req, res) => {
    const username = normalizeUsername(req.body?.username).slice(0, 20);
    try {
      const cfg = getSiteConfig();
      const policy = getSecurityPolicy();
      if (!cfg.allowRegister) throw new HttpError(403, '当前站点已关闭注册');

      rejectHoneypot(req, req.body, username);
      assertNotLocked(req, username);
      verifyPow(req, { cid: req.body?.cid, solution: req.body?.pow, username });

      const password = readSecret(req, req.body?.password);
      const confirm = readSecret(req, req.body?.confirm);

      if (!USERNAME_RE.test(username)) throw new HttpError(400, '用户名需为 2-20 位中英文、数字或下划线');
      if (isReservedUsername(username)) {
        registerFailure(req, { username, kind: 'register.fail', reason: '保留用户名' });
        throw new HttpError(400, '该用户名不可用，请换一个');
      }
      /*
       * 只拦「底线」：长度不足或长得离谱。
       * 是否包含用户名、是否属于常见口令，一律交给前端做强度提示，不做硬拦截：
       * 真实的兜底是服务端的失败限流、临时锁定与登录告警，而不是把用户挡在门外。
       */
      if (String(password || '').length < policy.minPasswordLength) {
        throw new HttpError(400, `密码至少 ${policy.minPasswordLength} 位`);
      }
      if (String(password).length > 128) throw new HttpError(400, '密码过长（最多 128 位）');
      if (String(confirm || '') !== String(password || '')) throw new HttpError(400, '两次输入的密码不一致');

      const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (exists) {
        registerFailure(req, { username, kind: 'register.fail', reason: '用户名已存在' });
        throw new HttpError(409, '用户名已存在');
      }

      /* 昵称、邮箱、手机号均为可选注册项；邮箱与手机号受站点开关控制 */
      const verification = getVerification();
      const nickname = normalizeNickname(req.body?.nickname);
      if (nickname) {
        const review = autoReview({ kind: 'profile', content: nickname, userId: null, user: null });
        if (review.status === 'rejected') throw new HttpError(400, `昵称包含不允许的内容：${review.flags.join('、')}`);
      }

      let email = '';
      let phone = '';
      if (req.body?.email !== undefined) {
        requireVerificationFeature(verification.emailEnabled, '邮箱');
        email = resolveEmail(req.body.email, '', 0);
      }
      if (verification.emailEnabled && verification.emailRequired && !email) {
        throw new HttpError(400, '本站在注册时要求填写邮箱');
      }
      if (req.body?.phone !== undefined) {
        requireVerificationFeature(verification.phoneEnabled, '手机号');
        phone = resolvePhone(req.body.phone, '', 0);
      }
      if (verification.phoneEnabled && verification.phoneRequired && !phone) {
        throw new HttpError(400, '本站在注册时要求填写手机号');
      }

      /* 实名信息与邮箱/手机号一样是预留能力：开关没开时注册页不会出现，出现即代表已开启 */
      let realName = '';
      let idNumber = '';
      if (req.body?.realName !== undefined || req.body?.idNumber !== undefined) {
        requireVerificationFeature(verification.realNameEnabled, '实名认证');
        realName = cleanText(req.body?.realName ?? '', 40);
        idNumber = String(req.body?.idNumber ?? '').trim().replace(/\s+/g, '').slice(0, 32);
        if (realName && !REAL_NAME_RE.test(realName)) throw new HttpError(400, '姓名格式不正确，请填写真实姓名');
        if (idNumber && !ID_NUMBER_RE.test(idNumber)) throw new HttpError(400, '证件号码格式不正确');
      }
      if (verification.realNameEnabled && verification.realNameRequired && (!realName || !idNumber)) {
        throw new HttpError(400, '本站在注册时要求填写实名信息');
      }

      const identity = anonIdentity(username);
      const registerIp = clientIp(req);
      const createdAt = nowIso();
      const id = db
        .prepare(
          `INSERT INTO users (uid, username, password_hash, anon_name, anon_color, nickname, email, phone,
            real_name, id_number, role, bio, status, register_ip, last_login_ip, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', '', 'active', ?, ?, ?, ?)`
        )
        .run(
          allocateUid(),
          username,
          hashPassword(password),
          nickname || identity.name,
          identity.color,
          nickname,
          email,
          phone,
          realName ? encryptField(realName) : '',
          idNumber ? encryptField(idNumber) : '',
          registerIp,
          registerIp,
          createdAt,
          createdAt
        ).lastInsertRowid;

      const user = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
      const created = createServerSession({ user, req });
      attachSessionCookie(res, req, created.token, created.ttlSeconds);
      if (req.secureSession) req.secureSession.userId = user.id;
      clearFailures(req, username);
      logAuthEvent({ req, username, kind: 'register.ok', detail: { uid: user.uid } });
      logAudit({
        actor: null,
        action: 'user.register',
        targetType: 'user',
        targetId: user.id,
        detail: { username, uid: user.uid, nickname: nickname || null },
      });
      return res.json({ token: created.token, user, expiresIn: created.ttlSeconds });
    } catch (error) {
      return fail(res, error, '注册失败');
    }
  }
);

/* 常见弱口令清单已挪到前端做「强度建议」（web/src/lib/password.ts），
   服务端不再据此拒绝注册：该拦的是暴力尝试，而不是用户的选择。 */

/* --------------------------------------------------------------- 访客登录 */

authRouter.post(
  '/guest',
  rateLimit({ name: 'guest', windowMs: 10 * 60 * 1000, max: 20, message: '访客登录过于频繁，请稍后再试' }),
  secureChannel({ required: true }),
  async (req, res) => {
    try {
      const cfg = getSiteConfig();
      if (!cfg.allowGuestLogin) throw new HttpError(403, '当前站点未开放访客登录');

      rejectHoneypot(req, req.body, 'guest');
      assertNotLocked(req);
      verifyPow(req, { cid: req.body?.cid, solution: req.body?.pow, username: 'guest' });

      const ip = clientIp(req);
      const limit = Math.max(1, cfg.guestHourlyLimitPerIp || 5);
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recentCount = db
        .prepare('SELECT COUNT(*) AS c FROM guest_logins WHERE ip = ? AND created_at >= ?')
        .get(ip, since).c;
      if (recentCount >= limit) {
        const error = new HttpError(429, '本小时访客账号创建已达上限，请稍后再试或注册正式账号');
        error.retryAfter = 3600;
        throw error;
      }

      const username = `guest_${Date.now().toString(36)}${randomId(3).toLowerCase()}`;
      const identity = anonIdentity(username);
      const id = db
        .prepare(
          `INSERT INTO users (uid, username, password_hash, anon_name, anon_color, role, bio, status,
            register_ip, last_login_ip, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, 'user', '访客账号，仅可浏览', 'active', ?, ?, ?, ?)`
        )
        .run(
          allocateUid(),
          username,
          hashPassword(randomId(16)),
          identity.name,
          identity.color,
          ip,
          ip,
          nowIso(),
          nowIso()
        ).lastInsertRowid;

      db.prepare(
        'INSERT INTO guest_logins (user_id, username, anon_name, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, username, identity.name, ip, userAgentOf(req), nowIso());

      const user = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
      const created = createServerSession({ user, req });
      attachSessionCookie(res, req, created.token, created.ttlSeconds);
      if (req.secureSession) req.secureSession.userId = user.id;
      logAuthEvent({ req, username, kind: 'guest.ok', detail: { uid: id } });
      return res.json({ token: created.token, user, expiresIn: created.ttlSeconds });
    } catch (error) {
      return fail(res, error, '访客登录失败');
    }
  }
);

/* --------------------------------------------------------------- 找回密码 */

const RECOVERY_METHODS = new Set(['email', 'service', 'master', 'security']);

const RECOVERY_LABELS = {
  email: '邮箱找回',
  service: '站内客服',
  master: '站长求助',
  security: '密保找回',
};

/** 账号既可以用用户名，也可以用用户编号（UID）来定位 */
function findRecoveryAccount(account) {
  const columns = 'id, uid, username, anon_name, anon_color, avatar_url, status, email, phone';
  if (/^\d{4,12}$/.test(account)) {
    const byUid = db.prepare(`SELECT ${columns} FROM users WHERE uid = ?`).get(Number(account));
    if (byUid) return byUid;
  }
  return db.prepare(`SELECT ${columns} FROM users WHERE username = ?`).get(account) || null;
}

/** 申请一旦提交，立刻通知超级管理员、管理员与站内客服账号，确保「求助」真的有人看到 */
function notifyRecoveryStaff({ title, body, serviceAccount }) {
  const seen = new Set();
  db.prepare("SELECT id FROM users WHERE role IN ('superadmin','admin') AND status = 'active'")
    .all()
    .forEach((row) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      notify(row.id, 'recovery', title, body);
    });
  if (serviceAccount) {
    const svc = db.prepare('SELECT id FROM users WHERE username = ?').get(serviceAccount);
    if (svc && !seen.has(svc.id)) notify(svc.id, 'recovery', title, body);
  }
}

/** 各渠道的兜底文案；后台填了自定义说明就用后台的 */
const RECOVERY_HINTS = {
  email: '邮箱自助找回通道尚未接入，开通后可自行重置密码。',
  security: '密保问题已预留位置，尚未开放设置与校验。',
  service:
    '在站内给客服账号留言，写清登录账号与遇到的情况，我们核实身份后会协助你重置密码。',
  master:
    '提交后会立刻通知站长，并在后台生成一条待处理申请；如果下方给了联系方式，也可以直接找站长。',
};

/**
 * 找回密码入口，四种渠道：
 * - email：邮箱自助找回（预留，通道尚未接入）
 * - service：站内客服（需要「已开启 + 已配置客服账号」）
 * - master：站长求助（需要「已开启 + 已配置联系方式」）
 * - security：密保问题（预留）
 *
 * 这里会做完整的真实性校验：账号必须填、渠道必须开着且配好了联系方式、账号必须真的存在；
 * 任何一步不通过都给出明确原因，而不是笼统地「已记录」。
 * 校验通过后会写入 recovery_requests 并立刻站内通知超级管理员/管理员/客服，
 * 让「求助」变成一条真的会有人处理的工单。
 */
authRouter.post(
  '/recover',
  recoverLimit,
  secureChannel({ required: true }),
  (req, res) => {
    const body = req.body || {};
    const account = normalizeUsername(body.account).slice(0, 40);
    const method = RECOVERY_METHODS.has(String(body.method)) ? String(body.method) : '';
    const recovery = getSiteConfig().recovery;

    /* 四种渠道的实时状态：无论成功还是失败都一并回传，前端据此渲染入口与提示 */
    const channels = {};
    Object.keys(RECOVERY_LABELS).forEach((key) => {
      const state = recoveryChannelState(recovery, key);
      channels[key] = {
        available: state === 'available',
        state,
        label: RECOVERY_LABELS[key],
        account: key === 'service' ? recovery.serviceAccount || '' : '',
        contact: key === 'master' ? recovery.masterContact || '' : '',
        hint:
          (key === 'service' && recovery.serviceHint) ||
          (key === 'master' && recovery.masterHint) ||
          RECOVERY_HINTS[key],
      };
    });

    /** 失败也把渠道信息带上，前端可以直接提示「换一种方式」 */
    const deny = (status, message) => res.status(status).json({ ok: false, handled: false, error: message, channels });

    try {
      if (!account) throw new HttpError(400, '请先填写要找回的登录账号或用户编号');
      if (!method) throw new HttpError(400, '请选择一种找回方式');

      const state = recoveryChannelState(recovery, method);
      if (state === 'disabled') return deny(403, `${RECOVERY_LABELS[method]}尚未开放，请选择其它方式`);

      const target = findRecoveryAccount(account);
      if (!target) {
        registerFailure(req, { username: account, kind: 'recover.miss', reason: '账号不存在', detail: { method } });
        return deny(404, '没有找到这个账号，请检查用户名或用户编号是否正确');
      }
      if (target.status === 'banned') return deny(403, '该账号处于封禁状态，请联系客服或站长处理');

      if (state === 'reserved') {
        logAuthEvent({ req, username: account, kind: 'recover.reserved', detail: { method } });
        return res.status(501).json({
          ok: true,
          handled: false,
          channels,
          message: channels[method].hint,
        });
      }
      if (state === 'unconfigured') {
        return deny(409, `${RECOVERY_LABELS[method]}还没有配置联系方式，请先选择其它方式`);
      }

      const ts = nowIso();
      const ip = clientIp(req);
      const info = db
        .prepare(
          `INSERT INTO recovery_requests (account, user_id, uid, method, status, channel_snapshot, ip, user_agent, created_at)
           VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`
        )
        .run(
          account,
          target.id,
          target.uid ?? null,
          method,
          JSON.stringify(channels[method]),
          ip,
          userAgentOf(req),
          ts
        );

      const requestId = Number(info.lastInsertRowid);
      const title = `找回密码申请：${target.anon_name}（UID ${target.uid ?? '—'}）`;
      const desc = `方式：${RECOVERY_LABELS[method]}；账号：${target.username}；提交时间：${ts}`;
      notifyRecoveryStaff({ title, body: desc, serviceAccount: recovery.serviceAccount });

      logAuthEvent({ req, username: account, kind: 'recover.request', detail: { method, requestId } });
      logAudit({
        actor: null,
        action: 'user.recover',
        targetType: 'user',
        targetId: target.id,
        detail: { account, method, requestId },
      });

      return res.json({
        ok: true,
        handled: true,
        requestId,
        channels,
        account: { uid: target.uid ?? null, username: target.username, anonName: target.anon_name },
        message: `申请已受理，受理编号 #${requestId}。请按下面的方式联系我们，核实身份后即可协助重置密码。`,
      });
    } catch (error) {
      if (error instanceof HttpError) return deny(error.status || 400, error.message);
      return fail(res, error, '找回申请提交失败');
    }
  }
);

/* ------------------------------------------------- 当前用户 / 资料 / 续期 / 登出 */

authRouter.get('/me', secureChannel({ required: true }), requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/**
 * 我提交过的找回密码申请。
 *
 * 找回是「离开账号」时发起的，光靠站内信容易错过，所以在个人信息里
 * 留一份完整记录：提交了什么方式、什么时候、谁处理的、处理时说了什么。
 */
authRouter.get('/recovery-mine', secureChannel({ required: true }), requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.method, r.status, r.ip, r.created_at, r.handled_at, r.handled_note,
              h.anon_name AS handler_name
         FROM recovery_requests r
         LEFT JOIN users h ON h.id = r.handled_by
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 20`
    )
    .all(req.user.id);

  res.json({
    requests: rows.map((row) => ({
      id: row.id,
      method: row.method,
      label: RECOVERY_LABELS[row.method] || row.method,
      status: row.status,
      /* 来源 IP 完整回显：用户自己也该看到这次申请是从哪个地址发出的 */
      ip: row.ip || '',
      createdAt: row.created_at,
      handledAt: row.handled_at,
      handledBy: row.handler_name || '',
      handledNote: row.handled_note || '',
    })),
  });
});

const GENDERS = ['secret', 'female', 'male', 'other'];

function cleanText(value, max) {
  /* 去掉控制字符并压缩空白，长度按字符（非字节）截断 */
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 资料修改：只接受白名单字段，头像按站点策略决定是否进入人工审核；访客不可写 */
authRouter.patch('/profile', secureChannel({ required: true }), requireRegistered, (req, res) => {
  try {
    const body = req.body || {};
    const cfg = getSiteConfig();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!row) return res.status(404).json({ error: '用户不存在' });

    const next = {
      bio: row.bio,
      intro: row.intro,
      gender: row.gender,
      age: row.age,
      birthday: row.birthday,
      occupation: row.occupation,
      location: row.location,
      hobbies: row.hobbies,
      nickname: row.nickname || '',
      anon_name: row.anon_name,
      nickname_changed_at: row.nickname_changed_at,
      email: row.email || '',
      email_verified: row.email_verified ?? 0,
      email_verified_at: row.email_verified_at,
      phone: row.phone || '',
      phone_verified: row.phone_verified ?? 0,
      phone_verified_at: row.phone_verified_at,
      real_name: row.real_name || '',
      id_number: row.id_number || '',
      real_verified: row.real_verified ?? 0,
      real_verified_at: row.real_verified_at,
      avatar_url: row.avatar_url,
      avatar_pending: row.avatar_pending,
      avatar_status: row.avatar_status,
      avatar_submitted_at: row.avatar_submitted_at,
    };

    if (body.bio !== undefined) next.bio = cleanText(body.bio, 160);
    if (body.intro !== undefined) next.intro = cleanText(body.intro, 160);
    if (body.gender !== undefined && GENDERS.includes(body.gender)) next.gender = body.gender;
    if (body.age !== undefined) {
      const age = body.age === null || body.age === '' ? null : Number(body.age);
      next.age = age !== null && Number.isInteger(age) && age >= 0 && age <= 120 ? age : null;
    }
    if (body.birthday !== undefined) {
      const birthday = String(body.birthday || '').slice(0, 32);
      next.birthday = /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : null;
    }
    if (body.occupation !== undefined) next.occupation = cleanText(body.occupation, 40);
    if (body.location !== undefined) next.location = cleanText(body.location, 40);
    if (body.hobbies !== undefined) {
      const list = Array.isArray(body.hobbies) ? body.hobbies : [];
      next.hobbies = JSON.stringify(
        [...new Set(list.map((item) => cleanText(item, 12)).filter(Boolean))].slice(0, 8)
      );
    }

    /* 昵称：清空即回到系统分配的匿名身份，重设则同步 anon_name 让全站展示一致 */
    if (body.nickname !== undefined) {
      const nickname = normalizeNickname(body.nickname);
      if (nickname !== (row.nickname || '')) {
        next.nickname = nickname;
        next.anon_name = nickname || anonIdentity(row.username).name;
        next.nickname_changed_at = nowIso();
      }
    }

    /* 邮箱 / 手机号 / 实名：预留能力，开关未开启时一律不被受理 */
    const verification = getVerification();
    if (body.email !== undefined) {
      requireVerificationFeature(verification.emailEnabled, '邮箱');
      const email = resolveEmail(body.email, row.email || '', row.id);
      if (email !== (row.email || '')) {
        next.email = email;
        next.email_verified = 0;
        next.email_verified_at = null;
      }
    }
    if (verification.emailEnabled && verification.emailRequired && !next.email) {
      return res.status(400).json({ error: '本站要求填写邮箱后才能保存资料' });
    }
    if (body.phone !== undefined) {
      requireVerificationFeature(verification.phoneEnabled, '手机号');
      const phone = resolvePhone(body.phone, row.phone || '', row.id);
      if (phone !== (row.phone || '')) {
        next.phone = phone;
        next.phone_verified = 0;
        next.phone_verified_at = null;
      }
    }
    if (verification.phoneEnabled && verification.phoneRequired && !next.phone) {
      return res.status(400).json({ error: '本站要求填写手机号后才能保存资料' });
    }
    if (body.realName !== undefined || body.idNumber !== undefined) {
      requireVerificationFeature(verification.realNameEnabled, '实名认证');
      const realName = cleanText(body.realName ?? '', 40);
      const idNumber = String(body.idNumber ?? '').trim().replace(/\s+/g, '').slice(0, 32);
      if (realName && !REAL_NAME_RE.test(realName)) {
        return res.status(400).json({ error: '姓名格式不正确，请输入真实姓名' });
      }
      if (idNumber && !ID_NUMBER_RE.test(idNumber)) {
        return res.status(400).json({ error: '证件号码格式不正确' });
      }
      if (verification.realNameRequired && (!realName || !idNumber)) {
        return res.status(400).json({ error: '本站要求完成实名信息填写' });
      }
      /* 实名资料密文落库，任何改动都会把认证状态重置为「待核验」 */
      next.real_name = realName ? encryptField(realName) : '';
      next.id_number = idNumber ? encryptField(idNumber) : '';
      next.real_verified = 0;
      next.real_verified_at = null;
    }

    /* 文本内容过一次自动审核：命中黑名单直接拒绝，不写入 */
    const review = autoReview({
      kind: 'profile',
      content: `${next.bio}\n${next.intro}\n${next.occupation}\n${next.location}\n${next.nickname}`,
      userId: row.id,
      user: row,
    });
    if (review.status === 'rejected') {
      return res.status(400).json({ error: `资料包含不允许的内容：${review.flags.join('、')}` });
    }

    if (body.avatarUrl !== undefined) {
      const avatar = cleanText(body.avatarUrl, 300);
      if (!avatar) {
        next.avatar_url = '';
        next.avatar_pending = '';
        next.avatar_status = 'none';
        next.avatar_submitted_at = null;
      } else if (!/^\/uploads\//.test(avatar)) {
        /* 只接受本站上传目录内的图片，杜绝外链与 javascript: 之类的注入 */
        return res.status(400).json({ error: '头像地址不合法，请重新上传' });
      } else if (cfg.avatarNeedsReview) {
        next.avatar_pending = avatar;
        next.avatar_status = 'pending';
        next.avatar_submitted_at = nowIso();
      } else {
        next.avatar_url = avatar;
        next.avatar_pending = '';
        next.avatar_status = 'approved';
        next.avatar_submitted_at = null;
      }
    }

    db.prepare(
      `UPDATE users SET bio = ?, intro = ?, gender = ?, age = ?, birthday = ?, occupation = ?, location = ?,
       hobbies = ?, nickname = ?, anon_name = ?, nickname_changed_at = ?,
       email = ?, email_verified = ?, email_verified_at = ?,
       phone = ?, phone_verified = ?, phone_verified_at = ?,
       real_name = ?, id_number = ?, real_verified = ?, real_verified_at = ?,
       avatar_url = ?, avatar_pending = ?, avatar_status = ?, avatar_submitted_at = ?
       WHERE id = ?`
    ).run(
      next.bio,
      next.intro,
      next.gender,
      next.age,
      next.birthday,
      next.occupation,
      next.location,
      next.hobbies,
      next.nickname,
      next.anon_name,
      next.nickname_changed_at,
      next.email,
      next.email_verified,
      next.email_verified_at,
      next.phone,
      next.phone_verified,
      next.phone_verified_at,
      next.real_name,
      next.id_number,
      next.real_verified,
      next.real_verified_at,
      next.avatar_url,
      next.avatar_pending,
      next.avatar_status,
      next.avatar_submitted_at,
      req.user.id
    );

    const user = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id));
    return res.json({ user });
  } catch (error) {
    return fail(res, error, '资料更新失败');
  }
});

/* ------------------------------------------------- 账号 / 密码修改 */

/**
 * 登录账号与登录密码修改。
 * - 昵称在资料接口里维护，这里只处理「登录账号」与「登录密码」；
 * - 任何改动都必须提供当前密码，避免会话被窃取后直接改号夺权；
 * - 改密成功后除当前会话外的全部会话立即吊销，旧设备上的登录态作废。
 */
authRouter.patch('/account', secureChannel({ required: true }), requireRegistered, (req, res) => {
  try {
    const body = req.body || {};
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!row) return res.status(404).json({ error: '用户不存在' });

    const currentPassword = readSecret(req, body.currentPassword);
    const newPassword = readSecret(req, body.newPassword);
    const nextUsername = body.username === undefined ? '' : normalizeUsername(body.username);

    const wantsUsername = Boolean(nextUsername) && nextUsername !== row.username;
    const wantsPassword = String(newPassword || '').length > 0;
    if (!wantsUsername && !wantsPassword) throw new HttpError(400, '没有需要修改的内容');
    if (!currentPassword) throw new HttpError(400, '请输入当前密码以确认身份');
    if (!verifyPassword(currentPassword, row.password_hash)) {
      registerFailure(req, { username: row.username, kind: 'account.fail', reason: '当前密码不正确' });
      throw new HttpError(400, '当前密码不正确');
    }

    const policy = getSecurityPolicy();
    const changed = [];

    if (wantsUsername) {
      if (!USERNAME_RE.test(nextUsername)) throw new HttpError(400, '用户名需为 2-20 位中英文、数字或下划线');
      if (isReservedUsername(nextUsername)) throw new HttpError(400, '该用户名不可用，请换一个');
      const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(nextUsername, row.id);
      if (taken) throw new HttpError(409, '用户名已存在');
      db.prepare('UPDATE users SET username = ?, account_changed_at = ? WHERE id = ?').run(
        nextUsername,
        nowIso(),
        row.id
      );
      changed.push('username');
    }

    if (wantsPassword) {
      /* 与注册保持一致：只拦长度底线，强度只提示不强制 */
      if (String(newPassword).length < policy.minPasswordLength) {
        throw new HttpError(400, `密码至少 ${policy.minPasswordLength} 位`);
      }
      if (String(newPassword).length > 128) throw new HttpError(400, '密码过长（最多 128 位）');
      db.prepare('UPDATE users SET password_hash = ?, account_changed_at = ? WHERE id = ?').run(
        hashPassword(newPassword),
        nowIso(),
        row.id
      );
      changed.push('password');
      revokeUserSessions(row.id, { exceptSid: req.sessionId });
    }

    const user = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id));
    logAuthEvent({ req, username: user.username, kind: 'account.update', detail: { uid: user.uid, changed } });
    logAudit({ actor: user, action: 'user.account', targetType: 'user', targetId: row.id, detail: { changed } });
    return res.json({ user, changed });
  } catch (error) {
    return fail(res, error, '账号修改失败');
  }
});

/* ------------------------------------------------- 身份验证（预留，未实装） */

const VERIFY_FEATURES = {
  email: { key: 'emailEnabled', label: '邮箱验证' },
  phone: { key: 'phoneEnabled', label: '手机号验证' },
  realname: { key: 'realNameEnabled', label: '实名认证' },
};

/**
 * 预留的验证触发接口。
 * 当前只做「开关判定 + 明确告知通道尚未接入」：开关关闭时任何账号都无法使用，
 * 超级管理员开启后真实的下发验证码 / 实名核验逻辑接入此处即可，前端无需改动。
 */
authRouter.post('/verify/:kind', secureChannel({ required: true }), requireRegistered, (req, res) => {
  const feature = VERIFY_FEATURES[String(req.params.kind)];
  if (!feature) return res.status(404).json({ error: '未知的验证类型' });
  const verification = getVerification();
  if (!verification[feature.key]) {
    return res.status(403).json({ error: `${feature.label}功能尚未开放，请联系管理员开启` });
  }
  return res.status(501).json({ error: `${feature.label}通道尚未接入，该能力已预留` });
});

/** 静默续期：签发新令牌并延长服务端会话，旧令牌立即失效 */
authRouter.post('/refresh', secureChannel({ required: true }), requireAuth, (req, res) => {
  try {
    const policy = getSecurityPolicy();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user || user.status === 'banned') {
      revokeSession(req.sessionId);
      return res.status(401).json({ error: '登录状态已失效' });
    }
    revokeSession(req.sessionId);
    const created = createServerSession({ user: publicUser(user), req });
    attachSessionCookie(res, req, created.token, created.ttlSeconds);
    return res.json({ token: created.token, user: publicUser(user), expiresIn: created.ttlSeconds });
  } catch (error) {
    return fail(res, error, '续期失败');
  }
});

authRouter.post('/logout', secureChannel({ required: true }), requireAuth, (req, res) => {
  revokeSession(req.sessionId);
  logAuthEvent({ req, username: req.user.username, kind: 'logout', detail: { uid: req.user.id } });
  res.setHeader('Set-Cookie', clearSessionCookie(req));
  res.json({ ok: true });
});

/* 管理员账号由服务端启动流程自举（见 lib/auth.js ensureAdminAccount），
   用户名与口令只存在于服务端常量或环境变量，不会出现在任何接口响应或前端产物中。 */
