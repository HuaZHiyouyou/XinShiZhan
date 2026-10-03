/**
 * 前端安全通道
 *
 * 与 `server/src/lib/secureChannel.js` 严格对应，负责：
 * 1. ECDH(P-256) 一次性握手，协商出只属于本次会话的加密密钥与签名密钥；
 * 2. 请求封装：随机别名键 + 乱序 + AES-256-GCM 密文 + HMAC 签名 + 时间戳 + 一次性 nonce；
 * 3. 响应解封：先验签再解密，任何篡改都会直接失败；
 * 4. 工作量证明（PoW）：登录/注册前先在浏览器里算题，把脚本爆破的成本抬高几个数量级。
 *
 * 安全前提：本文件不含任何静态密钥、口令或阈值。
 * 所有密钥都在运行时协商、只存在于内存，页面刷新即消失，构建产物里也搜不出可用凭据。
 */

const PROTOCOL_VERSION = 1;
const LOGICAL_FIELDS = ['v', 'sid', 'iv', 'd', 'ts', 'n', 's'] as const;
const ALIAS_ALPHABET = 'qpwoeirutyalskdjfhgzmxncbv';

const HKDF_INFO_TRANSPORT = 'xsz-transport-v1';
const HKDF_INFO_ALIAS = 'xsz-alias-v1';
const HKDF_INFO_FIELD = 'xsz-field-v1';

/** 会话到期前多久就重新握手，避免边界上刚好过期 */
const RENEW_MARGIN_MS = 20_000;
/** 与服务端保持一致的通道存活时间：登录前 3 分钟，登录后 30 分钟（滑动续期） */
const PRE_AUTH_TTL_MS = 180_000;
const AUTHED_TTL_MS = 30 * 60_000;
const CLOCK_SKEW_MS = 120_000;
/** PoW 单次求解的哈希上限，超出即放弃（正常难度远低于此） */
const POW_MAX_TRIES = 4_000_000;
/**
 * 每批并发计算的哈希数量。
 * 批量越大，批与批之间的 await 往返越少，整体求解越快；
 * 128 是「单批耗时仍在毫秒量级、界面不卡顿」的折中值。
 */
const POW_BATCH = 128;
/** 每算完这么多批才让出一次主线程，避免 setTimeout 的最小延时拖慢求解 */
const POW_YIELD_EVERY = 4;

export const ENC_HEADER = 'X-Xsz-Enc';
export const SID_HEADER = 'X-Xsz-Sid';
export const TS_HEADER = 'X-Xsz-Ts';
export const NONCE_HEADER = 'X-Xsz-Nonce';
export const SIG_HEADER = 'X-Xsz-Sig';

export interface PowChallenge {
  cid: string;
  prefix: string;
  bits: number;
  ttl: number;
  disabled?: boolean;
}

interface SecureSession {
  sid: string;
  aliases: Record<string, string>;
  encKey: CryptoKey;
  macKey: CryptoKey;
  encRaw: Uint8Array;
  expiresAt: number;
  pow: PowChallenge | null;
}

/** 通道级错误：调用方据此决定是否重新握手后重试 */
export class SecureChannelError extends Error {
  status: number;

  constructor(message: string, status = 428) {
    super(message);
    this.name = 'SecureChannelError';
    this.status = status;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function subtle(): SubtleCrypto {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.subtle) throw new SecureChannelError('当前浏览器不支持安全通道，请更换浏览器', 501);
  return webcrypto.subtle;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const normalized = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hkdf(ikm: Uint8Array, salt: string | Uint8Array, info: string, length: number): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const saltBytes = typeof salt === 'string' ? encoder.encode(salt) : salt;
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes as BufferSource, info: encoder.encode(info) as BufferSource },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return new Uint8Array(await subtle().digest('SHA-256', bytes as BufferSource));
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function importMacKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function hmacText(macKey: CryptoKey, text: string): Promise<string> {
  const signature = await subtle().sign({ name: 'HMAC' }, macKey, encoder.encode(text) as BufferSource);
  return toBase64Url(new Uint8Array(signature));
}

async function aesSeal(key: CryptoKey, iv: Uint8Array, plaintext: string, aad: string): Promise<string> {
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: encoder.encode(aad) as BufferSource, tagLength: 128 },
    key,
    encoder.encode(plaintext) as BufferSource
  );
  return toBase64Url(new Uint8Array(sealed));
}

async function aesOpen(key: CryptoKey, iv: Uint8Array, sealedText: string, aad: string): Promise<string> {
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: encoder.encode(aad) as BufferSource, tagLength: 128 },
      key,
      fromBase64Url(sealedText) as BufferSource
    );
    return decoder.decode(plain);
  } catch {
    throw new SecureChannelError('响应解密失败，连接可能已被篡改', 400);
  }
}

/** 字段别名推导：必须与服务端 buildAliases 完全一致（同样的 HKDF、同样的取字节方式） */
async function deriveAliases(kxRaw: Uint8Array, sid: string): Promise<Record<string, string>> {
  const bytes = await hkdf(kxRaw, sid, HKDF_INFO_ALIAS, 64);
  const aliases: Record<string, string> = {};
  const used = new Set<string>();

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

/** 打乱字段顺序：线上报文里字段位置每次都不同，静态规则难以稳定解析 */
function shuffleEntries(entries: [string, unknown][]): Record<string, unknown> {
  const list = [...entries];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = randomBytes(2)[0] % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  const out: Record<string, unknown> = {};
  list.forEach(([key, value]) => {
    out[key] = value;
  });
  return out;
}

/** 客户端指纹：只用于服务端把通道与来源绑定，不含任何身份信息 */
async function clientFingerprint(): Promise<string> {
  const nav = globalThis.navigator;
  const screenInfo = globalThis.screen ? `${globalThis.screen.width}x${globalThis.screen.height}x${globalThis.screen.colorDepth}` : '0';
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    zone = '';
  }
  const raw = [nav?.userAgent || '', nav?.language || '', screenInfo, zone, nav?.hardwareConcurrency || 0].join('|');
  const digest = await sha256(raw);
  return toBase64Url(digest).slice(0, 64);
}

/* ------------------------------------------------------------------ 会话管理 */

let session: SecureSession | null = null;
let handshakeInflight: Promise<SecureSession> | null = null;
/** 登录成功后通道会被服务端升级为「已认证通道」，存活时间随之延长 */
let bound = false;

export function hasSecureSession(): boolean {
  return Boolean(session && session.expiresAt - RENEW_MARGIN_MS > Date.now());
}

export function dropSecureSession(): void {
  session = null;
  handshakeInflight = null;
  bound = false;
}

export function markSessionBound(): void {
  bound = true;
  touchSecureSession();
}

/** 每次成功通信后按服务端的滑动续期规则同步本地有效期，避免无谓的重复握手 */
export function touchSecureSession(): void {
  if (!session) return;
  session.expiresAt = Date.now() + (bound ? AUTHED_TTL_MS : PRE_AUTH_TTL_MS) - RENEW_MARGIN_MS;
}

async function handshake(): Promise<SecureSession> {
  const pair = (await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const clientPublicRaw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));

  let response: Response;
  try {
    response = await fetch('/api/auth/handshake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: PROTOCOL_VERSION, cp: toBase64Url(clientPublicRaw), fp: await clientFingerprint() }),
      cache: 'no-store',
    });
  } catch {
    throw new SecureChannelError('网络连接失败，请确认后端服务已启动', 0);
  }

  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text || '{}') as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new SecureChannelError(String(payload.error || '安全通道建立失败'), response.status);
  }

  const sid = String(payload.sid || '');
  const serverPublicText = String(payload.sp || '');
  const kxText = String(payload.kx || '');
  if (!sid || !serverPublicText || !kxText) throw new SecureChannelError('握手响应不完整', 400);

  const serverPublicKey = await subtle().importKey(
    'raw',
    fromBase64Url(serverPublicText) as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const sharedSecret = new Uint8Array(
    await subtle().deriveBits({ name: 'ECDH', public: serverPublicKey }, pair.privateKey, 256)
  );

  const salt = await sha256(new Uint8Array([...clientPublicRaw, ...fromBase64Url(serverPublicText)]));
  const material = await hkdf(sharedSecret, salt, HKDF_INFO_TRANSPORT, 64);
  const encRaw = material.subarray(0, 32);
  const macRaw = material.subarray(32, 64);
  const kxRaw = fromBase64Url(kxText);

  const ttlSeconds = Number(payload.ttl) || 120;
  const pow = (payload.pow as PowChallenge | undefined) || null;

  const next: SecureSession = {
    sid,
    aliases: await deriveAliases(kxRaw, sid),
    encKey: await importAesKey(encRaw),
    macKey: await importMacKey(macRaw),
    encRaw,
    expiresAt: Date.now() + ttlSeconds * 1000,
    pow,
  };

  session = next;
  return next;
}

/** 取得可用通道会话；并发调用只会握手一次 */
export async function ensureSecureSession(force = false): Promise<SecureSession> {
  if (!force && hasSecureSession() && session) return session;
  if (handshakeInflight && !force) return handshakeInflight;

  const task = handshake().finally(() => {
    handshakeInflight = null;
  });
  handshakeInflight = task;
  return task;
}

/* ------------------------------------------------------------------ 请求封装 */

export interface SealedRequest {
  headers: Record<string, string>;
  body?: string;
  nonce: string;
}

/**
 * 载荷工厂：需要「字段级二次加密」时（例如密码）必须用它，
 * 服务端用本次请求的 nonce 派生字段密钥，两边必须拿到同一个 nonce。
 */
export type SecurePayloadFactory = (nonce: string) => unknown | Promise<unknown>;

/**
 * 载荷既可以是任意可 JSON 序列化的值，也可以是上面的工厂函数。
 * 因为要兼容任意业务对象，这里保留 unknown，由 sealRequest 在运行时按 typeof 分派。
 */
export type SecurePayload = unknown;

/** 带请求体：整个 JSON 载荷进入信封，字段名替换为会话专属别名并打乱顺序 */
export async function sealRequest(method: string, pathname: string, payload: SecurePayload): Promise<SealedRequest> {
  const current = await ensureSecureSession();
  const alias = current.aliases;
  const ts = Date.now();
  const nonce = toBase64Url(randomBytes(9));

  const resolved = typeof payload === 'function' ? await (payload as SecurePayloadFactory)(nonce) : payload;

  const iv = randomBytes(12);
  const ivText = toBase64Url(iv);
  const dataText = await aesSeal(current.encKey, iv, JSON.stringify(resolved ?? {}), ['req', method, pathname, current.sid, String(ts), nonce].join('|'));
  const signature = await hmacText(
    current.macKey,
    ['REQ', method, pathname, current.sid, String(ts), nonce, ivText, dataText].join('\n')
  );

  const envelope = shuffleEntries([
    [alias.v, PROTOCOL_VERSION],
    [alias.sid, current.sid],
    [alias.iv, ivText],
    [alias.d, dataText],
    [alias.ts, ts],
    [alias.n, nonce],
    [alias.s, signature],
  ]);

  return {
    headers: {
      'Content-Type': 'application/json',
      [ENC_HEADER]: '1',
      [SID_HEADER]: current.sid,
    },
    body: JSON.stringify(envelope),
    nonce,
  };
}

/** 无请求体（GET/DELETE）：改用请求头签名，同样绑定方法、路径、时间与 nonce */
export async function signRequest(method: string, pathname: string): Promise<SealedRequest> {
  const current = await ensureSecureSession();
  const ts = Date.now();
  const nonce = toBase64Url(randomBytes(9));
  const signature = await hmacText(current.macKey, ['REQ', method, pathname, current.sid, String(ts), nonce, '', ''].join('\n'));

  return {
    headers: {
      [ENC_HEADER]: '1',
      [SID_HEADER]: current.sid,
      [TS_HEADER]: String(ts),
      [NONCE_HEADER]: nonce,
      [SIG_HEADER]: signature,
    },
    nonce,
  };
}

/**
 * 敏感字段（密码）在信封内部再加密一层：即使信封被解开也看不到明文。
 * 密钥 = HKDF(会话加密密钥, 本次请求 nonce)，服务端用同一个 nonce 还原。
 */
export async function sealSecretField(nonce: string, plaintext: string): Promise<string> {
  const current = await ensureSecureSession();
  const keyRaw = await hkdf(current.encRaw, String(nonce), HKDF_INFO_FIELD, 32);
  const key = await importAesKey(keyRaw);
  const iv = randomBytes(12);
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: encoder.encode(`field|${nonce}`) as BufferSource, tagLength: 128 },
    key,
    encoder.encode(String(plaintext)) as BufferSource
  );
  return toBase64Url(new Uint8Array([...iv, ...new Uint8Array(sealed)]));
}

/* ------------------------------------------------------------------ 响应解封 */

export async function openSealedResponse(text: string): Promise<unknown> {
  const current = session;
  if (!current) throw new SecureChannelError('安全通道已失效', 428);

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(text || '{}') as Record<string, unknown>;
  } catch {
    throw new SecureChannelError('响应格式不正确', 400);
  }

  const alias = current.aliases;
  const sidText = String(envelope[alias.sid] ?? '');
  const ivText = String(envelope[alias.iv] ?? '');
  const dataText = String(envelope[alias.d] ?? '');
  const tsText = String(envelope[alias.ts] ?? '');
  const nonce = String(envelope[alias.n] ?? '');
  const signature = String(envelope[alias.s] ?? '');

  if (sidText !== current.sid || !ivText || !dataText || !nonce || !signature) {
    throw new SecureChannelError('响应校验失败', 400);
  }

  const expected = await hmacText(current.macKey, ['RES', current.sid, tsText, nonce, ivText, dataText].join('\n'));
  if (expected !== signature) throw new SecureChannelError('响应签名校验失败，内容可能被篡改', 400);

  const ts = Number(tsText);
  if (Number.isFinite(ts) && Math.abs(Date.now() - ts) > CLOCK_SKEW_MS) {
    throw new SecureChannelError('响应时间异常，请检查系统时间', 400);
  }

  const plain = await aesOpen(current.encKey, fromBase64Url(ivText), dataText, ['res', current.sid, tsText, nonce].join('|'));
  if (!plain) return null;
  try {
    return JSON.parse(plain) as unknown;
  } catch {
    throw new SecureChannelError('响应内容无法解析', 400);
  }
}

/* ---------------------------------------------------------------- 工作量证明 */

function leadingZeroBits(buffer: Uint8Array): number {
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

/**
 * 求解 sha256(`${prefix}:${answer}`) 前导零 >= bits 的 answer。
 * 分批并发计算并周期性让出主线程，界面不会卡死。
 */
export async function solvePow(prefix: string, bits: number, onProgress?: (tries: number) => void): Promise<string> {
  if (!prefix || bits <= 0) return '';
  let counter = 0;
  let batches = 0;
  while (counter < POW_MAX_TRIES) {
    const candidates: string[] = [];
    for (let i = 0; i < POW_BATCH; i += 1) candidates.push(String(counter + i));
    counter += POW_BATCH;
    batches += 1;

    /* eslint-disable no-await-in-loop -- 每批内部并发，批与批之间需要串行以检查命中 */
    const digests = await Promise.all(candidates.map((value) => sha256(`${prefix}:${value}`)));
    const hitIndex = digests.findIndex((digest) => leadingZeroBits(digest) >= bits);
    if (hitIndex >= 0) return candidates[hitIndex];

    onProgress?.(counter);
    /* 只在攒够几批后让出主线程：让出本身有 ~4ms 起步开销，过于频繁反而是主要耗时来源 */
    if (batches % POW_YIELD_EVERY === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw new SecureChannelError('安全校验超时，请重试', 408);
}

/** 取一份一次性挑战：握手时附带的优先复用，用完或过期再申请新的 */
export async function nextChallenge(username = ''): Promise<PowChallenge | null> {
  const current = await ensureSecureSession();
  if (current.pow && current.pow.cid) {
    const challenge = current.pow;
    current.pow = null;
    return challenge;
  }

  const response = await fetch('/api/auth/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as PowChallenge;
  if (!response.ok || payload.disabled || !payload.cid) return null;
  return payload;
}

/** 完成一次挑战求解，返回可直接放进认证载荷的字段 */
export async function solveChallenge(
  username = '',
  onProgress?: (tries: number) => void
): Promise<{ cid: string; pow: string }> {
  const challenge = await nextChallenge(username);
  if (!challenge) return { cid: '', pow: '' };
  const solution = await solvePow(challenge.prefix, challenge.bits, onProgress);
  return { cid: challenge.cid, pow: solution };
}
