import { getSetting, setSetting } from '../db.js';

/**
 * 安全策略默认值。
 * 这些阈值只存在于服务端，前端拿不到具体数字，攻击者无法据此标定爆破节奏。
 */
export const DEFAULT_SECURITY_POLICY = {
  /* 是否强制认证与后台接口走加密通道 */
  enforceEncryptedChannel: true,
  /* 是否启用工作量证明（每次登录/注册都要先算题，机器成本远高于人） */
  powEnabled: true,
  /* 工作量证明基础难度（前导零比特数），失败越多难度越高。
     8 位前导零约 256 次哈希，正常登录几乎瞬时完成，脚本仍要付出可观算力。 */
  powBaseBits: 8,
  powMaxBits: 12,
  /* 认证失败统计窗口（分钟） */
  loginWindowMinutes: 10,
  /* 同一用户名在窗口内允许失败几次 */
  loginMaxFailPerUser: 5,
  /* 同一 IP 在窗口内允许失败几次 */
  loginMaxPerIp: 10,
  /* 触发锁定后的基础锁定时长（分钟），再次触发按 2 倍递增 */
  lockMinutes: 15,
  lockMaxMinutes: 1440,
  /* 登录令牌有效期（分钟），到期由前端静默续期 */
  sessionTtlMinutes: 120,
  /* 全站 API 粗粒度限流 */
  apiWindowMinutes: 10,
  apiMaxPerIp: 900,
  /*
   * 注册 / 改密的最小长度。
   * 只做「底线拦截」，不做复杂度强制：弱口令由前端给出强度提示，
   * 但在拿到可用的风险分级与登录告警之前，不用规则把普通用户挡在门外。
   */
  minPasswordLength: 6,
  /*
   * 认证类接口的独立限流（按 IP，统一 10 分钟窗口）。
   * 做成可调是为了应对共享出口 IP（学校、公司、运营商 NAT）：
   * 一整层楼的人同时注册，不该被一个写死的数字挡在门外。
   */
  registerMaxPerIp: 10,
  handshakeMaxPerIp: 60,
  challengeMaxPerIp: 120,
  recoverMaxPerIp: 10,
};

/**
 * 身份验证预留项。
 *
 * 邮箱、手机号与实名验证目前只做「能力预留」：数据结构、接口与开关都已就位，
 * 但真实的下发验证码 / 实名核验通道尚未接入。所有开关默认全部关闭，
 * 只有超级管理员（admin）在后台「身份验证」面板中显式开启后，相关入口才对用户可用。
 */
export const DEFAULT_VERIFICATION = {
  /* 邮箱验证：是否对用户开放邮箱填写与后续验证 */
  emailEnabled: false,
  /* 邮箱验证：注册/使用时是否强制要求（真实校验通道接入后才会真正拦截） */
  emailRequired: false,
  phoneEnabled: false,
  phoneRequired: false,
  /* 实名认证 */
  realNameEnabled: false,
  realNameRequired: false,
};

export const VERIFICATION_BOOL_KEYS = [
  'emailEnabled',
  'emailRequired',
  'phoneEnabled',
  'phoneRequired',
  'realNameEnabled',
  'realNameRequired',
];

/**
 * 找回密码渠道。
 *
 * 四种方式：邮箱（预留，未接入）、站内客服、站长求助、密保（预留）。
 * 其中「站内客服」与「站长求助」是真实可用的联系方式，由超级管理员在后台填写；
 * 留空时前台只展示通用提示，不会暴露任何未配置的信息。
 */
export const DEFAULT_RECOVERY = {
  /* 邮箱自助找回：预留能力，通道尚未接入 */
  emailEnabled: false,
  /* 站内客服：开启且填了客服账号才真正可用 */
  serviceEnabled: true,
  /* 站内客服账号（用户名），用户可在站内直接私信/留言 */
  serviceAccount: '',
  serviceHint: '',
  /* 站长求助：开启且填了联系方式才真正可用 */
  masterEnabled: true,
  /* 站长联系方式 */
  masterContact: '',
  masterHint: '',
  /* 密保问题：预留能力 */
  securityEnabled: false,
};

const RECOVERY_BOOL_KEYS = ['emailEnabled', 'serviceEnabled', 'masterEnabled', 'securityEnabled'];

const RECOVERY_TEXT_KEYS = {
  serviceAccount: 40,
  serviceHint: 120,
  masterContact: 120,
  masterHint: 120,
};

/* 站点级安全与常规配置：由管理员在后台「站点与安全」中调整 */
export const DEFAULT_SITE_CONFIG = {
  /* 是否开放新用户注册 */
  allowRegister: true,
  /* 是否开放访客登录（匿名体验账号，只读） */
  allowGuestLogin: false,
  /* 头像是否需要管理员审核后才全站生效 */
  avatarNeedsReview: true,
  /* 同一 IP 每小时最多创建多少个访客账号 */
  guestHourlyLimitPerIp: 5,
  /* 站点公告（留空则不展示） */
  announcement: '',
  /* 身份验证预留项（邮箱 / 手机号 / 实名），默认全部关闭 */
  verification: { ...DEFAULT_VERIFICATION },
  /* 找回密码渠道的对外联系方式 */
  recovery: { ...DEFAULT_RECOVERY },
  /* 认证与接口安全策略 */
  security: { ...DEFAULT_SECURITY_POLICY },
};

const BOOL_KEYS = ['allowRegister', 'allowGuestLogin', 'avatarNeedsReview'];
const SECURITY_BOOL_KEYS = ['enforceEncryptedChannel', 'powEnabled'];
const SECURITY_INT_KEYS = {
  powBaseBits: [4, 20],
  powMaxBits: [4, 24],
  loginWindowMinutes: [1, 1440],
  loginMaxFailPerUser: [1, 100],
  loginMaxPerIp: [1, 500],
  lockMinutes: [1, 1440],
  lockMaxMinutes: [5, 10080],
  sessionTtlMinutes: [5, 4320],
  apiWindowMinutes: [1, 1440],
  apiMaxPerIp: [10, 100000],
  minPasswordLength: [6, 64],
  registerMaxPerIp: [1, 1000],
  handshakeMaxPerIp: [5, 5000],
  challengeMaxPerIp: [5, 10000],
  recoverMaxPerIp: [1, 1000],
};

function normalizeSecurity(raw) {
  const base = { ...DEFAULT_SECURITY_POLICY };
  if (!raw || typeof raw !== 'object') return base;
  for (const key of SECURITY_BOOL_KEYS) {
    if (raw[key] !== undefined) base[key] = Boolean(raw[key]);
  }
  for (const [key, [min, max]] of Object.entries(SECURITY_INT_KEYS)) {
    if (raw[key] === undefined) continue;
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) continue;
    base[key] = Math.min(max, Math.max(min, Math.round(value)));
  }
  base.powMaxBits = Math.max(base.powBaseBits, base.powMaxBits);
  base.lockMaxMinutes = Math.max(base.lockMinutes, base.lockMaxMinutes);
  return base;
}

function normalizeVerification(raw) {
  const base = { ...DEFAULT_VERIFICATION };
  if (!raw || typeof raw !== 'object') return base;
  for (const key of VERIFICATION_BOOL_KEYS) {
    if (raw[key] !== undefined) base[key] = Boolean(raw[key]);
  }
  /* 未启用就没有「强制」可言，避免出现「关闭但必填」的自相矛盾配置 */
  if (!base.emailEnabled) base.emailRequired = false;
  if (!base.phoneEnabled) base.phoneRequired = false;
  if (!base.realNameEnabled) base.realNameRequired = false;
  return base;
}

function normalizeRecovery(raw) {
  const base = { ...DEFAULT_RECOVERY };
  if (!raw || typeof raw !== 'object') return base;
  for (const key of RECOVERY_BOOL_KEYS) {
    if (raw[key] !== undefined) base[key] = Boolean(raw[key]);
  }
  for (const [key, max] of Object.entries(RECOVERY_TEXT_KEYS)) {
    if (raw[key] === undefined) continue;
    base[key] = String(raw[key])
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, max);
  }
  return base;
}

/** 渠道是否处于「用户真的能走通」的状态：开关开着，且联系方式已经配好 */
export function recoveryChannelState(recovery, method) {
  const enabledMap = {
    email: recovery.emailEnabled,
    service: recovery.serviceEnabled,
    master: recovery.masterEnabled,
    security: recovery.securityEnabled,
  };
  const contactMap = {
    email: '',
    service: recovery.serviceAccount,
    master: recovery.masterContact,
    security: '',
  };
  if (!enabledMap[method]) return 'disabled';
  /*
   * 站内客服需要知道「找谁」，所以必须配好客服账号；
   * 站长求助不需要——申请本身就会写进后台并立刻站内通知站长，
   * 联系方式只是给用户多一条路，没填也不影响求助真正送达。
   */
  if (method === 'service' && !contactMap[method]) return 'unconfigured';
  /* 邮箱与密保属于预留能力，通道尚未接入 */
  if (method === 'email' || method === 'security') return 'reserved';
  return 'available';
}

export function getSiteConfig() {
  const stored = getSetting('site_config', null);
  if (!stored || typeof stored !== 'object') {
    return {
      ...DEFAULT_SITE_CONFIG,
      verification: { ...DEFAULT_VERIFICATION },
      recovery: { ...DEFAULT_RECOVERY },
      security: { ...DEFAULT_SECURITY_POLICY },
    };
  }
  return {
    ...DEFAULT_SITE_CONFIG,
    ...stored,
    verification: normalizeVerification(stored.verification),
    recovery: normalizeRecovery(stored.recovery),
    security: normalizeSecurity(stored.security),
  };
}

/** 只取安全策略，供防护层高频调用 */
export function getSecurityPolicy() {
  return normalizeSecurity(getSetting('site_config', null)?.security);
}

/** 只取身份验证开关，供注册 / 资料 / 验证接口判定是否开放 */
export function getVerification() {
  return normalizeVerification(getSetting('site_config', null)?.verification);
}

export function saveSiteConfig(patch = {}) {
  const base = getSiteConfig();
  const next = { ...base };
  for (const key of BOOL_KEYS) {
    if (patch[key] !== undefined) next[key] = Boolean(patch[key]);
  }
  if (patch.guestHourlyLimitPerIp !== undefined) {
    const n = Number(patch.guestHourlyLimitPerIp);
    next.guestHourlyLimitPerIp = Math.min(100, Math.max(1, Number.isFinite(n) ? Math.round(n) : base.guestHourlyLimitPerIp));
  }
  if (patch.announcement !== undefined) {
    next.announcement = String(patch.announcement).slice(0, 200);
  }
  if (patch.verification !== undefined) {
    next.verification = normalizeVerification({ ...base.verification, ...(patch.verification || {}) });
  }
  if (patch.recovery !== undefined) {
    next.recovery = normalizeRecovery({ ...base.recovery, ...(patch.recovery || {}) });
  }
  if (patch.security !== undefined) {
    next.security = normalizeSecurity({ ...base.security, ...(patch.security || {}) });
  }
  setSetting('site_config', next);
  return next;
}

/* 对未登录访客公开的最小配置集合（不含任何安全阈值与管理相关字段） */
export function publicSiteConfig() {
  const cfg = getSiteConfig();
  const verification = cfg.verification;
  const recovery = cfg.recovery;
  return {
    allowRegister: cfg.allowRegister,
    allowGuestLogin: cfg.allowGuestLogin,
    announcement: cfg.announcement,
    /* 只告诉前端「需要走加密通道」，不暴露任何阈值与密钥信息 */
    secureChannel: cfg.security.enforceEncryptedChannel,
    /* 密码最小长度：前端据此给出与后端完全一致的提示，避免「提示 8 位、实际要 6 位」的错位 */
    minPasswordLength: cfg.security.minPasswordLength,
    /* 身份验证开关：只下发「是否开放 / 是否必填」，不含任何校验规则细节 */
    verification: {
      emailEnabled: verification.emailEnabled,
      emailRequired: verification.emailRequired,
      phoneEnabled: verification.phoneEnabled,
      phoneRequired: verification.phoneRequired,
      realNameEnabled: verification.realNameEnabled,
      realNameRequired: verification.realNameRequired,
    },
    /* 找回密码渠道：开关 + 客服与站长的联系方式，找回页据此决定展示哪些入口 */
    recovery: {
      emailEnabled: recovery.emailEnabled,
      serviceEnabled: recovery.serviceEnabled,
      masterEnabled: recovery.masterEnabled,
      securityEnabled: recovery.securityEnabled,
      serviceAccount: recovery.serviceAccount,
      serviceHint: recovery.serviceHint,
      masterContact: recovery.masterContact,
      masterHint: recovery.masterHint,
    },
  };
}
