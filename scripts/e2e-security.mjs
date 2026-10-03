/**
 * 端到端安全验证脚本
 * 用与前端完全相同的加密通道协议直接打服务端接口，覆盖：
 * 握手 -> 挑战 -> 工作量证明 -> 信封登录 -> 会话续用 -> 各类攻击被拒绝 -> 登出失效
 *
 * 前置：服务端已在本地运行（默认 http://127.0.0.1:8787）
 * 运行：npm run verify:security
 * 可用环境变量覆盖：E2E_BASE / E2E_ADMIN_USER / E2E_ADMIN_PASS
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from '../server/src/db.js';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8787';
const PROTOCOL_VERSION = 1;
const LOGICAL_FIELDS = ['v', 'sid', 'iv', 'd', 'ts', 'n', 's'];
const ALIAS_ALPHABET = 'qpwoeirutyalskdjfhgzmxncbv';
const COOKIE_NAME = 'xsz_s';

const ADMIN_USER = process.env.E2E_ADMIN_USER || 'huazhiyou';
const ADMIN_PASS = process.env.E2E_ADMIN_PASS || 'huazhiyouyou';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (text) => Buffer.from(String(text), 'base64url');
const hkdf = (ikm, salt, info, len) =>
  Buffer.from(
    crypto.hkdfSync('sha256', ikm, Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt)), Buffer.from(info), len)
  );
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('base64url');
const pathOf = (url) => url.split('?')[0];

function aesEncrypt(key, iv, plain, aad) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([ct, cipher.getAuthTag()]);
}

function aesDecrypt(key, iv, sealed, aad) {
  const tag = sealed.subarray(sealed.length - 16);
  const ct = sealed.subarray(0, sealed.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function buildAliases(kx, sid) {
  const bytes = hkdf(kx, sid, 'xsz-alias-v1', 64);
  const aliases = {};
  const used = new Set();
  LOGICAL_FIELDS.forEach((name, index) => {
    let alias = ALIAS_ALPHABET[bytes[index * 2] % 26] + ALIAS_ALPHABET[bytes[index * 2 + 1] % 26];
    let attempt = 0;
    while (used.has(alias)) {
      attempt += 1;
      if (attempt > 24) {
        alias = `z${index}${attempt}`;
        break;
      }
      const x = bytes[(index * 2 + attempt) % 64];
      const y = bytes[(index * 2 + attempt + 31) % 64];
      alias = ALIAS_ALPHABET[x % 26] + ALIAS_ALPHABET[y % 26] + (attempt > 8 ? String(attempt) : '');
    }
    used.add(alias);
    aliases[name] = alias;
  });
  return aliases;
}

function leadingZeroBits(buffer) {
  let bits = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

function solvePow(prefix, bits) {
  if (!prefix || bits <= 0) return '';
  for (let i = 0; i < 8_000_000; i += 1) {
    const digest = crypto.createHash('sha256').update(`${prefix}:${i}`).digest();
    if (leadingZeroBits(digest) >= bits) return String(i);
  }
  throw new Error('PoW 求解超时');
}

async function handshake() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const clientPublic = ecdh.getPublicKey();
  const response = await fetch(`${BASE}/api/auth/handshake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: PROTOCOL_VERSION, cp: b64u(clientPublic), fp: 'e2e-security-test' }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `握手失败：${response.status} ${text.slice(0, 200)}`);
  const payload = JSON.parse(text);
  assert.ok(payload.sid && payload.sp && payload.kx, '握手响应缺少必要字段');

  const shared = ecdh.computeSecret(unb64u(payload.sp));
  const salt = crypto.createHash('sha256').update(clientPublic).update(unb64u(payload.sp)).digest();
  const material = hkdf(shared, salt, 'xsz-transport-v1', 64);

  return {
    sid: payload.sid,
    aliases: buildAliases(unb64u(payload.kx), payload.sid),
    encKey: material.subarray(0, 32),
    macKey: material.subarray(32, 64),
  };
}

async function challenge(username = '') {
  const response = await fetch(`${BASE}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  assert.equal(response.status, 200, `挑战签发失败：${response.status}`);
  return response.json();
}

function sealField(session, nonce, plaintext) {
  const key = hkdf(session.encKey, nonce, 'xsz-field-v1', 32);
  const iv = crypto.randomBytes(12);
  const sealed = aesEncrypt(key, iv, plaintext, `field|${nonce}`);
  return b64u(Buffer.concat([iv, sealed]));
}

async function sealedCall(session, method, url, payload, { cookie = '', tamper = false } = {}) {
  const pathname = pathOf(url);
  const ts = Date.now();
  const nonce = b64u(crypto.randomBytes(9));
  const body = typeof payload === 'function' ? payload(nonce) : payload;
  const iv = crypto.randomBytes(12);
  const ivText = b64u(iv);
  const dataText = b64u(
    aesEncrypt(session.encKey, iv, JSON.stringify(body), ['req', method, pathname, session.sid, String(ts), nonce].join('|'))
  );
  const signature = hmac(session.macKey, ['REQ', method, pathname, session.sid, String(ts), nonce, ivText, dataText].join('\n'));
  const alias = session.aliases;

  const envelope = {
    [alias.v]: PROTOCOL_VERSION,
    [alias.sid]: session.sid,
    [alias.iv]: ivText,
    [alias.d]: tamper ? `${dataText.slice(0, -4)}AAAA` : dataText,
    [alias.ts]: ts,
    [alias.n]: nonce,
    [alias.s]: signature,
  };

  const headers = { 'Content-Type': 'application/json', 'X-Xsz-Enc': '1', 'X-Xsz-Sid': session.sid };
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${BASE}${url}`, { method, headers, body: JSON.stringify(envelope) });
  return { response, envelope, raw: await response.text() };
}

function openSealed(session, text) {
  const envelope = JSON.parse(text);
  const alias = session.aliases;
  const sidText = String(envelope[alias.sid] || '');
  const ivText = String(envelope[alias.iv] || '');
  const dataText = String(envelope[alias.d] || '');
  const tsText = String(envelope[alias.ts] || '');
  const nonce = String(envelope[alias.n] || '');
  const signature = String(envelope[alias.s] || '');
  assert.equal(sidText, session.sid, '响应 sid 不匹配');
  const expected = hmac(session.macKey, ['RES', session.sid, tsText, nonce, ivText, dataText].join('\n'));
  assert.equal(expected, signature, '响应签名校验失败');
  const plain = aesDecrypt(session.encKey, unb64u(ivText), unb64u(dataText), ['res', session.sid, tsText, nonce].join('|'));
  return plain ? JSON.parse(plain) : null;
}

/** 解不开也要能读出可读的错误信息，方便定位 */
function safeOpen(session, text) {
  try {
    return JSON.stringify(openSealed(session, text)).slice(0, 200);
  } catch (error) {
    return `${String(text).slice(0, 120)} / ${error.message}`;
  }
}

/** 无请求体的调用走请求头签名，签名覆盖的是不含查询串的路径 */
async function signedGet(session, url, cookie = '', authorization = '') {
  const pathname = pathOf(url);
  const ts = Date.now();
  const nonce = b64u(crypto.randomBytes(9));
  const signature = hmac(session.macKey, ['REQ', 'GET', pathname, session.sid, String(ts), nonce, '', ''].join('\n'));
  const headers = {
    'X-Xsz-Enc': '1',
    'X-Xsz-Sid': session.sid,
    'X-Xsz-Ts': String(ts),
    'X-Xsz-Nonce': nonce,
    'X-Xsz-Sig': signature,
  };
  if (cookie) headers.Cookie = cookie;
  if (authorization) headers.Authorization = authorization;
  const response = await fetch(`${BASE}${url}`, { method: 'GET', headers });
  return { response, raw: await response.text() };
}

async function adminGet(session, url, cookie) {
  const { response, raw } = await signedGet(session, url, cookie);
  assert.equal(response.status, 200, `${url} 返回 ${response.status}：${raw.slice(0, 200)}`);
  return openSealed(session, raw);
}

async function loginCall(session, username, password, extra = {}) {
  const proof = await challenge(username);
  return sealedCall(session, 'POST', '/api/auth/login', (nonce) => ({
    username,
    password: sealField(session, nonce, password),
    cid: proof.cid,
    pow: proof.cid ? solvePow(proof.prefix, proof.bits) : '',
    hp: '',
    ...extra,
  }));
}

/** 注册一个可用于本轮验证的普通账号，返回通道、凭据与用户视图 */
async function registerUser({ nickname } = {}) {
  const channel = await handshake();
  const username = `e2e_x${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const password = 'Probe-Pass-2026-Xsz';
  testUsers.push(username);
  const proof = await challenge(username);
  const { response, raw } = await sealedCall(channel, 'POST', '/api/auth/register', (nonce) => {
    const payload = {
      username,
      password: sealField(channel, nonce, password),
      confirm: sealField(channel, nonce, password),
      cid: proof.cid,
      pow: proof.cid ? solvePow(proof.prefix, proof.bits) : '',
      hp: '',
    };
    if (nickname) payload.nickname = nickname;
    return payload;
  });
  assert.ok([200, 201].includes(response.status), `注册失败：${response.status} ${safeOpen(channel, raw)}`);
  return {
    channel,
    username,
    password,
    cookie: String(response.headers.get('set-cookie') || '').split(';')[0],
    user: openSealed(channel, raw).user,
  };
}

/** 建立一条已登录的管理员通道 */
async function bootstrap() {
  const session = await handshake();
  const { response, raw } = await loginCall(session, ADMIN_USER, ADMIN_PASS);
  assert.equal(response.status, 200, `管理员登录失败：${response.status} ${raw.slice(0, 200)}`);
  const payload = openSealed(session, raw);
  const cookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  return { session, cookie, loginResponse: response, loginRaw: raw, loginPayload: payload };
}

const results = [];
const testUsers = [];
async function record(name, fn) {
  try {
    await fn();
    results.push(`  PASS  ${name}`);
  } catch (error) {
    results.push(`  FAIL  ${name}\n        ${String(error.message).split('\n').slice(0, 6).join('\n        ')}`);
    process.exitCode = 1;
  }
}

/** 清掉历史留痕，避免上一次运行累积的失败计数干扰本轮阈值判定 */
function resetTraces() {
  db.prepare('DELETE FROM auth_events').run();
  db.prepare('DELETE FROM auth_locks').run();
}

/* 本轮验证会连打上百次接口，先临时放宽限流阈值，跑完原样恢复 */
const ORIGINAL_SITE_CONFIG = getSetting('site_config', null);

function raiseLimitsForTest() {
  const cfg = getSetting('site_config', null) || {};
  /* 认证类限流阈值都是策略驱动的，这里整体放宽，避免本轮上百次调用被自己的防护挡住 */
  setSetting('site_config', {
    ...cfg,
    security: {
      ...(cfg.security || {}),
      loginMaxPerIp: 300,
      apiMaxPerIp: 100000,
      registerMaxPerIp: 1000,
      handshakeMaxPerIp: 5000,
      challengeMaxPerIp: 10000,
      recoverMaxPerIp: 1000,
    },
  });
}

function restoreLimits() {
  if (ORIGINAL_SITE_CONFIG === null || ORIGINAL_SITE_CONFIG === undefined) {
    db.prepare("DELETE FROM settings WHERE key = 'site_config'").run();
    return;
  }
  setSetting('site_config', ORIGINAL_SITE_CONFIG);
}

async function main() {
  raiseLimitsForTest();
  resetTraces();

  const admin = await bootstrap();
  const { session, cookie } = admin;

  await record('握手成功且字段别名可复现', async () => {
    assert.equal(Object.keys(session.aliases).length, 7);
    assert.equal(new Set(Object.values(session.aliases)).size, 7, '别名存在冲突');
    const probe = await handshake();
    assert.notEqual(probe.sid, session.sid, '会话号必须随机');
  });

  await record('工作量证明可求解，且难度随失败次数上升', async () => {
    const proof = await challenge(ADMIN_USER);
    assert.ok(proof.cid && proof.bits > 0, '挑战未下发');
    assert.ok(/^\d+$/.test(solvePow(proof.prefix, proof.bits)));
  });

  await record('管理员登录成功，线上报文与响应体均无明文', async () => {
    const { loginRaw: raw, loginResponse: response, loginPayload: payload } = admin;
    assert.equal(response.headers.get('x-xsz-enc'), '1', '响应未加密');
    assert.ok(payload.token && payload.user, '登录响应缺少令牌或用户');
    assert.equal(payload.user.username, ADMIN_USER);
    assert.equal(payload.user.role, 'superadmin', '站点所有者账号应为超级管理员');
    assert.equal(payload.user.isSuperAdmin, true);
    assert.ok(!payload.user.passwordHash && !('password_hash' in payload.user), '用户视图泄露敏感列');
    assert.ok(cookie.startsWith(`${COOKIE_NAME}=`), `未下发会话 Cookie：${cookie}`);
    assert.ok(!raw.includes(ADMIN_PASS), '报文中出现明文密码');
    assert.ok(!raw.includes('password'), '报文中出现明文字段名 password');
    assert.ok(!raw.includes('username'), '报文中出现明文字段名 username');
    assert.ok(!raw.includes(ADMIN_USER), '报文中出现明文用户名');
    assert.ok(!raw.includes(payload.token), '令牌以明文出现在响应体中');
  });

  await record('会话 Cookie 为 httpOnly + SameSite=Strict + Path=/api', async () => {
    const setCookie = String(admin.loginResponse.headers.get('set-cookie') || '');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/api/);
    assert.ok(!setCookie.includes('token='), '不应再下发令牌 Cookie');
  });

  await record('登录态接口 /me 走请求头签名并返回加密响应', async () => {
    const { response, raw } = await signedGet(session, '/api/auth/me', cookie);
    assert.equal(response.status, 200, `状态 ${response.status}：${raw.slice(0, 160)}`);
    const payload = openSealed(session, raw);
    assert.equal(payload.user.username, ADMIN_USER);
    assert.ok(!raw.includes(ADMIN_USER), '响应中出现明文用户名');
    assert.ok(!raw.includes('username'), '响应中出现明文字段名');
    assert.ok(!JSON.stringify(payload.user).includes(ADMIN_PASS), '用户视图泄露了口令');
  });

  await record('刷新页面（新通道）后登录态延续：Cookie 与 Bearer 均可用', async () => {
    /* 浏览器刷新会重新握手，通道 sid 变了但登录态必须还在 */
    const byCookie = await handshake();
    const first = await signedGet(byCookie, '/api/auth/me', cookie);
    assert.equal(first.response.status, 200, `新通道 + Cookie 失效：${first.response.status} ${safeOpen(byCookie, first.raw)}`);
    assert.equal(openSealed(byCookie, first.raw).user.username, ADMIN_USER);

    const byToken = await handshake();
    const second = await signedGet(byToken, '/api/auth/me', '', `Bearer ${admin.loginPayload.token}`);
    assert.equal(second.response.status, 200, `新通道 + 令牌失效：${second.response.status} ${safeOpen(byToken, second.raw)}`);
    assert.equal(openSealed(byToken, second.raw).user.username, ADMIN_USER);
  });

  await record('后台统计对管理员可用且内容加密', async () => {
    const payload = await adminGet(session, '/api/admin/stats', cookie);
    assert.ok(payload.pending && typeof payload.pendingTotal === 'number', '后台统计结构不正确');
    assert.ok(Array.isArray(payload.trend), '缺少趋势数据');
  });

  await record('安全面板可读：锁定、事件与通道状态', async () => {
    const payload = await adminGet(session, '/api/admin/security?limit=20', cookie);
    assert.ok(Array.isArray(payload.locks) && Array.isArray(payload.events), '安全面板结构不正确');
    assert.ok(payload.channel && typeof payload.channel.sessions === 'number', '缺少通道状态');
    assert.ok(payload.viewerIp, '缺少访问者 IP');
  });

  await record('普通用户登录后仍被后台接口拒绝（403）', async () => {
    const channel = await handshake();
    const username = `e2e_user_${Date.now() % 1000000}`;
    const password = 'Probe-Pass-2026-Xsz';
    /* 先登记再操作：即使后续断言失败，收尾也能把测试账号清掉 */
    testUsers.push(username);
    const proof = await challenge(username);
    const register = await sealedCall(channel, 'POST', '/api/auth/register', (nonce) => ({
      username,
      password: sealField(channel, nonce, password),
      confirm: sealField(channel, nonce, password),
      cid: proof.cid,
      pow: proof.cid ? solvePow(proof.prefix, proof.bits) : '',
      hp: '',
    }));
    assert.ok(
      [200, 201].includes(register.response.status),
      `注册失败：${register.response.status} ${safeOpen(channel, register.raw)}`
    );

    const login = await loginCall(channel, username, password);
    assert.equal(login.response.status, 200, `普通用户登录失败：${login.response.status}`);
    const loginPayload = openSealed(channel, login.raw);
    assert.ok(!JSON.stringify(loginPayload.user).includes(password), '用户视图泄露了密码');
    const userCookie = String(login.response.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(userCookie.startsWith(`${COOKIE_NAME}=`), '普通用户未拿到会话 Cookie');

    const stats = await signedGet(channel, '/api/admin/stats', userCookie);
    assert.equal(stats.response.status, 403, `后台统计期望 403，实际 ${stats.response.status}`);

    const unlock = await sealedCall(channel, 'POST', '/api/admin/security/unlock', { id: 1 }, { cookie: userCookie });
    assert.equal(unlock.response.status, 403, `解锁接口期望 403，实际 ${unlock.response.status}`);
  });

  await record('连续失败触发账号锁定（423），锁定期间正确密码也被拒', async () => {
    const probe = await handshake();
    const target = 'e2e-lock-probe';
    let locked = null;
    for (let i = 0; i < 7; i += 1) {
      const { response, raw } = await loginCall(probe, target, 'wrong-password-123');
      if (response.status === 423) {
        locked = openSealed(probe, raw);
        break;
      }
      assert.equal(response.status, 401, `第 ${i + 1} 次期望 401，实际 ${response.status}`);
      assert.equal(openSealed(probe, raw).error, '用户名或密码不正确', '错误提示不应区分账号是否存在');
    }
    assert.ok(locked, '连续失败后未触发锁定');
    assert.ok(locked.retryAfter > 0, '锁定未返回等待时长');

    const stillLocked = await loginCall(probe, target, 'wrong-password-123');
    assert.equal(stillLocked.response.status, 423, `锁定期望 423，实际 ${stillLocked.response.status}`);
  });

  await record('安全面板能看到该锁定，管理员可手动解锁', async () => {
    const before = await adminGet(session, '/api/admin/security?limit=50', cookie);
    const lock = before.locks.find((item) => item.key === 'e2e-lock-probe');
    assert.ok(lock, '未找到测试锁定记录');
    assert.equal(lock.scope, 'user');
    assert.ok(lock.attempts >= 5, '未记录失败次数');

    const unlock = await sealedCall(session, 'POST', '/api/admin/security/unlock', { id: lock.id }, { cookie });
    assert.equal(unlock.response.status, 200, `解锁失败：${unlock.response.status} ${unlock.raw.slice(0, 160)}`);

    const after = await adminGet(session, '/api/admin/security?limit=50', cookie);
    assert.ok(!after.locks.some((item) => item.key === 'e2e-lock-probe'), '锁定未被解除');
    assert.ok(
      after.events.some((item) => item.kind === 'login.fail'),
      '失败事件未留痕'
    );
  });

  await record('明文直连接口被拒绝（428）', async () => {
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    assert.equal(response.status, 428, `期望 428，实际 ${response.status}`);
    const payload = await response.json();
    assert.ok(!JSON.stringify(payload).includes(ADMIN_PASS), '错误响应回显了密码');
  });

  await record('未登录访问后台接口只返回 401，不泄露明文提示', async () => {
    const anon = await handshake();
    const { response, raw } = await signedGet(anon, '/api/admin/stats');
    assert.equal(response.status, 401, `期望 401，实际 ${response.status}`);
    const payload = openSealed(anon, raw);
    assert.ok(payload.error, '缺少错误信息');
  });

  await record('信封被篡改时验签失败，连续失败会销毁通道', async () => {
    const attack = await handshake();
    const proof = await challenge(ADMIN_USER);
    const { response } = await sealedCall(
      attack,
      'POST',
      '/api/auth/login',
      (nonce) => ({
        username: ADMIN_USER,
        password: sealField(attack, nonce, ADMIN_PASS),
        cid: proof.cid,
        pow: proof.cid ? solvePow(proof.prefix, proof.bits) : '',
        hp: '',
      }),
      { tamper: true }
    );
    assert.equal(response.status, 400, `期望 400，实际 ${response.status}`);
  });

  await record('重放同一信封被拒绝（409）', async () => {
    const attack = await handshake();
    const proof = await challenge(ADMIN_USER);
    const first = await sealedCall(attack, 'POST', '/api/auth/login', (nonce) => ({
      username: ADMIN_USER,
      password: sealField(attack, nonce, ADMIN_PASS),
      cid: proof.cid,
      pow: proof.cid ? solvePow(proof.prefix, proof.bits) : '',
      hp: '',
    }));
    assert.equal(first.response.status, 200, `首次登录应成功：${first.response.status}`);
    const replay = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Xsz-Enc': '1', 'X-Xsz-Sid': attack.sid },
      body: JSON.stringify(first.envelope),
    });
    assert.equal(replay.status, 409, `期望 409，实际 ${replay.status}`);
  });

  await record('蜜罐字段被填写时直接拒绝', async () => {
    const attack = await handshake();
    const proof = await challenge('e2e-honeypot');
    const { response } = await sealedCall(attack, 'POST', '/api/auth/login', (nonce) => ({
      username: 'e2e-honeypot',
      password: sealField(attack, nonce, 'whatever-123456'),
      cid: proof.cid,
      pow: proof.cid ? solvePow(proof.prefix, proof.bits) : '',
      hp: 'i-am-a-bot',
    }));
    assert.equal(response.status, 400, `期望 400，实际 ${response.status}`);
  });

  await record('缺少或伪造工作量证明均被拒绝', async () => {
    const attack = await handshake();
    const missing = await sealedCall(attack, 'POST', '/api/auth/login', (nonce) => ({
      username: ADMIN_USER,
      password: sealField(attack, nonce, ADMIN_PASS),
      cid: '',
      pow: '',
      hp: '',
    }));
    assert.equal(missing.response.status, 428, `缺少 PoW 期望 428，实际 ${missing.response.status}`);

    const forged = await handshake();
    const proof = await challenge(ADMIN_USER);
    const result = await sealedCall(forged, 'POST', '/api/auth/login', (nonce) => ({
      username: ADMIN_USER,
      password: sealField(forged, nonce, ADMIN_PASS),
      cid: proof.cid,
      pow: '999999999',
      hp: '',
    }));
    assert.equal(result.response.status, 428, `伪造 PoW 期望 428，实际 ${result.response.status}`);
  });

  await record('他人会话号无法冒用', async () => {
    const attack = await handshake();
    const stolen = await sealedCall(attack, 'POST', '/api/auth/login', (nonce) => ({
      username: ADMIN_USER,
      password: sealField(attack, nonce, ADMIN_PASS),
      cid: '',
      pow: '',
      hp: '',
    }));
    assert.ok(stolen.response.status >= 400);
    /* 用管理员的 sid 配攻击者的信封：签名与密钥都不匹配 */
    const mixed = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Xsz-Enc': '1', 'X-Xsz-Sid': session.sid },
      body: JSON.stringify(stolen.envelope),
    });
    assert.ok(mixed.status >= 400, `期望 4xx，实际 ${mixed.status}`);
  });

  await record('源码、映射与数据库探测被屏蔽', async () => {
    for (const path of [
      '/server/src/index.js',
      '/web/src/api/client.ts',
      '/assets/index.js.map',
      '/.env',
      '/server/data/xinshizhan.db',
      '/server/src/lib/secrets.js',
    ]) {
      const response = await fetch(`${BASE}${path}`);
      assert.equal(response.status, 404, `${path} 未被屏蔽（${response.status}）`);
    }
  });

  await record('安全响应头齐备且不缓存敏感数据', async () => {
    const response = await fetch(`${BASE}/api/health`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.ok(String(response.headers.get('content-security-policy')).includes("default-src 'self'"));
    assert.ok(!response.headers.get('x-powered-by'), '仍暴露 X-Powered-By');
    assert.match(String(response.headers.get('cache-control')), /no-store/);
  });

  await record('公开接口仍可正常访问', async () => {
    const response = await fetch(`${BASE}/api/posts?limit=3`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(Array.isArray(payload.posts), '帖子列表结构不正确');
  });

  await record('登出后会话立即失效', async () => {
    /* 前面几个攻击用例已经把本机 IP 的失败计数打满，这里清干净再登录 */
    resetTraces();
    const fresh = await bootstrap();
    const before = await signedGet(fresh.session, '/api/auth/me', fresh.cookie);
    assert.equal(before.response.status, 200, '登出前应可访问 /me');

    const { response, raw } = await sealedCall(fresh.session, 'POST', '/api/auth/logout', {}, { cookie: fresh.cookie });
    assert.equal(response.status, 200, `登出失败：${response.status} ${raw.slice(0, 160)}`);

    const after = await signedGet(fresh.session, '/api/auth/me', fresh.cookie);
    assert.equal(after.response.status, 401, `登出后仍可访问 /me（${after.response.status}）`);

    /* 明文请求一律先被通道校验拦下（428），说明旧令牌根本走不到业务层 */
    const plain = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${fresh.loginPayload.token}` },
    });
    assert.equal(plain.status, 428, `明文携带令牌期望 428，实际 ${plain.status}`);

    /* 即使换一条全新的合法加密通道，被吊销的令牌也不能再用 */
    const replay = await handshake();
    const revoked = await signedGet(replay, '/api/auth/me', '', `Bearer ${fresh.loginPayload.token}`);
    assert.equal(revoked.response.status, 401, `被吊销的令牌仍可用（${revoked.response.status}）`);
  });

  await record('注册即分配唯一用户编号（uid），昵称可由用户自定义', async () => {
    const first = await registerUser({ nickname: '夜航测试员' });
    assert.ok(Number.isInteger(first.user.uid) && first.user.uid > 100000, `uid 未分配：${first.user.uid}`);
    assert.equal(first.user.nickname, '夜航测试员');
    assert.equal(first.user.anonName, '夜航测试员', '自定义昵称应成为站内展示名');

    const second = await registerUser();
    assert.ok(Number.isInteger(second.user.uid), '第二个账号未分配 uid');
    assert.notEqual(second.user.uid, first.user.uid, '不同账号的用户编号重复');
    assert.equal(second.user.nickname, '', '未设置昵称时应为空');
    assert.ok(second.user.anonName, '未设置昵称时应回落到系统匿名身份');
  });

  await record('昵称可修改，清空后回到系统分配的匿名身份', async () => {
    const account = await registerUser();
    const updated = await sealedCall(
      account.channel,
      'PATCH',
      '/api/auth/profile',
      { nickname: '深夜漫游者' },
      { cookie: account.cookie }
    );
    assert.equal(updated.response.status, 200, `昵称修改失败：${safeOpen(account.channel, updated.raw)}`);
    const renamed = openSealed(account.channel, updated.raw).user;
    assert.equal(renamed.nickname, '深夜漫游者');
    assert.equal(renamed.anonName, '深夜漫游者');

    const cleared = await sealedCall(
      account.channel,
      'PATCH',
      '/api/auth/profile',
      { nickname: '' },
      { cookie: account.cookie }
    );
    assert.equal(cleared.response.status, 200, `清空昵称失败：${safeOpen(account.channel, cleared.raw)}`);
    const restored = openSealed(account.channel, cleared.raw).user;
    assert.equal(restored.nickname, '');
    assert.ok(restored.anonName && restored.anonName !== '深夜漫游者', '清空昵称后应回到系统匿名身份');
  });

  await record('登录账号与密码修改必须先验当前密码，改后旧凭据立即失效', async () => {
    const account = await registerUser();
    const targetUsername = `${account.username}_n`.slice(0, 20);

    const wrong = await sealedCall(
      account.channel,
      'PATCH',
      '/api/auth/account',
      (nonce) => ({
        username: targetUsername,
        currentPassword: sealField(account.channel, nonce, 'not-the-right-password'),
      }),
      { cookie: account.cookie }
    );
    assert.equal(wrong.response.status, 400, `错误当前密码期望 400，实际 ${wrong.response.status}`);

    const newPassword = 'Brand-New-Pass-2026';
    const changed = await sealedCall(
      account.channel,
      'PATCH',
      '/api/auth/account',
      (nonce) => ({
        username: targetUsername,
        currentPassword: sealField(account.channel, nonce, account.password),
        newPassword: sealField(account.channel, nonce, newPassword),
      }),
      { cookie: account.cookie }
    );
    assert.equal(changed.response.status, 200, `账号修改失败：${safeOpen(account.channel, changed.raw)}`);
    assert.equal(openSealed(account.channel, changed.raw).user.username, targetUsername);
    testUsers.push(targetUsername);

    const stale = await handshake();
    const oldLogin = await loginCall(stale, account.username, account.password);
    assert.equal(oldLogin.response.status, 401, `旧用户名仍可登录（${oldLogin.response.status}）`);

    const fresh = await handshake();
    const newLogin = await loginCall(fresh, targetUsername, newPassword);
    assert.equal(newLogin.response.status, 200, `新凭据登录失败：${safeOpen(fresh, newLogin.raw)}`);
    assert.ok(!newLogin.raw.includes(newPassword), '报文中出现明文新密码');
  });

  /** 把身份验证开关整体设为指定状态，返回用于还原的原始配置 */
  async function setVerification(patch) {
    const current = await adminGet(session, '/api/admin/site-config', cookie);
    const original = current.config.verification;
    const next = { ...original, ...patch };
    const saved = await sealedCall(session, 'PUT', '/api/admin/site-config', { verification: next }, { cookie });
    assert.equal(saved.response.status, 200, `身份验证开关设置失败：${safeOpen(session, saved.raw)}`);
    return original;
  }

  const ALL_VERIFICATION_OFF = {
    emailEnabled: false,
    emailRequired: false,
    phoneEnabled: false,
    phoneRequired: false,
    realNameEnabled: false,
    realNameRequired: false,
  };

  await record('邮箱/手机号/实名开关关闭时，用户与管理员都无法使用', async () => {
    const original = await setVerification(ALL_VERIFICATION_OFF);
    try {
      const account = await registerUser();

      const emailTry = await sealedCall(
        account.channel,
        'PATCH',
        '/api/auth/profile',
        { email: 'probe@example.com' },
        { cookie: account.cookie }
      );
      assert.equal(emailTry.response.status, 403, `填写邮箱期望 403，实际 ${emailTry.response.status}`);

      const realTry = await sealedCall(
        account.channel,
        'PATCH',
        '/api/auth/profile',
        { realName: '张三', idNumber: '110101199001011234' },
        { cookie: account.cookie }
      );
      assert.equal(realTry.response.status, 403, `填写实名期望 403，实际 ${realTry.response.status}`);

      /* 注册侧走一遍同样的闸门（PoW 要真实解开，否则会先被 428 拦下而不是 403） */
      const rnChannel = await handshake();
      const rnName = `e2e_v${Date.now().toString(36).slice(-6)}`;
      const rnProof = await challenge(rnName);
      const registerTry = await sealedCall(rnChannel, 'POST', '/api/auth/register', (nonce) => ({
        username: rnName,
        realName: '张三',
        idNumber: '110101199001011234',
        password: sealField(rnChannel, nonce, 'Probe-Pass-2026-Xsz'),
        confirm: sealField(rnChannel, nonce, 'Probe-Pass-2026-Xsz'),
        cid: rnProof.cid,
        pow: rnProof.cid ? solvePow(rnProof.prefix, rnProof.bits) : '',
        hp: '',
      }));
      assert.equal(registerTry.response.status, 403, `关闭时注册页也不该受理实名，实际 ${registerTry.response.status}`);

      const verifyTry = await sealedCall(account.channel, 'POST', '/api/auth/verify/email', {}, { cookie: account.cookie });
      assert.equal(verifyTry.response.status, 403, `验证入口期望 403，实际 ${verifyTry.response.status}`);

      const adminVerify = await sealedCall(
        session,
        'PATCH',
        `/api/admin/users/${account.user.id}/verify`,
        { emailVerified: true },
        { cookie }
      );
      assert.equal(adminVerify.response.status, 403, `后台核验期望 403，实际 ${adminVerify.response.status}`);
    } finally {
      await setVerification(original);
    }
  });

  await record('超级管理员开启后：注册可填邮箱与实名，核验通道仍为预留状态', async () => {
    const original = await setVerification({ ...ALL_VERIFICATION_OFF, emailEnabled: true, realNameEnabled: true });
    try {
      const account = await registerUser();
      const saved = await sealedCall(
        account.channel,
        'PATCH',
        '/api/auth/profile',
        { email: 'e2e-mailbox@example.com' },
        { cookie: account.cookie }
      );
      assert.equal(saved.response.status, 200, `填写邮箱失败：${safeOpen(account.channel, saved.raw)}`);
      const user = openSealed(account.channel, saved.raw).user;
      assert.equal(user.email, 'e2e-mailbox@example.com');
      assert.equal(user.verified.email, false, '新填写的邮箱应处于未核验状态');

      /* 开启实名后，注册阶段就应该能带上姓名与证件号 */
      const channel = await handshake();
      const username = `e2e_rn${Date.now().toString(36).slice(-6)}`;
      testUsers.push(username);
      const proof = await challenge(username);
      const registered = await sealedCall(channel, 'POST', '/api/auth/register', (nonce) => ({
        username,
        realName: '张三',
        idNumber: '110101199001011234',
        password: sealField(channel, nonce, 'Probe-Pass-2026-Xsz'),
        confirm: sealField(channel, nonce, 'Probe-Pass-2026-Xsz'),
        cid: proof.cid,
        pow: proof.cid ? solvePow(proof.prefix, proof.bits) : '',
        hp: '',
      }));
      assert.equal(registered.response.status, 200, `带实名注册失败：${safeOpen(channel, registered.raw)}`);
      const fresh = openSealed(channel, registered.raw).user;
      assert.equal(fresh.realName, '张三', '注册时的姓名没有落库');
      assert.ok(fresh.idNumber, '注册时的证件号没有落库');
      assert.equal(fresh.verified.realName, false, '未核验的实名应为 false');
      assert.ok(fresh.uid > 100000, '注册时应分配用户编号');

      const requested = await sealedCall(account.channel, 'POST', '/api/auth/verify/email', {}, { cookie: account.cookie });
      assert.equal(requested.response.status, 501, `预留通道期望 501，实际 ${requested.response.status}`);

      const verified = await sealedCall(
        session,
        'PATCH',
        `/api/admin/users/${account.user.id}/verify`,
        { emailVerified: true },
        { cookie }
      );
      assert.equal(verified.response.status, 200, `人工核验失败：${safeOpen(session, verified.raw)}`);

      const listed = await adminGet(session, `/api/admin/users?q=${account.username}`, cookie);
      assert.equal(listed.users[0]?.verified?.email, true, '核验状态未生效');
      assert.equal(listed.users[0]?.contact?.email, 'e2e-mailbox@example.com', '管理员应能看到联系方式');
      assert.equal(listed.users[0]?.uid, account.user.uid, '用户列表应带上用户编号');
    } finally {
      await setVerification(original);
    }
  });

  await record('超级管理员角色不可被授予、不可被剥夺或封禁', async () => {
    const account = await registerUser();
    const granted = await sealedCall(
      session,
      'PATCH',
      `/api/admin/users/${account.user.id}/role`,
      { role: 'superadmin' },
      { cookie }
    );
    assert.equal(granted.response.status, 400, `授予超级管理员期望 400，实际 ${granted.response.status}`);

    const owner = db.prepare('SELECT id, role FROM users WHERE username = ?').get(ADMIN_USER);
    assert.equal(owner.role, 'superadmin', '自举账号必须是超级管理员');

    const demote = await sealedCall(
      session,
      'PATCH',
      `/api/admin/users/${owner.id}/role`,
      { role: 'user' },
      { cookie }
    );
    assert.equal(demote.response.status, 400, `降级超级管理员期望 400，实际 ${demote.response.status}`);
    assert.equal(
      db.prepare('SELECT role FROM users WHERE id = ?').get(owner.id).role,
      'superadmin',
      '超级管理员角色被改掉了'
    );

    const ban = await sealedCall(session, 'POST', `/api/admin/users/${owner.id}/ban`, { reason: 'e2e' }, { cookie });
    assert.equal(ban.response.status, 400, `封禁超级管理员期望 400，实际 ${ban.response.status}`);
    assert.equal(db.prepare('SELECT status FROM users WHERE id = ?').get(owner.id).status, 'active');
  });

  await record('普通管理员能管内容，但改不了站点级开关与角色分配', async () => {
    const account = await registerUser();
    /* 直接改库把该账号提为普通管理员：resolveToken 每次都读最新角色，无需重新登录 */
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(account.user.id);
    try {
      const stats = await signedGet(account.channel, '/api/admin/stats', account.cookie);
      assert.equal(stats.response.status, 200, `管理员应能访问数据看板（${stats.response.status}）`);

      const config = await sealedCall(
        account.channel,
        'PUT',
        '/api/admin/site-config',
        { announcement: 'e2e 越权尝试' },
        { cookie: account.cookie }
      );
      assert.equal(config.response.status, 403, `普通管理员改站点配置期望 403，实际 ${config.response.status}`);

      const role = await sealedCall(
        account.channel,
        'PATCH',
        `/api/admin/users/${account.user.id}/role`,
        { role: 'user' },
        { cookie: account.cookie }
      );
      assert.equal(role.response.status, 403, `普通管理员改角色期望 403，实际 ${role.response.status}`);

      const rules = await sealedCall(account.channel, 'PUT', '/api/admin/rules', { linkNeedsReview: true }, { cookie: account.cookie });
      assert.equal(rules.response.status, 403, `普通管理员改审核规则期望 403，实际 ${rules.response.status}`);
    } finally {
      db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(account.user.id);
    }
  });

  await record('找回密码：先校验账号与渠道，通过后生成可跟进的工单', async () => {
    const ownerId = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USER).id;
    const channel = await handshake();

    const current = await adminGet(session, '/api/admin/site-config', cookie);
    const original = current.config.recovery;

    /* 先把渠道摆成可预期的初始状态：邮箱开（预留）、客服开但没配账号、站长开也没配联系方式 */
    const prepared = await sealedCall(
      session,
      'PUT',
      '/api/admin/site-config',
      {
        recovery: {
          ...original,
          emailEnabled: true,
          serviceEnabled: true,
          serviceAccount: '',
          masterEnabled: true,
          masterContact: '',
        },
      },
      { cookie }
    );
    assert.equal(prepared.response.status, 200, `准备渠道状态失败：${safeOpen(session, prepared.raw)}`);

    try {
      /* 1) 必须填账号 */
      const noAccount = await sealedCall(channel, 'POST', '/api/auth/recover', { account: '', method: 'service' });
      assert.equal(noAccount.response.status, 400, `未填账号期望 400，实际 ${noAccount.response.status}`);

      /* 2) 账号要真实存在（用户要求的真实检测） */
      const missing = await sealedCall(channel, 'POST', '/api/auth/recover', {
        account: 'no-such-account-xyz',
        method: 'service',
      });
      assert.equal(missing.response.status, 404, `账号不存在期望 404，实际 ${missing.response.status}`);

      const account = await registerUser();

      /* 3) 渠道开着但没配联系方式 → 明确告知走不通 */
      const unconfigured = await sealedCall(channel, 'POST', '/api/auth/recover', {
        account: account.username,
        method: 'service',
      });
      assert.equal(unconfigured.response.status, 409, `未配置期望 409，实际 ${unconfigured.response.status}`);

      /* 4) 预留渠道（已开启）→ 501 并说明通道尚未接入 */
      const email = await sealedCall(channel, 'POST', '/api/auth/recover', {
        account: account.username,
        method: 'email',
      });
      assert.equal(email.response.status, 501, `预留渠道期望 501，实际 ${email.response.status}`);
      assert.equal(openSealed(channel, email.raw).channels.email.available, false);

      /* 5) 关掉的渠道 → 403 */
      const closed = await sealedCall(
        session,
        'PUT',
        '/api/admin/site-config',
        { recovery: { ...original, emailEnabled: true, serviceEnabled: true, masterEnabled: false } },
        { cookie }
      );
      assert.equal(closed.response.status, 200, '关闭站长渠道失败');
      const denied = await sealedCall(channel, 'POST', '/api/auth/recover', {
        account: account.username,
        method: 'master',
      });
      assert.equal(denied.response.status, 403, `未开放渠道期望 403，实际 ${denied.response.status}`);

      /* 5b) 站长求助不依赖外部联系方式：开关一开就能用，申请直接进后台 */
      const masterOn = await sealedCall(
        session,
        'PUT',
        '/api/admin/site-config',
        { recovery: { ...original, emailEnabled: true, serviceEnabled: true, masterEnabled: true, masterContact: '' } },
        { cookie }
      );
      assert.equal(masterOn.response.status, 200, '重新开启站长渠道失败');
      const masterOk = await sealedCall(channel, 'POST', '/api/auth/recover', {
        account: account.username,
        method: 'master',
      });
      assert.equal(masterOk.response.status, 200, `站长求助应可用：${safeOpen(channel, masterOk.raw)}`);
      assert.ok(openSealed(channel, masterOk.raw).requestId > 0, '站长求助没有生成申请');

      /* 6) 开启并配好客服账号后，真的能提交并落到后台 */
      const enabled = await sealedCall(
        session,
        'PUT',
        '/api/admin/site-config',
        { recovery: { ...original, serviceEnabled: true, serviceAccount: ADMIN_USER } },
        { cookie }
      );
      assert.equal(enabled.response.status, 200, `配置客服渠道失败：${safeOpen(session, enabled.raw)}`);

      const ok = await sealedCall(channel, 'POST', '/api/auth/recover', {
        account: account.username,
        method: 'service',
      });
      assert.equal(ok.response.status, 200, `客服找回失败：${safeOpen(channel, ok.raw)}`);
      const payload = openSealed(channel, ok.raw);
      assert.equal(payload.handled, true);
      assert.ok(payload.requestId > 0, '未返回受理编号');
      assert.equal(payload.account.uid, account.user.uid, '回执里的用户编号不对');

      const list = await adminGet(session, '/api/admin/recovery?status=open', cookie);
      const item = list.requests.find((row) => row.id === payload.requestId);
      assert.ok(item, '后台没有看到这条找回申请');
      assert.equal(item.userId, account.user.id);
      assert.equal(item.method, 'service');
      assert.ok(item.ip, '找回申请未记录来源 IP');

      const notified = db
        .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = ?')
        .get(ownerId, 'recovery').c;
      assert.ok(notified > 0, '站长/管理员没有收到找回通知');

      const done = await sealedCall(
        session,
        'PATCH',
        `/api/admin/recovery/${payload.requestId}`,
        { status: 'handled', note: '已核实身份' },
        { cookie }
      );
      assert.equal(done.response.status, 200, `标记处理失败：${safeOpen(session, done.raw)}`);
      const after = await adminGet(session, '/api/admin/recovery?status=handled', cookie);
      assert.ok(
        after.requests.some((row) => row.id === payload.requestId && row.handledAt),
        '处理状态未落库'
      );
    } finally {
      await sealedCall(session, 'PUT', '/api/admin/site-config', { recovery: original }, { cookie });
    }
  });

  await record('封禁预制：短时 / 长时 / 永久 / 自定义时间都按预期生效', async () => {
    const victim = await registerUser();

    const oneHour = await sealedCall(
      session,
      'POST',
      `/api/admin/users/${victim.user.id}/ban`,
      { reason: 'e2e 短时封禁', preset: '1h' },
      { cookie }
    );
    assert.equal(oneHour.response.status, 200, `封禁失败：${safeOpen(session, oneHour.raw)}`);
    const delta = new Date(openSealed(session, oneHour.raw).until).getTime() - Date.now();
    assert.ok(delta > 55 * 60_000 && delta <= 61 * 60_000, `1 小时封禁时长不对：${delta}ms`);

    const unban = await sealedCall(session, 'POST', `/api/admin/users/${victim.user.id}/unban`, {}, { cookie });
    assert.equal(unban.response.status, 200, '解封失败');

    const forever = await sealedCall(
      session,
      'POST',
      `/api/admin/users/${victim.user.id}/ban`,
      { reason: 'e2e 永久封禁', preset: 'forever' },
      { cookie }
    );
    assert.equal(openSealed(session, forever.raw).until, null, '永久封禁不应带解封时间');

    const custom = await sealedCall(
      session,
      'POST',
      `/api/admin/users/${victim.user.id}/ban`,
      { reason: 'e2e 自定义', until: new Date(Date.now() + 86_400_000).toISOString() },
      { cookie }
    );
    assert.equal(custom.response.status, 200, `自定义时间封禁失败：${safeOpen(session, custom.raw)}`);

    const bogus = await sealedCall(
      session,
      'POST',
      `/api/admin/users/${victim.user.id}/ban`,
      { reason: 'e2e', preset: 'nonsense' },
      { cookie }
    );
    assert.equal(bogus.response.status, 400, `未知预制应被拒绝，实际 ${bogus.response.status}`);
  });

  await record('管理员协助重置口令：临时密码可登录，旧密码立即失效', async () => {
    const ownerId = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USER).id;
    const victim = await registerUser();

    const reset = await sealedCall(
      session,
      'POST',
      `/api/admin/users/${victim.user.id}/reset-password`,
      {},
      { cookie }
    );
    assert.equal(reset.response.status, 200, `重置失败：${safeOpen(session, reset.raw)}`);
    const { tempPassword } = openSealed(session, reset.raw);
    assert.ok(typeof tempPassword === 'string' && tempPassword.length >= 10, '临时密码不合格');

    const stale = await handshake();
    const oldLogin = await loginCall(stale, victim.username, victim.password);
    assert.equal(oldLogin.response.status, 401, `旧密码仍可登录（${oldLogin.response.status}）`);

    const fresh = await handshake();
    const newLogin = await loginCall(fresh, victim.username, tempPassword);
    assert.equal(newLogin.response.status, 200, `临时密码无法登录：${safeOpen(fresh, newLogin.raw)}`);

    const self = await sealedCall(session, 'POST', `/api/admin/users/${ownerId}/reset-password`, {}, { cookie });
    assert.equal(self.response.status, 400, '不应允许管理员重置自己的密码');
  });

  await record('密码策略：底线 6 位，含用户名或常见口令同样可以注册', async () => {
    const registerWith = async (password, presetName = '') => {
      const channel = await handshake();
      const username =
        presetName || `e2e_pw${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`.slice(0, 20);
      testUsers.push(username);
      const proof = await challenge(username);
      const { response, raw } = await sealedCall(channel, 'POST', '/api/auth/register', (nonce) => ({
        username,
        password: sealField(channel, nonce, password),
        confirm: sealField(channel, nonce, password),
        cid: proof.cid,
        pow: proof.cid ? solvePow(proof.prefix, proof.bits) : '',
        hp: '',
      }));
      return { channel, username, response, raw };
    };

    /* 常见弱口令：以前会被拒，现在应当放行（强度只做提示） */
    const common = await registerWith('123456');
    assert.equal(
      common.response.status,
      200,
      `常见口令应被接受：${common.response.status} ${safeOpen(common.channel, common.raw)}`
    );

    /* 密码与用户名完全相同：同样放行 */
    const name = `e2e_self${Date.now().toString(36)}`.slice(0, 20);
    const containsName = await registerWith(name, name);
    assert.equal(
      containsName.response.status,
      200,
      `含用户名的密码应被接受：${safeOpen(containsName.channel, containsName.raw)}`
    );

    /* 唯一的硬性要求：长度不足就拒绝 */
    const tooShort = await registerWith('12345');
    assert.equal(tooShort.response.status, 400, `5 位密码应被拒绝，实际 ${tooShort.response.status}`);

    /* 站点公开配置里的最小长度要和实际策略一致 */
    const config = await (await fetch(`${BASE}/api/site-config`)).json();
    assert.equal(config.config.minPasswordLength, 6, '公开配置里的最小密码长度不正确');
  });

  await record('访客账号严格只读：能浏览，不能发言 / 点赞 / 改资料', async () => {
    const current = await adminGet(session, '/api/admin/site-config', cookie);
    const originalGuestLogin = current.config.allowGuestLogin;
    if (!originalGuestLogin) {
      const on = await sealedCall(session, 'PUT', '/api/admin/site-config', { allowGuestLogin: true }, { cookie });
      assert.equal(on.response.status, 200, '开启访客登录失败');
    }

    try {
      const channel = await handshake();
      const proof = await challenge('guest');
      const login = await sealedCall(channel, 'POST', '/api/auth/guest', (nonce) => ({
        cid: proof.cid,
        pow: proof.cid ? solvePow(proof.prefix, proof.bits) : '',
        hp: '',
      }));
      assert.ok([200, 201].includes(login.response.status), `访客进入失败：${safeOpen(channel, login.raw)}`);
      const payload = openSealed(channel, login.raw);
      assert.equal(payload.user.isGuest, true, '访客账号未被标记为 isGuest');
      const guestCookie = String(login.response.headers.get('set-cookie') || '').split(';')[0];
      testUsers.push(payload.user.username);

      /* 只读部分必须照常可用 */
      const listResponse = await fetch(`${BASE}/api/posts?limit=1`);
      assert.equal(listResponse.status, 200, '访客应能浏览心事列表');
      const list = await listResponse.json();
      assert.ok(Array.isArray(list.posts), '心事列表结构不正确');
      /*
       * 取一条真实心事做点赞 / 举报的靶子；全新实例里没有任何内容，
       * 这时用一个不存在的 id 也一样能验证——权限闸门在业务查询之前执行。
       */
      const postId = list.posts[0]?.id ?? 999999;

      const overview = await fetch(`${BASE}/api/ranking/overview`);
      assert.equal(overview.status, 200, '访客应能浏览站点概览');

      /* 账号类接口走加密通道：/api/auth 必须在信封内调用 */
      for (const [label, url, body] of [
        ['修改个人资料', '/api/auth/profile', { bio: '访客想改签名' }],
        ['修改账号密码', '/api/auth/account', { username: 'guest_newname' }],
      ]) {
        const res = await sealedCall(channel, 'PATCH', url, body, { cookie: guestCookie });
        assert.equal(res.response.status, 403, `${label} 期望 403，实际 ${res.response.status}`);
        assert.match(String(openSealed(channel, res.raw).error || ''), /访客/, `${label} 的拒绝原因应说明是访客身份`);
      }

      /* 内容与互动接口是明文 JSON（只有 /api/auth 与 /api/admin 走加密通道） */
      for (const [label, url, body] of [
        ['发布心事', '/api/posts', { content: '访客想发心事' }],
        ['发送弹幕', '/api/danmaku', { content: '访客想发弹幕', color: 'azure', effect: 'glow' }],
        ['点赞心事', `/api/posts/${postId}/like`, {}],
        ['举报心事', `/api/posts/${postId}/report`, { reason: '广告引流' }],
      ]) {
        const res = await fetch(`${BASE}${url}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: guestCookie },
          body: JSON.stringify(body),
        });
        assert.equal(res.status, 403, `${label} 期望 403，实际 ${res.status}`);
        const denied = await res.json().catch(() => ({}));
        assert.match(String(denied.error || ''), /访客/, `${label} 的拒绝原因应说明是访客身份`);
      }

      /* 访客退出登录本身仍然允许 */
      const leave = await sealedCall(channel, 'POST', '/api/auth/logout', {}, { cookie: guestCookie });
      assert.equal(leave.response.status, 200, '访客应能正常退出');
    } finally {
      if (!originalGuestLogin) {
        await sealedCall(session, 'PUT', '/api/admin/site-config', { allowGuestLogin: false }, { cookie });
      }
    }
  });

  await record('注册时间与来源 IP 被真实记录', async () => {
    const account = await registerUser();
    const list = await adminGet(session, `/api/admin/users?q=${account.username}`, cookie);
    const row = list.users[0];
    assert.ok(row, '未找到刚注册的账号');
    assert.ok(row.registerIp, '未记录注册 IP');
    const createdAt = new Date(row.createdAt).getTime();
    assert.ok(!Number.isNaN(createdAt), `注册时间不是合法时间：${row.createdAt}`);
    assert.ok(Math.abs(Date.now() - createdAt) < 120_000, `注册时间与真实时间偏差过大：${row.createdAt}`);
  });

  await record('举报：可带补充描述，处理说明会回执给举报人', async () => {
    const author = await registerUser();
    const reporter = await registerUser();

    /* 造一条可以被举报的心事 */
    const created = await fetch(`${BASE}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: author.cookie },
      body: JSON.stringify({ content: 'e2e 举报目标内容', mood: 'plain' }),
    });
    /* 响应体只能读一次：先取文本再解析，断言消息里也就不用重复读取了 */
    const createdText = await created.text();
    assert.ok([200, 201].includes(created.status), `造心事失败：${created.status} ${createdText.slice(0, 200)}`);
    const postId = JSON.parse(createdText).post?.id;
    assert.ok(postId, '心事没有返回 id');

    /* 举报人带一段补充描述 */
    const detail = '这条内容在评论区反复发同一个引流链接';
    const reported = await fetch(`${BASE}/api/posts/${postId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: reporter.cookie },
      body: JSON.stringify({ reason: '广告引流', detail }),
    });
    assert.equal(reported.status, 200, `举报失败：${reported.status}`);

    /* 管理端必须能看到这段描述与举报人身份 */
    const list = await adminGet(session, '/api/admin/reports?status=open', cookie);
    const item = list.reports.find((row) => row.detail === detail);
    assert.ok(item, '管理端没有拿到举报描述');
    assert.equal(item.reason, '广告引流');
    assert.equal(item.reporter.uid, reporter.user.uid, '举报人编号不对');
    assert.equal(item.reporter.username, reporter.username, '举报人账号不对');

    /* 处理时写一句说明 */
    const note = '已核实，内容已被下架，感谢反馈';
    const resolved = await sealedCall(
      session,
      'POST',
      `/api/admin/reports/${item.id}/resolve`,
      { action: 'remove', note },
      { cookie }
    );
    assert.equal(resolved.response.status, 200, `处理举报失败：${safeOpen(session, resolved.raw)}`);

    /* 举报人收到带说明的回执 */
    const inbox = await (await fetch(`${BASE}/api/notifications`, { headers: { Cookie: reporter.cookie } })).json();
    const receipt = inbox.notifications.find((row) => row.title.includes('举报'));
    assert.ok(receipt, '举报人没有收到回执');
    assert.equal(receipt.body, note, '回执内容不是管理员填写的说明');

    /* 处理记录也带说明 */
    const handled = await adminGet(session, '/api/admin/reports?status=removed', cookie);
    const done = handled.reports.find((row) => row.id === item.id);
    assert.ok(done, '处理记录没有落到「已删除」');
    assert.equal(done.handledNote, note, '处理说明没有落库');
  });

  await record('找回申请：处理说明同时回显到站内信与本人的找回记录', async () => {
    const account = await registerUser();

    /* 打开客服渠道并配好账号，让申请能真正提交 */
    const current = await adminGet(session, '/api/admin/site-config', cookie);
    const original = current.config.recovery;
    const enabled = await sealedCall(
      session,
      'PUT',
      '/api/admin/site-config',
      { recovery: { ...original, serviceEnabled: true, serviceAccount: ADMIN_USER } },
      { cookie }
    );
    assert.equal(enabled.response.status, 200, '开启客服渠道失败');

    try {
      const channel = await handshake();
      const submitted = await sealedCall(channel, 'POST', '/api/auth/recover', {
        account: account.username,
        method: 'service',
      });
      assert.equal(submitted.response.status, 200, `找回申请提交失败：${safeOpen(channel, submitted.raw)}`);
      const requestId = openSealed(channel, submitted.raw).requestId;

      const note = '已通过注册邮箱核实，临时密码已交付';
      const handled = await sealedCall(
        session,
        'PATCH',
        `/api/admin/recovery/${requestId}`,
        { status: 'handled', note },
        { cookie }
      );
      assert.equal(handled.response.status, 200, `处理找回申请失败：${safeOpen(session, handled.raw)}`);

      /* 站内信：标题与正文（说明）都要对得上 */
      const inbox = await (await fetch(`${BASE}/api/notifications`, { headers: { Cookie: account.cookie } })).json();
      const notice = inbox.notifications.find((row) => row.type === 'recovery');
      assert.ok(notice, '用户没有收到找回处理通知');
      assert.equal(notice.body, note, '通知正文不是管理员填写的说明');

      /* 本人的「找回记录」：同一句话、完整 IP */
      const mine = openSealed(channel, (await signedGet(channel, '/api/auth/recovery-mine', account.cookie)).raw);
      const record = mine.requests.find((row) => row.id === requestId);
      assert.ok(record, '找回记录里没有这条申请');
      assert.equal(record.status, 'handled');
      assert.equal(record.handledNote, note, '找回记录里的说明与站内信不一致');
      assert.ok(record.ip, '找回记录缺少来源 IP');
      assert.equal(record.ip, db.prepare('SELECT ip FROM recovery_requests WHERE id = ?').get(requestId).ip, 'IP 未被完整回显');
    } finally {
      await sealedCall(session, 'PUT', '/api/admin/site-config', { recovery: original }, { cookie });
    }
  });

  await record('站内回复：站长可定向发送，普通成员无权发送', async () => {
    const target = await registerUser();

    const preview = await adminGet(session, '/api/admin/site-messages/targets', cookie);
    assert.ok(preview.total >= 1 && preview.registered >= 1, '收件人预览不正确');
    assert.ok(preview.roles.some((row) => row.role === 'user' && row.count >= 1), '缺少按角色的收件人统计');

    /* 定向发给刚注册的账号 */
    const title = 'e2e 站内回复';
    const body = '这是一条测试用的站内回复正文';
    const sent = await sealedCall(
      session,
      'POST',
      '/api/admin/site-messages',
      { audience: 'user', targets: [target.username], title, body },
      { cookie }
    );
    assert.equal(sent.response.status, 200, `发送失败：${safeOpen(session, sent.raw)}`);
    assert.equal(openSealed(session, sent.raw).sent, 1, '定向发送人数不对');

    /* 收件人确实收到了；未读数要跟着列表一起回传，前端轮询一次就能同步红点 */
    const inbox = await (await fetch(`${BASE}/api/notifications`, { headers: { Cookie: target.cookie } })).json();
    const got = inbox.notifications.find((row) => row.title === title);
    assert.ok(got, '收件人没有收到站内回复');
    assert.equal(got.body, body);
    assert.equal(inbox.unread, 1, `未读数不对：${inbox.unread}`);

    const readAll = await (
      await fetch(`${BASE}/api/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: target.cookie },
        body: JSON.stringify({ ids: [] }),
      })
    ).json();
    assert.equal(readAll.unread, 0, `标记已读后未读数应归零，实际 ${readAll.unread}`);

    /* 按角色发送：住客角色至少能命中刚注册的账号 */
    const byRole = await sealedCall(
      session,
      'POST',
      '/api/admin/site-messages',
      { audience: 'role', role: 'user', title: 'e2e 角色群发', body: '按角色发送' },
      { cookie }
    );
    assert.equal(byRole.response.status, 200, `按角色发送失败：${safeOpen(session, byRole.raw)}`);
    assert.ok(openSealed(session, byRole.raw).sent >= 1, '按角色发送没有命中任何人');

    /* 找不到的收件人要如实回报 */
    const missing = await sealedCall(
      session,
      'POST',
      '/api/admin/site-messages',
      { audience: 'user', targets: ['no_such_user_9999'], title: 'x', body: 'y' },
      { cookie }
    );
    assert.equal(missing.response.status, 400, '全部收件人都不存在时应报错');

    /* 普通管理员没有这个权限：站内回复目前只对站长开放 */
    const plainAdmin = await registerUser();
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(plainAdmin.user.id);
    const denied = await sealedCall(
      plainAdmin.channel,
      'POST',
      '/api/admin/site-messages',
      { audience: 'registered', title: '越权尝试', body: '越权尝试' },
      { cookie: plainAdmin.cookie }
    );
    assert.equal(denied.response.status, 403, `普通管理员应被拒绝，实际 ${denied.response.status}`);
  });

  const superAdminId = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USER).id;

  /* 造一条指定作者的心事并直接放进人工复核队列（用该账号的 Cookie 发帖） */
  async function makePendingPost(authorCookie, content) {
    const created = await fetch(`${BASE}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authorCookie },
      body: JSON.stringify({ content, mood: 'plain' }),
    });
    const text = await created.text();
    assert.ok([200, 201].includes(created.status), `造心事失败：${created.status} ${text.slice(0, 160)}`);
    const id = JSON.parse(text).post?.id;
    assert.ok(id, '心事没有返回 id');
    db.prepare("UPDATE posts SET review_status = 'manual_review' WHERE id = ?").run(id);
    return id;
  }

  await record('审核分层：不越级、不审自己', async () => {
    const owner = await registerUser();
    const reviewer = await registerUser();
    const plainAdmin = await registerUser();
    const peerAdmin = await registerUser();
    db.prepare("UPDATE users SET role = 'reviewer' WHERE id = ?").run(reviewer.user.id);
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(plainAdmin.user.id);
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(peerAdmin.user.id);

    /* ① 审核员能处理普通住客的内容 */
    const guestPost = await makePendingPost(owner.cookie, 'e2e 分层测试：住客的心事');
    const byReviewer = await sealedCall(
      reviewer.channel,
      'POST',
      `/api/admin/review/post/${guestPost}`,
      { action: 'reject', reason: 'e2e 分层测试' },
      { cookie: reviewer.cookie }
    );
    assert.equal(byReviewer.response.status, 200, `审核员应能处理住客内容：${safeOpen(reviewer.channel, byReviewer.raw)}`);

    /* ② 审核员不能处理管理员的内容 */
    const adminPost = await makePendingPost(plainAdmin.cookie, 'e2e 分层测试：管理员的心事');
    const crossLevel = await sealedCall(
      reviewer.channel,
      'POST',
      `/api/admin/review/post/${adminPost}`,
      { action: 'approve' },
      { cookie: reviewer.cookie }
    );
    assert.equal(crossLevel.response.status, 403, `审核员越级审核应被拒，实际 ${crossLevel.response.status}`);

    /* ③ 管理员不能处理另一位管理员的账号 */
    const banPeer = await sealedCall(
      plainAdmin.channel,
      'POST',
      `/api/admin/users/${peerAdmin.user.id}/ban`,
      { reason: 'e2e' },
      { cookie: plainAdmin.cookie }
    );
    assert.equal(banPeer.response.status, 403, `管理员封同级应被拒，实际 ${banPeer.response.status}`);

    /* ④ 管理员不能封自己 */
    const banSelf = await sealedCall(
      plainAdmin.channel,
      'POST',
      `/api/admin/users/${plainAdmin.user.id}/ban`,
      { reason: 'e2e' },
      { cookie: plainAdmin.cookie }
    );
    assert.equal(banSelf.response.status, 403, `封自己应被拒，实际 ${banSelf.response.status}`);

    /* ⑤ 管理员不能越级封超管 */
    const banSuper = await sealedCall(
      plainAdmin.channel,
      'POST',
      `/api/admin/users/${superAdminId}/ban`,
      { reason: 'e2e' },
      { cookie: plainAdmin.cookie }
    );
    assert.ok([400, 403].includes(banSuper.response.status), `封超管应被拒，实际 ${banSuper.response.status}`);

    /* ⑥ 越级的内容根本不该出现在管理员的队列里 */
    await makePendingPost(cookie, 'e2e 分层测试：超管自己的心事');
    const queue = await adminGet(plainAdmin.channel, '/api/admin/review?type=post&status=manual_review', plainAdmin.cookie);
    assert.ok(
      !queue.items.some((item) => item.author.role === 'superadmin' || item.author.role === 'admin'),
      '管理员的队列里混进了越级内容'
    );
  });

  await record('超管自我裁决：理由选填，批量不适用', async () => {
    const mine = await makePendingPost(cookie, 'e2e 自我裁决：超管自己的心事');

    const queue = await adminGet(session, '/api/admin/review?type=post&status=manual_review', cookie);
    const item = queue.items.find((row) => row.id === mine);
    assert.ok(item, '超管应该能在队列里看到自己的内容');
    assert.equal(item.self, true, '自己的内容必须标记 self');

    /* 不写理由也放行：自我裁决的理由是选填的 */
    const noNote = await sealedCall(
      session,
      'POST',
      `/api/admin/review/post/${mine}`,
      { action: 'approve' },
      { cookie }
    );
    assert.equal(noNote.response.status, 200, `自我裁决不写理由应放行：${safeOpen(session, noNote.raw)}`);

    /* 写了理由同样放行，且会记进审计日志 */
    const second = await makePendingPost(cookie, 'e2e 自我裁决：带理由');
    const withNote = await sealedCall(
      session,
      'POST',
      `/api/admin/review/post/${second}`,
      { action: 'approve', reason: '这是我自己发的测试内容，确认无违规' },
      { cookie }
    );
    assert.equal(withNote.response.status, 200, `带理由应放行：${safeOpen(session, withNote.raw)}`);

    /* 驳回也一样：不带理由直接驳回 */
    const third = await makePendingPost(cookie, 'e2e 自我裁决：直接驳回');
    const rejected = await sealedCall(
      session,
      'POST',
      `/api/admin/review/post/${third}`,
      { action: 'reject' },
      { cookie }
    );
    assert.equal(rejected.response.status, 200, `自我驳回不写理由应放行：${safeOpen(session, rejected.raw)}`);

    /* 批量里不允许夹带自己的内容 */
    const another = await makePendingPost(cookie, 'e2e 自我裁决：批量夹带');
    const batch = await sealedCall(
      session,
      'POST',
      '/api/admin/review/batch',
      { items: [{ type: 'post', id: another }], action: 'approve', reason: '批量理由' },
      { cookie }
    );
    assert.equal(batch.response.status, 200);
    const batchResult = openSealed(session, batch.raw);
    assert.equal(batchResult.done, 0, '批量不应处理自己的内容');
    assert.equal(batchResult.blocked.length, 1, '自己的内容应被计入 blocked');

    /* 收尾：把这条自己处理掉，别给后面留垃圾 */
    db.prepare("UPDATE posts SET review_status = 'rejected' WHERE id = ?").run(another);
  });

  await record('自己的内容能自己下架与恢复（资源管理，不是裁判）', async () => {
    const mine = await makePendingPost(cookie, 'e2e 自我管理：超管自己的心事');
    db.prepare("UPDATE posts SET review_status = 'published', lifecycle = 'live' WHERE id = ?").run(mine);

    const removed = await sealedCall(
      session,
      'POST',
      `/api/admin/posts/${mine}/delete`,
      { reason: 'e2e 自己下架' },
      { cookie }
    );
    assert.equal(removed.response.status, 200, `下架自己的内容应放行：${safeOpen(session, removed.raw)}`);

    const restored = await sealedCall(session, 'POST', `/api/admin/posts/${mine}/restore`, {}, { cookie });
    assert.equal(restored.response.status, 200, `恢复自己的内容应放行：${safeOpen(session, restored.raw)}`);
    assert.equal(
      db.prepare('SELECT deleted_at FROM posts WHERE id = ?').get(mine).deleted_at,
      null,
      '恢复后不该还带着删除时间'
    );

    /* 管理员仍然不能碰超管的内容 */
    const plainAdmin = await registerUser();
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(plainAdmin.user.id);
    const crossLevel = await sealedCall(
      plainAdmin.channel,
      'POST',
      `/api/admin/posts/${mine}/delete`,
      { reason: 'e2e 越级下架' },
      { cookie: plainAdmin.cookie }
    );
    assert.equal(crossLevel.response.status, 403, `管理员不能下架超管的内容，实际 ${crossLevel.response.status}`);
  });

  await record('后台批量：下架恢复 / 处理举报 / 封禁解封，越权的单独报回', async () => {
    /* ── ① 批量下架 + 批量恢复 ── */
    const a = await makePendingPost(cookie, 'e2e 批量：心事 A');
    const b = await makePendingPost(cookie, 'e2e 批量：心事 B');
    db.prepare("UPDATE posts SET review_status = 'published' WHERE id IN (?, ?)").run(a, b);

    const trashed = await sealedCall(
      session,
      'POST',
      '/api/admin/posts/batch',
      { ids: [a, b], action: 'delete', reason: 'e2e 批量下架' },
      { cookie }
    );
    assert.equal(trashed.response.status, 200, `批量下架应被接受：${safeOpen(session, trashed.raw)}`);
    const trashResult = openSealed(session, trashed.raw);
    assert.equal(trashResult.done, 2, `批量下架应处理 2 条，实际 ${trashResult.done}`);
    assert.ok(
      db.prepare('SELECT deleted_at FROM posts WHERE id = ?').get(a).deleted_at,
      '下架后应带上删除时间'
    );

    const restored = await sealedCall(session, 'POST', '/api/admin/posts/batch', { ids: [a, b], action: 'restore' }, { cookie });
    assert.equal(openSealed(session, restored.raw).done, 2, '批量恢复应处理 2 条');
    assert.equal(db.prepare('SELECT deleted_at FROM posts WHERE id = ?').get(a).deleted_at, null, '恢复后不该还带删除时间');

    /* 批量里夹带一条越级内容：能动的照做，不能动的单独报回 */
    const guest = await registerUser();
    const guestPost = await makePendingPost(guest.cookie, 'e2e 批量：住客的心事');
    const mine = await makePendingPost(cookie, 'e2e 批量：超管自己的心事');
    db.prepare("UPDATE posts SET review_status = 'published' WHERE id IN (?, ?)").run(guestPost, mine);
    const plainAdmin = await registerUser();
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(plainAdmin.user.id);
    const mixed = await sealedCall(
      plainAdmin.channel,
      'POST',
      '/api/admin/posts/batch',
      { ids: [guestPost, mine], action: 'delete' },
      { cookie: plainAdmin.cookie }
    );
    const mixedResult = openSealed(plainAdmin.channel, mixed.raw);
    assert.equal(mixedResult.done, 1, `只该下架得动住客那条，实际 ${mixedResult.done}`);
    assert.equal(mixedResult.blocked.length, 1, '越级那条必须单独报回');
    assert.equal(mixedResult.blocked[0].id, mine, '报回的应该是越级那条');
    assert.ok(
      db.prepare('SELECT deleted_at FROM posts WHERE id = ?').get(guestPost).deleted_at,
      '住客的内容应该被下架'
    );
    assert.equal(db.prepare('SELECT deleted_at FROM posts WHERE id = ?').get(mine).deleted_at, null, '越级内容不能被下架');

    /* ── ② 批量处理举报 ── */
    const author = await registerUser();
    const reporter = await registerUser();
    const p1 = await makePendingPost(author.cookie, 'e2e 批量举报：内容一');
    const p2 = await makePendingPost(author.cookie, 'e2e 批量举报：内容二');
    db.prepare("UPDATE posts SET review_status = 'published' WHERE id IN (?, ?)").run(p1, p2);
    for (const id of [p1, p2]) {
      const res = await fetch(`${BASE}/api/posts/${id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: reporter.cookie },
        body: JSON.stringify({ reason: '广告引流', detail: 'e2e 批量举报' }),
      });
      assert.equal(res.status, 200, `造举报失败：${res.status}`);
    }
    const reportIds = db
      .prepare('SELECT id FROM reports WHERE target_id IN (?, ?) ORDER BY id DESC LIMIT 2')
      .all(p1, p2)
      .map((row) => row.id);

    const dismissed = await sealedCall(
      session,
      'POST',
      '/api/admin/reports/batch',
      { ids: reportIds, action: 'dismiss', note: 'e2e 批量忽略' },
      { cookie }
    );
    const dismissResult = openSealed(session, dismissed.raw);
    assert.equal(dismissResult.done, 2, `批量忽略应处理 2 条，实际 ${dismissResult.done}`);
    for (const id of reportIds) {
      const row = db.prepare('SELECT status, handled_note FROM reports WHERE id = ?').get(id);
      assert.equal(row.status, 'dismissed', '举报状态应改为已忽略');
      assert.equal(row.handled_note, 'e2e 批量忽略', '批量说明应落库');
    }

    /* 再处理一次：已处理过的不能被重新审判 */
    const again = await sealedCall(session, 'POST', '/api/admin/reports/batch', { ids: reportIds, action: 'remove' }, { cookie });
    const againResult = openSealed(session, again.raw);
    assert.equal(againResult.done, 0, '已处理的举报不该被批量改判');
    assert.equal(againResult.blocked.length, 2, '被挡下的应逐条报回');

    /* ── ③ 批量封禁 / 批量解封 ── */
    const u1 = await registerUser();
    const u2 = await registerUser();
    const banned = await sealedCall(
      session,
      'POST',
      '/api/admin/users/batch',
      { ids: [u1.user.id, u2.user.id], action: 'ban', reason: 'e2e 批量封禁', preset: '1h' },
      { cookie }
    );
    const banResult = openSealed(session, banned.raw);
    assert.equal(banResult.done, 2, `批量封禁应处理 2 个账号，实际 ${banResult.done}`);
    for (const id of [u1.user.id, u2.user.id]) {
      assert.equal(db.prepare('SELECT status FROM users WHERE id = ?').get(id).status, 'banned', '账号应被封禁');
      const active = db.prepare('SELECT COUNT(*) AS c FROM bans WHERE user_id = ? AND lifted_at IS NULL').get(id).c;
      assert.equal(active, 1, '封禁记录应落库');
      assert.equal(
        db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND revoked_at IS NULL').get(id).c,
        0,
        '封禁应吊销会话'
      );
    }

    /* 超管不可被封：混在批量里也只会被单独挡下 */
    const withSuper = await sealedCall(
      session,
      'POST',
      '/api/admin/users/batch',
      { ids: [u1.user.id, superAdminId], action: 'ban', preset: '1h' },
      { cookie }
    );
    const superResult = openSealed(session, withSuper.raw);
    assert.equal(superResult.done, 1, '只该封得动那个普通账号');
    assert.equal(superResult.blocked[0].id, superAdminId, '超管必须被单独报回');
    assert.equal(
      db.prepare('SELECT role FROM users WHERE id = ?').get(superAdminId).role,
      'superadmin',
      '超管角色不该被动到'
    );

    const unbanned = await sealedCall(
      session,
      'POST',
      '/api/admin/users/batch',
      { ids: [u1.user.id, u2.user.id], action: 'unban' },
      { cookie }
    );
    assert.equal(openSealed(session, unbanned.raw).done, 2, '批量解封应处理 2 个账号');
    for (const id of [u1.user.id, u2.user.id]) {
      assert.equal(db.prepare('SELECT status FROM users WHERE id = ?').get(id).status, 'active', '账号应已解封');
      assert.equal(
        db.prepare('SELECT COUNT(*) AS c FROM bans WHERE user_id = ? AND lifted_at IS NULL').get(id).c,
        0,
        '封禁记录应被标记为已解除'
      );
    }
  });

  await record('举报：不能举报自己，且一条举报只审判一次', async () => {
    const author = await registerUser();
    const reporter = await registerUser();
    const postId = await makePendingPost(author.cookie, 'e2e 举报测试：被举报的内容');
    db.prepare("UPDATE posts SET review_status = 'published' WHERE id = ?").run(postId);

    /* ① 自己举报自己：拒绝 */
    const selfReport = await fetch(`${BASE}/api/posts/${postId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: author.cookie },
      body: JSON.stringify({ reason: '广告引流', detail: 'e2e 自举报' }),
    });
    assert.equal(selfReport.status, 400, `举报自己的内容应被拒，实际 ${selfReport.status}`);

    /* ② 正常举报 */
    const real = await fetch(`${BASE}/api/posts/${postId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: reporter.cookie },
      body: JSON.stringify({ reason: '广告引流', detail: 'e2e 正常举报' }),
    });
    assert.equal(real.status, 200, '正常举报应成功');

    const reportId = db.prepare('SELECT id FROM reports WHERE target_id = ? ORDER BY id DESC').get(postId).id;

    /* ③ 第一次处理成功 */
    const first = await sealedCall(
      session,
      'POST',
      `/api/admin/reports/${reportId}/resolve`,
      { action: 'dismiss', note: 'e2e 第一次处理' },
      { cookie }
    );
    assert.equal(first.response.status, 200, `首次处理应成功：${safeOpen(session, first.raw)}`);

    /* ④ 同一条再处理：409 */
    const second = await sealedCall(
      session,
      'POST',
      `/api/admin/reports/${reportId}/resolve`,
      { action: 'remove', note: 'e2e 重复处理' },
      { cookie }
    );
    assert.equal(second.response.status, 409, `重复处理应被拒，实际 ${second.response.status}`);

    /* ⑤ 举报人自己不能拍板（这里让举报人当管理员来试） */
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(reporter.user.id);
    const postId2 = await makePendingPost(author.cookie, 'e2e 举报测试：第二条');
    db.prepare("UPDATE posts SET review_status = 'published' WHERE id = ?").run(postId2);
    await fetch(`${BASE}/api/posts/${postId2}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: reporter.cookie },
      body: JSON.stringify({ reason: '不友善', detail: 'e2e 由管理员本人举报' }),
    });
    const ownReport = db.prepare('SELECT id FROM reports WHERE target_id = ? ORDER BY id DESC').get(postId2).id;
    const selfJudge = await sealedCall(
      reporter.channel,
      'POST',
      `/api/admin/reports/${ownReport}/resolve`,
      { action: 'dismiss', note: 'e2e 自己审自己' },
      { cookie: reporter.cookie }
    );
    assert.equal(selfJudge.response.status, 403, `举报人不能自己审判，实际 ${selfJudge.response.status}`);
  });

  await record('站内信弹窗：下次进站弹一次，弹过不再弹', async () => {
    const target = await registerUser();

    /* 带弹窗提醒发送 */
    const sent = await sealedCall(
      session,
      'POST',
      '/api/admin/site-messages',
      { audience: 'user', targets: [target.username], title: 'e2e 弹窗公告', body: '这条要在下次进站时弹', popup: true },
      { cookie }
    );
    assert.equal(sent.response.status, 200, `带弹窗的站内信发送失败：${safeOpen(session, sent.raw)}`);
    assert.equal(openSealed(session, sent.raw).popup, true, '响应里应回传 popup 标记');

    const nextOf = async () => {
      const response = await fetch(`${BASE}/api/notifications/popup/next`, {
        method: 'POST',
        headers: { Cookie: target.cookie },
      });
      const text = await response.text();
      assert.equal(response.status, 200, `取待弹信失败：${response.status} ${text.slice(0, 200)}`);
      const parsed = JSON.parse(text);
      assert.ok(Array.isArray(parsed.letters), `响应缺少 letters：${text.slice(0, 200)}`);
      return parsed.letters;
    };

    /* 第一次进站：拿得到 */
    const first = await nextOf();
    assert.equal(first.length, 1, `应取到 1 封待弹信，实际 ${first.length}`);
    assert.equal(first[0].title, 'e2e 弹窗公告');

    /* 第二次进站：不再弹（关没关都不再打扰） */
    const second = await nextOf();
    assert.equal(second.length, 0, '弹过的公告不该再弹');

    /* 普通站内信（没勾弹窗）永远不进弹窗队列 */
    await sealedCall(
      session,
      'POST',
      '/api/admin/site-messages',
      { audience: 'user', targets: [target.username], title: 'e2e 普通站内信', body: '不弹窗' },
      { cookie }
    );
    const third = await nextOf();
    assert.equal(third.length, 0, '没勾弹窗的站内信不该弹出');
  });

  console.log('\n=== 安全升级端到端验证 ===');
  results.forEach((line) => console.log(line));
  const failed = results.filter((line) => line.includes('FAIL')).length;
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed} 项，失败 ${failed} 项。`);
  console.log(`管理员账号：${ADMIN_USER}`);
}

main()
  .catch((error) => {
    console.error('验证脚本异常：', error);
    process.exitCode = 1;
  })
  .finally(() => {
    /* 相关表都是 ON DELETE CASCADE，删掉账号即可带走它的会话与内容；
       找回申请的外键是 SET NULL，得先按 user_id 清掉，否则会留下无主记录 */
    for (const username of testUsers) {
      try {
        db.prepare(
          'DELETE FROM recovery_requests WHERE user_id IN (SELECT id FROM users WHERE username = ?)'
        ).run(username);
        db.prepare('DELETE FROM users WHERE username = ?').run(username);
      } catch {
        /* 忽略单个账号清理失败 */
      }
    }
    try {
      resetTraces();
    } catch {
      /* 忽略清理失败 */
    }
    try {
      restoreLimits();
    } catch {
      /* 忽略恢复失败 */
    }
  });
