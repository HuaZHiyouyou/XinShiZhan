import crypto from 'node:crypto';
import { safeEqual } from './secrets.js';

/**
 * 传输安全通道（服务端）
 *
 * 目标：即使有人抓包，也只能看到随机别名键 + AES-GCM 密文；
 * 即使重放密文，也会因为时间戳、一次性 nonce、路径绑定与 HMAC 签名而被拒绝。
 *
 * 关键点：通道密钥由 ECDH(P-256) 临时密钥对协商，经 HKDF 派生出
 * 「加密密钥 + 签名密钥」，双方各自持有，服务端不落盘、前端不写死任何密钥，
 * 因此前端产物里不存在可被提取的静态密钥。
 */

const CURVE = 'prime256v1';
const PROTOCOL_VERSION = 1;
const HKDF_INFO_TRANSPORT = 'xsz-transport-v1';
const HKDF_INFO_ALIAS = 'xsz-alias-v1';
const HKDF_INFO_FIELD = 'xsz-field-v1';

/** 预登录通道存活时间：够走完一次登录/注册即可，缩短被抓包后重用的窗口 */
const PRE_AUTH_TTL_MS = 3 * 60 * 1000;
/** 登录后的通道存活时间（滑动续期） */
const AUTHED_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 4000;
const CLOCK_SKEW_MS = 120 * 1000;
const NONCE_TTL_MS = CLOCK_SKEW_MS * 2;
const MAX_NONCES = 20000;
const CHALLENGE_TTL_MS = 120 * 1000;
const MAX_CHALLENGES = 5000;

/** 外层信封的逻辑字段，落到线上时会替换成本会话专属的随机别名 */
const LOGICAL_FIELDS = ['v', 'sid', 'iv', 'd', 'ts', 'n', 's'];
/** 打乱顺序的字母表：让别名看起来毫无规律 */
const ALIAS_ALPHABET = 'qpwoeirutyalskdjfhgzmxncbv';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sessions = new Map();
const usedNonces = new Map();
const challenges = new Map();

function prune(map, now) {
  for (const [key, value] of map) {
    if (value.expiresAt <= now) map.delete(key);
  }
}

function housekeeping() {
  const now = Date.now();
  if (sessions.size > 64) prune(sessions, now);
  if (usedNonces.size > 512) prune(usedNonces, now);
  if (challenges.size > 128) prune(challenges, now);

  if (sessions.size > MAX_SESSIONS) {
    const ordered = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
    ordered.slice(0, sessions.size - MAX_SESSIONS).forEach((item) => sessions.delete(item.sid));
  }
  if (usedNonces.size > MAX_NONCES) {
    const ordered = [...usedNonces.entries()].sort((a, b) => a[1] - b[1]);
    ordered.slice(0, usedNonces.size - MAX_NONCES).forEach(([key]) => usedNonces.delete(key));
  }
  if (challenges.size > MAX_CHALLENGES) {
    const ordered = [...challenges.values()].sort((a, b) => a.expiresAt - b.expiresAt);
    ordered.slice(0, challenges.size - MAX_CHALLENGES).forEach((item) => challenges.delete(item.cid));
  }
}

setInterval(housekeeping, 60 * 1000).unref?.();

function hkdf(ikm, salt, info, length) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.from(salt), Buffer.from(info, 'utf8'), length));
}

function hmac(key, text) {
  return crypto.createHmac('sha256', key).update(text).digest('base64url');
}

function aesEncrypt(key, iv, plainBuffer, aad) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  return Buffer.concat([ct, cipher.getAuthTag()]);
}

function aesDecrypt(key, iv, sealed, aad) {
  if (sealed.length <= 16) throw new HttpError(400, '密文格式不正确');
  const body = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** 由通道别名种子 + 会话号推导本次会话专属的字段别名（前后端算法一致） */
export function buildAliases(kx, sid) {
  const bytes = hkdf(kx, sid, HKDF_INFO_ALIAS, 64);
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
      alias =
        ALIAS_ALPHABET[x % 26] + ALIAS_ALPHABET[y % 26] + (attempt > 8 ? String(attempt) : '');
    }
    used.add(alias);
    aliases[name] = alias;
  });
  return aliases;
}

/** 打乱响应字段顺序，让抓包者无法凭「字段位置」推断含义 */
function shuffleEntries(payload) {
  const list = Array.isArray(payload) ? [...payload] : Object.entries(payload);
  const entropy = crypto.randomBytes(list.length * 2 + 8);
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = entropy.readUInt16BE((i * 2) % (entropy.length - 1)) % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return Object.fromEntries(list);
}

/**
 * 建立一次 ECDH 握手会话。
 * @param {{ clientPublic: string, ip?: string, fingerprint?: string }} input
 */
export function createSession({ clientPublic, ip = '', fingerprint = '' }) {
  const clientPub = Buffer.from(String(clientPublic || ''), 'base64url');
  /* P-256 未压缩点固定 65 字节且以 0x04 开头，先做形状校验再参与运算 */
  if (clientPub.length !== 65 || clientPub[0] !== 0x04) {
    throw new HttpError(400, '握手参数不正确');
  }

  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();

  let shared;
  try {
    shared = ecdh.computeSecret(clientPub);
  } catch {
    throw new HttpError(400, '握手参数不正确');
  }

  const salt = crypto.createHash('sha256').update(clientPub).update(serverPub).digest();
  const material = hkdf(shared, salt, HKDF_INFO_TRANSPORT, 64);
  const sid = crypto.randomBytes(12).toString('hex');
  const kx = crypto.randomBytes(16);
  const now = Date.now();

  const session = {
    sid,
    kx,
    encKey: material.subarray(0, 32),
    macKey: material.subarray(32, 64),
    aliases: buildAliases(kx, sid),
    ip,
    fingerprint: String(fingerprint || '').slice(0, 128),
    userId: null,
    createdAt: now,
    expiresAt: now + PRE_AUTH_TTL_MS,
    requests: 0,
  };
  sessions.set(sid, session);
  housekeeping();

  return {
    session,
    payload: shuffleEntries({
      v: PROTOCOL_VERSION,
      sid,
      sp: serverPub.toString('base64url'),
      kx: kx.toString('base64url'),
      ttl: Math.round(PRE_AUTH_TTL_MS / 1000),
      algo: 'ECDH-P256+HKDF-SHA256+AES-256-GCM',
    }),
  };
}

export function getSession(sid) {
  const session = sessions.get(String(sid || ''));
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(session.sid);
    return null;
  }
  return session;
}

export function dropSession(sid) {
  sessions.delete(String(sid || ''));
}

/** 登录成功后把通道升级为已认证通道，延长存活时间并绑定用户 */
export function bindSession(session, userId) {
  if (!session) return;
  session.userId = userId;
  session.expiresAt = Date.now() + AUTHED_TTL_MS;
}

export function touchSession(session) {
  if (!session) return;
  session.requests += 1;
  session.expiresAt = Date.now() + (session.userId ? AUTHED_TTL_MS : PRE_AUTH_TTL_MS);
}

function consumeNonce(key) {
  const now = Date.now();
  if (usedNonces.has(key)) return false;
  usedNonces.set(key, now + NONCE_TTL_MS);
  return true;
}

function requestAad(method, pathname, sid, ts, nonce) {
  return ['req', method, pathname, sid, ts, nonce].join('|');
}

/**
 * 解开客户端信封：依次校验会话、时间戳、nonce 重放、HMAC 签名，最后 AES-GCM 解密。
 * 任何一步失败都只返回笼统提示，不给探测者反馈细节。
 */
export function openEnvelope(body, { sid, method, pathname, ip = '' }) {
  const session = getSession(sid);
  if (!session) throw new HttpError(428, '安全通道已失效，请刷新页面后重试');
  if (session.ip && ip && session.ip !== ip) throw new HttpError(428, '安全通道校验失败');
  if (!body || typeof body !== 'object') throw new HttpError(400, '请求体格式不正确');

  const alias = session.aliases;
  const version = body[alias.v];
  const ivText = body[alias.iv];
  const dataText = body[alias.d];
  const tsText = body[alias.ts];
  const nonceText = body[alias.n];
  const sigText = body[alias.s];

  if (Number(version) !== PROTOCOL_VERSION) throw new HttpError(400, '协议版本不受支持');
  if (!ivText || !dataText || !tsText || !nonceText || !sigText) {
    throw new HttpError(400, '请求体不完整');
  }

  const ts = Number(tsText);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > CLOCK_SKEW_MS) {
    throw new HttpError(400, '请求时间戳超出允许范围');
  }
  const nonce = String(nonceText).slice(0, 64);
  if (!consumeNonce(`${session.sid}:${nonce}`)) throw new HttpError(409, '检测到重复请求，已拒绝');

  const iv = Buffer.from(String(ivText), 'base64url');
  const sealed = Buffer.from(String(dataText), 'base64url');
  if (iv.length !== 12 || sealed.length > 512 * 1024) throw new HttpError(400, '密文格式不正确');

  const expected = hmac(
    session.macKey,
    ['REQ', method, pathname, session.sid, String(ts), nonce, String(ivText), String(dataText)].join('\n')
  );
  if (!safeEqual(expected, String(sigText))) {
    logEnvelopeFailure(session, 'signature');
    throw new HttpError(400, '请求签名校验失败');
  }

  let plain;
  try {
    plain = aesDecrypt(session.encKey, iv, sealed, requestAad(method, pathname, session.sid, String(ts), nonce));
  } catch {
    logEnvelopeFailure(session, 'decrypt');
    throw new HttpError(400, '请求解密失败');
  }

  let payload;
  try {
    payload = JSON.parse(plain.toString('utf8'));
  } catch {
    throw new HttpError(400, '请求内容无法解析');
  }
  if (!payload || typeof payload !== 'object') throw new HttpError(400, '请求内容格式不正确');

  touchSession(session);
  return { session, payload, nonce, ts };
}

function logEnvelopeFailure(session, reason) {
  session.failures = (session.failures || 0) + 1;
  /* 同一通道连续校验失败视为被探测，直接销毁会话迫使重新握手 */
  if (session.failures >= 3) dropSession(session.sid);
}

/** 用会话密钥封装响应：别名键 + 乱序 + AES-GCM + 签名，客户端验签后才解密 */
export function sealResponse(session, payload) {
  const alias = session.aliases;
  const ts = Date.now();
  const nonce = crypto.randomBytes(9).toString('base64url');
  const iv = crypto.randomBytes(12);
  const aad = ['res', session.sid, String(ts), nonce].join('|');
  const sealed = aesEncrypt(session.encKey, iv, Buffer.from(JSON.stringify(payload ?? null), 'utf8'), aad);
  const ivText = iv.toString('base64url');
  const dataText = sealed.toString('base64url');
  const signature = hmac(session.macKey, ['RES', session.sid, String(ts), nonce, ivText, dataText].join('\n'));

  return shuffleEntries({
    [alias.v]: PROTOCOL_VERSION,
    [alias.sid]: session.sid,
    [alias.iv]: ivText,
    [alias.d]: dataText,
    [alias.ts]: ts,
    [alias.n]: nonce,
    [alias.s]: signature,
  });
}

/**
 * 无请求体的调用（GET/DELETE）走请求头签名：同样校验时间戳、nonce 重放与 HMAC。
 * 头名固定，因为无密文可承载别名；签名本身已把会话密钥、方法、路径与时间绑死。
 */
export function openHeaderRequest(headers, { sid, method, pathname, ip = '' }) {
  const session = getSession(sid);
  if (!session) throw new HttpError(428, '安全通道已失效，请刷新页面后重试');
  if (session.ip && ip && session.ip !== ip) throw new HttpError(428, '安全通道校验失败');

  const ts = Number(headers['x-xsz-ts']);
  const nonce = String(headers['x-xsz-nonce'] || '').slice(0, 64);
  const signature = String(headers['x-xsz-sig'] || '');
  if (!nonce || !signature) throw new HttpError(400, '缺少安全校验头');
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > CLOCK_SKEW_MS) {
    throw new HttpError(400, '请求时间戳超出允许范围');
  }
  if (!consumeNonce(`${session.sid}:${nonce}`)) throw new HttpError(409, '检测到重复请求，已拒绝');

  const expected = hmac(session.macKey, ['REQ', method, pathname, session.sid, String(ts), nonce, '', ''].join('\n'));
  if (!safeEqual(expected, signature)) {
    logEnvelopeFailure(session, 'signature');
    throw new HttpError(400, '请求签名校验失败');
  }
  touchSession(session);
  return { session, payload: null, nonce, ts };
}

/** 客户端校验响应签名用的原文拼接方式（供中间件统一调用） */
export function verifySealedResponse(session, envelope) {
  const alias = session.aliases;
  const ivText = String(envelope[alias.iv] || '');
  const dataText = String(envelope[alias.d] || '');
  const tsText = String(envelope[alias.ts] || '');
  const nonce = String(envelope[alias.n] || '');
  const expected = hmac(session.macKey, ['RES', session.sid, tsText, nonce, ivText, dataText].join('\n'));
  return expected === String(envelope[alias.s] || '');
}

/** 敏感字段（如密码）在信封内部再加密一层，避免任何日志/代理看到明文 */
export function deriveFieldKey(session, nonce) {
  return hkdf(session.encKey, String(nonce), HKDF_INFO_FIELD, 32);
}

export function openSecretField(session, nonce, sealedText) {
  const raw = Buffer.from(String(sealedText || ''), 'base64url');
  if (!raw.length) return '';
  const key = deriveFieldKey(session, nonce);
  const iv = raw.subarray(0, 12);
  const body = raw.subarray(12);
  if (iv.length !== 12) throw new HttpError(400, '凭据格式不正确');
  try {
    return aesDecrypt(key, iv, body, `field|${nonce}`).toString('utf8');
  } catch {
    throw new HttpError(400, '凭据解密失败');
  }
}

export function sealSecretField(session, nonce, plaintext) {
  const key = deriveFieldKey(session, nonce);
  const iv = crypto.randomBytes(12);
  const sealed = aesEncrypt(key, iv, Buffer.from(String(plaintext), 'utf8'), `field|${nonce}`);
  return Buffer.concat([iv, sealed]).toString('base64url');
}

/* ---------------------------------------------------------------- 工作量证明 */

export function leadingZeroBits(buffer) {
  let bits = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/** 签发一次性工作量证明挑战：难度由调用方根据失败次数动态提升 */
export function issueChallenge({ ip = '', bits = 10, ttlMs = CHALLENGE_TTL_MS }) {
  const cid = crypto.randomBytes(12).toString('base64url');
  const prefix = crypto.randomBytes(12).toString('hex');
  const difficulty = Math.max(4, Math.min(20, Number(bits) || 10));
  challenges.set(cid, { cid, prefix, bits: difficulty, ip, expiresAt: Date.now() + ttlMs });
  housekeeping();
  return { cid, prefix, bits: difficulty, ttl: Math.round(ttlMs / 1000) };
}

/** 校验并销毁挑战（一次性），失败不透露原因 */
export function consumeChallenge({ cid, solution, ip = '' }) {
  const item = challenges.get(String(cid || ''));
  if (!item) return false;
  challenges.delete(item.cid);
  if (Date.now() > item.expiresAt) return false;
  if (item.ip && ip && item.ip !== ip) return false;
  const answer = String(solution || '').slice(0, 40);
  if (!answer) return false;
  const digest = crypto.createHash('sha256').update(`${item.prefix}:${answer}`).digest();
  return leadingZeroBits(digest) >= item.bits;
}

export function channelStats() {
  const now = Date.now();
  return {
    sessions: [...sessions.values()].filter((item) => item.expiresAt > now).length,
    challenges: [...challenges.values()].filter((item) => item.expiresAt > now).length,
    nonces: usedNonces.size,
  };
}
