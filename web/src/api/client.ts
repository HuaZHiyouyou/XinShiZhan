import type {
  AccountPatch,
  AdminPost,
  AdminSecurity,
  AdminSiteConfig,
  AdminStats,
  AdminUser,
  AuditLogItem,
  DanmakuEffect,
  DanmakuItem,
  DanmakuMode,
  GuestLoginItem,
  MusicTrack,
  MyRecoveryItem,
  NotificationItem,
  Overview,
  PaletteEntry,
  PendingAvatarItem,
  Post,
  PostMessage,
  ProfilePatch,
  RankingItem,
  RecoveryRequestItem,
  RecoveryResult,
  ReportItem,
  ReviewItem,
  ReviewRules,
  SessionUser,
  SiteConfig,
  SiteMessageTargets,
  Visibility,
} from './types';
import {
  ENC_HEADER,
  SecureChannelError,
  dropSecureSession,
  markSessionBound,
  openSealedResponse,
  sealRequest,
  sealSecretField,
  signRequest,
  solveChallenge,
  touchSecureSession,
  type SecurePayload,
} from '../lib/secure';
import { useProgress } from '../store/progress';

/**
 * 接口客户端
 *
 * 认证态只存在于 httpOnly Cookie（服务端下发）与本模块的内存变量里，
 * 不再写入 localStorage —— 即使页面被注入脚本，也读不到可复用的凭据。
 *
 * `/api/auth/*` 与 `/api/admin/*` 全部走加密通道：
 * 请求体被替换成「随机别名键 + AES-GCM 密文 + HMAC 签名」的信封，
 * 无请求体的调用改用签名请求头；响应同样先验签再解密。
 */

/* 旧版本把令牌放在 localStorage，这里主动清掉历史残留 */
try {
  localStorage.removeItem('xsz.token');
} catch {
  /* 存储不可用时忽略 */
}

let memoryToken = '';

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export function getToken(): string {
  return memoryToken;
}

export function setToken(token: string | null) {
  memoryToken = token ? String(token) : '';
}

type Query = Record<string, string | number | boolean | null | undefined>;

/**
 * 批量操作的结果。
 * 逐条处理，不因为某一条越权就整批放弃 —— 处理了几条、哪几条没动，都要说清楚。
 */
export interface BatchResult {
  ok: boolean;
  done: number;
  blocked: { id: number; type?: string; error: string }[];
}

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const SECURE_PREFIXES = ['/api/auth/', '/api/admin/'];
/** 握手与挑战本身就是建立通道的过程，不能再次封装 */
const CHANNEL_BOOTSTRAP_PATHS = new Set(['/api/auth/handshake', '/api/auth/challenge', '/api/auth/config']);

function needsChannel(pathname: string): boolean {
  if (CHANNEL_BOOTSTRAP_PATHS.has(pathname)) return false;
  return SECURE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    return String((payload as { error: unknown }).error);
  }
  if (typeof payload === 'string' && payload.trim()) return payload.slice(0, 200);
  return `请求失败（${status}）`;
}

interface RequestOptions extends RequestInit {
  /** 需要加密通道时的载荷；可以是对象，也可以是拿到 nonce 后再构造的工厂函数 */
  securePayload?: SecurePayload;
}

/**
 * 所有接口的唯一出口。
 *
 * 外面只包一件事：把「有请求在跑」告诉顶部进度条。
 * 放在这一个地方，全站任何一次数据加载都会自动有起点和终点，
 * 不需要每个页面自己去维护一个加载标志。
 */
async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  useProgress.getState().start();
  try {
    return await requestInner<T>(path, init);
  } finally {
    useProgress.getState().end();
  }
}

async function requestInner<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const { securePayload, ...rest } = init;
  const [pathname = ''] = path.split('?');
  const secure = needsChannel(pathname) && !(rest.body instanceof FormData);

  const send = async (): Promise<Response> => {
    const headers = new Headers(rest.headers);
    let body = rest.body as BodyInit | null | undefined;

    if (secure) {
      let sealed;
      if (securePayload !== undefined) {
        sealed = await sealRequest(method, pathname, securePayload);
      } else if (typeof body === 'string' && body.length > 0) {
        sealed = await sealRequest(method, pathname, JSON.parse(body));
      } else if (body === undefined || body === null) {
        sealed = await signRequest(method, pathname);
      } else {
        throw new ApiError('该接口不支持当前请求体类型', 0, null);
      }
      Object.entries(sealed.headers).forEach(([key, value]) => headers.set(key, value));
      body = sealed.body ?? undefined;
    } else if (body !== undefined && body !== null && !(body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    return fetch(path, {
      ...rest,
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: rest.cache ?? 'no-store',
    });
  };

  let response: Response;
  try {
    response = await send();
    /* 通道失效（服务端重启、会话过期、重放被拒）时重建通道并重试一次 */
    if (secure && (response.status === 428 || response.status === 409)) {
      dropSecureSession();
      response = await send();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (!secure || !(error instanceof SecureChannelError)) {
      throw new ApiError('网络连接失败，请确认后端服务已启动', 0, null);
    }
    dropSecureSession();
    try {
      response = await send();
    } catch {
      throw new ApiError(error.message || '网络连接失败，请确认后端服务已启动', error.status || 0, null);
    }
  }

  const sealedResponse = response.headers.get(ENC_HEADER) === '1';
  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    if (sealedResponse) {
      try {
        payload = await openSealedResponse(text);
      } catch (error) {
        dropSecureSession();
        throw new ApiError(error instanceof Error ? error.message : '响应校验失败', 400, null);
      }
      touchSecureSession();
    } else {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
  }

  if (!response.ok) {
    /* 会话过期：清掉内存令牌并回到登录入口，避免带着失效凭据继续操作 */
    if (response.status === 401 && memoryToken) {
      memoryToken = '';
      if (typeof window !== 'undefined') window.location.reload();
    }
    throw new ApiError(errorMessage(payload, response.status), response.status, payload);
  }

  return (payload ?? {}) as T;
}

const json = (body: unknown) => JSON.stringify(body);

interface AuthResult {
  token: string;
  user: SessionUser;
  expiresIn?: number;
}

/**
 * 认证类调用的统一封装：
 * 1. 先取一次性工作量证明挑战并在本地求解（脚本爆破要付出算力代价）；
 * 2. 密码等敏感字段用「本次请求 nonce 派生的字段密钥」再加密一层；
 * 3. 整个载荷进入信封，线上看不到任何明文字段名与字段值。
 */
async function secureAuth<T>(
  path: string,
  options: {
    username?: string;
    fields?: Record<string, unknown>;
    secrets?: Record<string, string>;
    honeypot?: string;
    onProgress?: (tries: number) => void;
  } = {}
): Promise<T> {
  const { username = '', fields = {}, secrets = {}, honeypot = '', onProgress } = options;
  const proof = await solveChallenge(username, onProgress);

  return request<T>(path, {
    method: 'POST',
    securePayload: async (nonce: string) => {
      const payload: Record<string, unknown> = { ...fields, cid: proof.cid, pow: proof.pow, hp: honeypot };
      for (const [key, value] of Object.entries(secrets)) {
        /* 顺序 await：字段数量固定且极少，串行可读性更好 */
        payload[key] = await sealSecretField(nonce, value);
      }
      return payload;
    },
  });
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),
  siteConfig: () => request<{ config: SiteConfig }>('/api/site-config'),

  auth: {
    guest: (honeypot = '') => secureAuth<AuthResult>('/api/auth/guest', { username: 'guest', honeypot }),
    register: (
      input: {
        username: string;
        password: string;
        confirm: string;
        nickname?: string;
        email?: string;
        phone?: string;
        realName?: string;
        idNumber?: string;
      },
      honeypot = '',
      onProgress?: (tries: number) => void
    ) => {
      /* 可选字段为空时不下发：服务端用「字段是否存在」判断是否受理，避免误触未开放的开关 */
      const fields: Record<string, unknown> = { username: input.username };
      if (input.nickname) fields.nickname = input.nickname;
      if (input.email) fields.email = input.email;
      if (input.phone) fields.phone = input.phone;
      if (input.realName) fields.realName = input.realName;
      if (input.idNumber) fields.idNumber = input.idNumber;
      return secureAuth<AuthResult>('/api/auth/register', {
        username: input.username,
        fields,
        secrets: { password: input.password, confirm: input.confirm },
        honeypot,
        onProgress,
      });
    },
    login: (username: string, password: string, honeypot = '', onProgress?: (tries: number) => void) =>
      secureAuth<AuthResult>('/api/auth/login', {
        username,
        fields: { username },
        secrets: { password },
        honeypot,
        onProgress,
      }),
    me: () => request<{ user: SessionUser }>('/api/auth/me'),
    refresh: () => request<AuthResult>('/api/auth/refresh', { method: 'POST', securePayload: {} }),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', securePayload: {} }),
    updateProfile: (patch: ProfilePatch) =>
      request<{ user: SessionUser }>('/api/auth/profile', { method: 'PATCH', securePayload: patch }),
    /** 登录账号 / 密码修改：当前密码与新密码在通道内二次加密 */
    updateAccount: (patch: AccountPatch) =>
      request<{ user: SessionUser; changed: string[] }>('/api/auth/account', {
        method: 'PATCH',
        securePayload: async (nonce: string) => {
          const payload: Record<string, unknown> = {};
          if (patch.username !== undefined) payload.username = patch.username;
          if (patch.currentPassword) payload.currentPassword = await sealSecretField(nonce, patch.currentPassword);
          if (patch.newPassword) payload.newPassword = await sealSecretField(nonce, patch.newPassword);
          return payload;
        },
      }),
    /**
     * 预留的验证触发入口：站点开关关闭时服务端直接拒绝，
     * 开启后当前返回「通道尚未接入」，接入真实验证服务后无需改动调用方。
     */
    requestVerification: (kind: 'email' | 'phone' | 'realname') =>
      request<{ ok?: boolean }>(`/api/auth/verify/${kind}`, { method: 'POST', securePayload: {} }),
    /**
     * 找回密码：邮箱（预留）/ 站内客服 / 站长求助 / 密保（预留）。
     * 预留渠道服务端返回 501 并附带渠道说明，调用方按正常结果展示即可。
     */
    recover: (input: { account: string; method: 'email' | 'service' | 'master' | 'security' }) =>
      request<RecoveryResult>('/api/auth/recover', {
        method: 'POST',
        securePayload: { account: input.account, method: input.method },
      }),
    /** 我提交过的找回申请：在个人信息里给出完整记录与处理说明 */
    recoveryMine: () => request<{ requests: MyRecoveryItem[] }>('/api/auth/recovery-mine'),
  },

  posts: {
    list: (query: {
      scope?: 'public' | 'mine';
      sort?: 'latest' | 'hot';
      tag?: string;
      q?: string;
      page?: number;
      limit?: number;
      lifecycle?: string;
      reviewStatus?: string;
    }) => request<{ posts: Post[]; total: number; page: number; limit: number }>(withQuery('/api/posts', query)),
    get: (id: number) => request<{ post: Post }>(`/api/posts/${id}`),
    create: (body: {
      content: string;
      mood?: string;
      tags?: string[];
      images?: string[];
      visibility?: Visibility;
      publishAt?: string | null;
      expiresAt?: string | null;
    }) =>
      request<{ post: Post; review: { status: string; flags: string[] } }>('/api/posts', {
        method: 'POST',
        body: json(body),
      }),
    update: (id: number, body: Record<string, unknown>) =>
      request<{ post: Post; review: { status: string; flags: string[] } }>(`/api/posts/${id}`, {
        method: 'PATCH',
        body: json(body),
      }),
    remove: (id: number) => request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),
    like: (id: number) =>
      request<{ liked: boolean; likeCount: number }>(`/api/posts/${id}/like`, { method: 'POST' }),
    report: (id: number, reason: string, detail = '') =>
      request<{ ok: boolean }>(`/api/posts/${id}/report`, {
        method: 'POST',
        body: json({ reason, detail }),
      }),
  },

  messages: {
    list: (postId: number) => request<{ messages: PostMessage[] }>(`/api/posts/${postId}/messages`),
    create: (postId: number, content: string, parentId: number | null = null) =>
      request<{ message: PostMessage; review: { status: string; flags: string[] } }>(
        `/api/posts/${postId}/messages`,
        { method: 'POST', body: json({ content, parentId }) }
      ),
    like: (id: number) =>
      request<{ liked: boolean; likeCount: number }>(`/api/messages/${id}/like`, { method: 'POST' }),
    report: (id: number, reason: string, detail = '') =>
      request<{ ok: boolean }>(`/api/messages/${id}/report`, {
        method: 'POST',
        body: json({ reason, detail }),
      }),
  },

  danmaku: {
    list: (query: { limit?: number; after?: number } = {}) =>
      request<{ danmaku: DanmakuItem[] }>(withQuery('/api/danmaku', query)),
    send: (body: { content: string; color?: string; effect?: DanmakuEffect; mode?: DanmakuMode; postId?: number | null }) =>
      request<{ danmaku: DanmakuItem; review: { status: string; flags: string[] } }>('/api/danmaku', {
        method: 'POST',
        body: json(body),
      }),
    palette: () => request<{ colors: Record<string, PaletteEntry>; effects: DanmakuEffect[] }>('/api/danmaku/palette'),
  },

  ranking: {
    list: (range: 'day' | 'week' | 'month' | 'all', limit = 10) =>
      request<{ range: string; items: RankingItem[] }>(withQuery('/api/ranking', { range, limit })),
    overview: () => request<Overview>('/api/ranking/overview'),
  },

  uploads: {
    images: async (files: File[]) => {
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      return request<{ urls: string[] }>('/api/uploads/images', { method: 'POST', body: form });
    },
  },

  music: {
    list: (all = false) => request<{ tracks: MusicTrack[] }>(withQuery('/api/music', { all: all ? 1 : undefined })),
    upload: async (file: File, title: string, artist: string, duration: number) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', title);
      form.append('artist', artist);
      form.append('duration', String(duration));
      return request<{ track: MusicTrack }>('/api/music', { method: 'POST', body: form });
    },
    update: (id: number, body: { title?: string; artist?: string; sortOrder?: number; enabled?: boolean }) =>
      request<{ track: MusicTrack }>(`/api/music/${id}`, { method: 'PATCH', body: json(body) }),
    remove: (id: number) => request<{ ok: boolean }>(`/api/music/${id}`, { method: 'DELETE' }),
  },

  notifications: {
    list: () => request<{ notifications: NotificationItem[]; unread: number }>('/api/notifications'),
    /** 取走一条「下次进站要弹」的信（服务端取走即标记已弹，不会重复打扰） */
    nextPopup: () => request<{ letters: NotificationItem[] }>('/api/notifications/popup/next', { method: 'POST' }),
    read: (ids?: number[]) =>
      request<{ ok: boolean; unread: number }>('/api/notifications/read', {
        method: 'POST',
        body: json({ ids: ids || [] }),
      }),
  },

  admin: {
    review: (query: { type: 'post' | 'message' | 'danmaku'; status?: string; page?: number; limit?: number }) =>
      request<{ type: string; status: string; total: number; page: number; limit: number; items: ReviewItem[] }>(
        withQuery('/api/admin/review', query)
      ),
    decide: (type: string, id: number, action: 'approve' | 'reject', reason = '') =>
      request<{ ok: boolean }>(`/api/admin/review/${type}/${id}`, { method: 'POST', body: json({ action, reason }) }),
    decideBatch: (items: { type: string; id: number }[], action: 'approve' | 'reject', reason = '') =>
      request<{ ok: boolean; done: number; blocked: { type: string; id: number; error: string }[] }>(
        '/api/admin/review/batch',
        { method: 'POST', body: json({ items, action, reason }) }
      ),
    stats: () => request<AdminStats>('/api/admin/stats'),
    security: (limit = 60) => request<AdminSecurity>(withQuery('/api/admin/security', { limit })),
    unlock: (id: number) =>
      request<{ ok: boolean }>('/api/admin/security/unlock', { method: 'POST', body: json({ id }) }),
    posts: (query: { status?: string; lifecycle?: string; q?: string; deleted?: 0 | 1; page?: number; limit?: number }) =>
      request<{ total: number; page: number; limit: number; posts: AdminPost[] }>(withQuery('/api/admin/posts', query)),
    updatePost: (id: number, body: Record<string, unknown>) =>
      request<{ ok: boolean; lifecycle: string }>(`/api/admin/posts/${id}`, { method: 'PATCH', body: json(body) }),
    deletePost: (id: number, reason = '') =>
      request<{ ok: boolean }>(`/api/admin/posts/${id}/delete`, { method: 'POST', body: json({ reason }) }),
    restorePost: (id: number) =>
      request<{ ok: boolean }>(`/api/admin/posts/${id}/restore`, { method: 'POST' }),
    /** 批量下架 / 批量恢复：越权的条目会原样列在 blocked 里 */
    postsBatch: (ids: number[], action: 'delete' | 'restore', reason = '') =>
      request<BatchResult>('/api/admin/posts/batch', { method: 'POST', body: json({ ids, action, reason }) }),
    users: (query: { q?: string; role?: string; status?: string; page?: number; limit?: number }) =>
      request<{ total: number; page: number; limit: number; users: AdminUser[] }>(withQuery('/api/admin/users', query)),
    /** 封禁：preset 为时长预制（1h/1d/3d/7d/30d/90d/forever/custom），custom 时以 until 为准 */
    ban: (id: number, reason: string, until: string | null, preset = '7d') =>
      request<{ ok: boolean; until: string | null; preset: string }>(`/api/admin/users/${id}/ban`, {
        method: 'POST',
        body: json({ reason, until, preset: preset === 'custom' ? undefined : preset }),
      }),
    unban: (id: number) => request<{ ok: boolean }>(`/api/admin/users/${id}/unban`, { method: 'POST' }),
    /** 批量封禁 / 批量解封：时长对整批生效 */
    usersBatch: (
      ids: number[],
      action: 'ban' | 'unban',
      payload: { reason?: string; until?: string | null; preset?: string } = {}
    ) =>
      request<BatchResult>(`/api/admin/users/batch`, {
        method: 'POST',
        body: json({
          ids,
          action,
          reason: payload.reason,
          until: action === 'ban' && payload.preset !== 'custom' ? undefined : payload.until,
          preset: action === 'ban' ? (payload.preset === 'custom' ? undefined : payload.preset) : undefined,
        }),
      }),
    setRole: (id: number, role: string) =>
      request<{ ok: boolean }>(`/api/admin/users/${id}/role`, { method: 'PATCH', body: json({ role }) }),
    /** 人工核验邮箱 / 手机号 / 实名：仅超级管理员，且对应开关需已开启 */
    verifyUser: (
      id: number,
      body: { emailVerified?: boolean; phoneVerified?: boolean; realVerified?: boolean }
    ) =>
      request<{ ok: boolean; changed: { field: string; verified: boolean }[] }>(
        `/api/admin/users/${id}/verify`,
        { method: 'PATCH', body: json(body) }
      ),
    rules: () => request<{ rules: ReviewRules }>('/api/admin/rules'),
    saveRules: (rules: Partial<ReviewRules>) =>
      request<{ rules: ReviewRules }>('/api/admin/rules', { method: 'PUT', body: json(rules) }),
    siteConfig: () => request<{ config: AdminSiteConfig }>('/api/admin/site-config'),
    saveSiteConfig: (patch: Partial<AdminSiteConfig>) =>
      request<{ config: AdminSiteConfig }>('/api/admin/site-config', { method: 'PUT', body: json(patch) }),
    guests: (query: { page?: number; limit?: number } = {}) =>
      request<{ total: number; page: number; limit: number; guests: GuestLoginItem[] }>(
        withQuery('/api/admin/guests', query)
      ),
    recovery: (query: { status?: string; page?: number; limit?: number } = {}) =>
      request<{
        total: number;
        page: number;
        limit: number;
        status: string;
        requests: RecoveryRequestItem[];
      }>(withQuery('/api/admin/recovery', query)),
    decideRecovery: (id: number, body: { status: 'handled' | 'rejected' | 'open'; note?: string }) =>
      request<{ ok: boolean }>(`/api/admin/recovery/${id}`, { method: 'PATCH', body: json(body) }),
    /** 管理员协助重置口令：返回一次性临时口令，只在这一次响应里出现 */
    resetPassword: (id: number) =>
      request<{ ok: boolean; tempPassword: string; username: string }>(`/api/admin/users/${id}/reset-password`, {
        method: 'POST',
        body: json({}),
      }),
    avatars: () => request<{ avatars: PendingAvatarItem[] }>('/api/admin/avatars'),
    decideAvatar: (id: number, action: 'approve' | 'reject', reason = '') =>
      request<{ ok: boolean }>(`/api/admin/avatars/${id}/decide`, { method: 'POST', body: json({ action, reason }) }),
    reports: (status = 'open') =>
      request<{ reports: ReportItem[] }>(withQuery('/api/admin/reports', { status })),
    /** 处理举报：note 是写给举报人的说明，会随站内信一起送达 */
    resolveReport: (id: number, action: 'remove' | 'dismiss', note = '') =>
      request<{ ok: boolean }>(`/api/admin/reports/${id}/resolve`, {
        method: 'POST',
        body: json({ action, note }),
      }),
    /** 批量忽略 / 批量删除：说明对整批生效 */
    reportsBatch: (ids: number[], action: 'remove' | 'dismiss', note = '') =>
      request<BatchResult>('/api/admin/reports/batch', { method: 'POST', body: json({ ids, action, note }) }),
    /** 站内回复：各收件人群的规模预览 */
    siteMessageTargets: () => request<SiteMessageTargets>('/api/admin/site-messages/targets'),
    /** 站内回复：按人群发站内信（目前仅超级管理员可调用） */
    sendSiteMessage: (input: {
      audience: 'all' | 'registered' | 'role' | 'user';
      role?: string;
      targets?: string[];
      title: string;
      body: string;
      /** 勾上后收件人**下次进站**会弹窗提醒一次 */
      popup?: boolean;
    }) => request<{ ok: boolean; sent: number; audience: string; popup: boolean; missing: string[] }>(
      '/api/admin/site-messages',
      { method: 'POST', body: json(input) }
    ),
    audit: (limit = 60) => request<{ logs: AuditLogItem[] }>(withQuery('/api/admin/audit', { limit })),
  },
};

/** 登录/注册/访客成功后调用：令牌只留在内存，通道升级为已认证通道 */
export function adoptSession(result: AuthResult): SessionUser {
  setToken(result?.token || '');
  markSessionBound();
  return result.user;
}
