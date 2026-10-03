import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../db.js';

/**
 * 服务端主密钥与派生密钥中心。
 *
 * 设计要点：
 * 1. 主密钥只存在于服务端（环境变量或 data/master.key，权限 0600），
 *    任何情况下都不会通过接口、静态资源或前端产物泄露；
 * 2. JWT 签名密钥、密码胡椒、通道绑定密钥全部由主密钥经 HKDF 派生，
 *    源码里不出现任何明文密钥常量；
 * 3. 主密钥轮换后旧令牌自然失效，等价于一次全站强制重新登录。
 */

const KEY_FILE = path.join(DATA_DIR, 'master.key');

function toKeyBuffer(input) {
  return crypto.createHash('sha256').update(input).digest();
}

function loadMasterKey() {
  const fromEnv = String(process.env.XSZ_MASTER_SECRET || '').trim();
  if (fromEnv.length >= 16) return toKeyBuffer(fromEnv);

  try {
    const raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    if (raw.length >= 16) return toKeyBuffer(raw);
  } catch {
    /* 首次启动，下面生成并落盘 */
  }

  const fresh = crypto.randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, fresh.toString('hex'), { mode: 0o600 });
  try {
    fs.chmodSync(KEY_FILE, 0o600);
  } catch {
    /* Windows 下 chmod 语义有限，忽略 */
  }
  return fresh;
}

export const MASTER_KEY = loadMasterKey();

/** 由主密钥派生一段固定用途的子密钥（info 即用途标签，杜绝跨用途复用） */
export function deriveSecret(info, length = 32, salt = '') {
  const bytes = crypto.hkdfSync(
    'sha256',
    MASTER_KEY,
    Buffer.from(String(salt), 'utf8'),
    Buffer.from(String(info), 'utf8'),
    length
  );
  return Buffer.from(bytes);
}

/** JWT 签名密钥：优先使用运维显式注入的值，否则由主密钥派生 */
export const JWT_SECRET =
  String(process.env.XSZ_JWT_SECRET || '').trim().length >= 16
    ? String(process.env.XSZ_JWT_SECRET).trim()
    : deriveSecret('xsz-jwt-sign-v1', 48).toString('base64url');

/** 密码胡椒：与 bcrypt 盐叠加，即使数据库文件泄露也无法离线爆破 */
export const PASSWORD_PEPPER = deriveSecret('xsz-password-pepper-v1', 32);

/** 令牌哈希密钥：会话表只存令牌摘要，不存令牌本身 */
export const TOKEN_HASH_KEY = deriveSecret('xsz-token-hash-v1', 32);

/** 登录态 Cookie 名（httpOnly + SameSite=Strict + Path=/api） */
export const SESSION_COOKIE = 'xsz_s';

/** 管理员账号：由站点所有者指定，仅用于首次自举，不会写入前端产物 */
export const ADMIN_USERNAME = String(process.env.XSZ_ADMIN_USER || 'huazhiyou');
export const ADMIN_PASSWORD = String(process.env.XSZ_ADMIN_PASS || 'huazhiyouyou');

/** 禁止注册的保留用户名，避免仿冒管理员 */
export const RESERVED_USERNAMES = new Set(
  [
    ADMIN_USERNAME,
    'admin',
    'administrator',
    'root',
    'system',
    'sys',
    'owner',
    'moderator',
    'reviewer',
    'support',
    'official',
    'webmaster',
    'null',
    'undefined',
    'guest',
    '管理员',
    '系统',
    '官方',
    '客服',
    '审核员',
    '站长',
  ]
    .map((name) => name.toLowerCase())
    .filter(Boolean)
);

export function isReservedUsername(name) {
  const value = String(name || '').trim().toLowerCase();
  if (!value) return false;
  if (RESERVED_USERNAMES.has(value)) return true;
  /* 去掉分隔符后再比一次，防止 huazhi_you / hua-zhiyou 这类仿冒 */
  const squeezed = value.replace(/[\s._\-@#]+/g, '');
  return RESERVED_USERNAMES.has(squeezed);
}

export function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function tokenHash(token) {
  return crypto.createHmac('sha256', TOKEN_HASH_KEY).update(String(token)).digest('hex');
}

/** 定长时间比较，避免通过响应时差推断内容 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/* ------------------------------------------------- 个人信息字段的落库加密 */

/** 姓名 / 证件号等敏感资料专用子密钥，与密码胡椒、令牌密钥互不复用 */
const FIELD_KEY = deriveSecret('xsz-field-enc-v1', 32);
const FIELD_PREFIX = 'v1';

/**
 * 加密落库：AES-256-GCM，随机 IV，输出 v1.iv.tag.data（base64url）。
 * 即使数据库文件被带走，缺少主密钥也解不开实名资料。
 */
export function encryptField(plain) {
  const value = String(plain ?? '');
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', FIELD_KEY, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    FIELD_PREFIX,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

/** 解密；非密文格式按历史明文原样返回，解密失败返回空串 */
export function decryptField(payload) {
  const raw = String(payload ?? '');
  if (!raw) return '';
  const parts = raw.split('.');
  if (parts.length !== 4 || parts[0] !== FIELD_PREFIX) return raw;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', FIELD_KEY, Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/**
 * 生成一次性临时口令：交给管理员口头/私信转达给用户，用户登录后应立即自行修改。
 * 用无歧义字符集（去掉了 0/O/1/l/I），避免念错抄错。
 */
export function randomPassword(length = 12) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/* --------------------------------------------------------- 字段格式校验规则 */

export const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
export const PHONE_RE = /^1[3-9]\d{9}$/;
/* 二代身份证：18 位，末位可为 X */
export const ID_NUMBER_RE = /^\d{17}[\dXx]$/;
/* 中文姓名 2-20 字，或英文名（含空格与点） */
export const REAL_NAME_RE = /^(?:[\u4e00-\u9fa5]{2,20}|[A-Za-z][A-Za-z .'-]{1,39})$/;
