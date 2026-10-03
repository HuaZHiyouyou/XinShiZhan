import { create } from 'zustand';
import { adoptSession, api, ApiError, setToken } from '@/api/client';
import type { AccountPatch, SessionUser } from '@/api/types';

/** 注册表单入参：昵称与联系方式/实名均为可选（后两者受站点开关控制） */
export interface RegisterInput {
  username: string;
  password: string;
  confirm: string;
  nickname?: string;
  email?: string;
  phone?: string;
  realName?: string;
  idNumber?: string;
}

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  busy: boolean;
  /** 安全校验（工作量证明）已尝试次数，0 表示当前没有在算 */
  securing: number;
  bootstrap: () => Promise<void>;
  login: (username: string, password: string, honeypot?: string) => Promise<void>;
  register: (input: RegisterInput, honeypot?: string) => Promise<void>;
  guestLogin: (honeypot?: string) => Promise<void>;
  /** 用户关掉登录弹窗时调用：立即复位按钮与进度，并让在途请求的结果作废 */
  cancelAuth: () => void;
  logout: () => Promise<void>;
  updateAccount: (patch: AccountPatch) => Promise<SessionUser>;
  patchUser: (patch: Partial<SessionUser>) => void;
  /**
   * 重新向服务端确认「我是谁」。
   * 审核、封禁、角色调整这类**由别人发起**的变更不会经过本地的写接口，
   * 界面要跟上就必须主动拉一次，否则资料页会停在上一次快照上。
   */
  refreshUser: () => Promise<void>;
}

/**
 * 认证流程的代次号。
 * 每次发起登录/注册/访客进入都会自增，回调里拿着自己的代次号比对：
 * 只要用户中途关掉了弹窗（cancelAuth 再次自增），旧请求的结果与进度就全部丢弃，
 * 不会再出现「按钮卡在处理中」「进度数字乱跳」这类残留状态。
 */
let authSeq = 0;

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  busy: false,
  securing: 0,

  /* 登录态以 httpOnly Cookie 为准：启动时直接问服务端「我是谁」，
     不再依赖本地存储的令牌，避免凭据被脚本读取或长期残留。 */
  bootstrap: async () => {
    try {
      const { user } = await api.auth.me();
      set({ user, ready: true });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 0)) setToken(null);
      set({ user: null, ready: true });
    }
  },

  login: async (username, password, honeypot = '') => {
    const seq = ++authSeq;
    set({ busy: true, securing: 0 });
    try {
      const result = await api.auth.login(username, password, honeypot, (tries) => {
        if (seq === authSeq) set({ securing: tries });
      });
      if (seq !== authSeq) return;
      adoptSession(result);
      set({ user: result.user, busy: false, securing: 0 });
    } catch (error) {
      if (seq === authSeq) set({ busy: false, securing: 0 });
      throw error;
    }
  },

  register: async (input, honeypot = '') => {
    const seq = ++authSeq;
    set({ busy: true, securing: 0 });
    try {
      const result = await api.auth.register(input, honeypot, (tries) => {
        if (seq === authSeq) set({ securing: tries });
      });
      if (seq !== authSeq) return;
      adoptSession(result);
      set({ user: result.user, busy: false, securing: 0 });
    } catch (error) {
      if (seq === authSeq) set({ busy: false, securing: 0 });
      throw error;
    }
  },

  guestLogin: async (honeypot = '') => {
    const seq = ++authSeq;
    set({ busy: true, securing: 0 });
    try {
      const result = await api.auth.guest(honeypot);
      if (seq !== authSeq) return;
      adoptSession(result);
      set({ user: result.user, busy: false, securing: 0 });
    } catch (error) {
      if (seq === authSeq) set({ busy: false, securing: 0 });
      throw error;
    }
  },

  cancelAuth: () => {
    /* 代次号一涨，在途请求的结果与进度回调就全部失效，界面立刻回到可交互状态 */
    authSeq += 1;
    set({ busy: false, securing: 0 });
  },

  logout: async () => {
    /* 本地先清空，保证界面立刻回到未登录态；服务端会话注销失败也不阻塞 */
    setToken(null);
    set({ user: null });
    try {
      await api.auth.logout();
    } catch {
      /* 忽略：Cookie 可能已随服务端会话过期失效 */
    }
    if (get().user) set({ user: null });
  },

  updateAccount: async (patch) => {
    const { user } = await api.auth.updateAccount(patch);
    set({ user });
    return user;
  },

  patchUser: (patch) => {
    const current = get().user;
    if (!current) return;
    set({ user: { ...current, ...patch } });
  },

  refreshUser: async () => {
    /* 未登录时没什么可刷新的，直接返回，避免多余的 401 */
    if (!get().user) return;
    try {
      const { user } = await api.auth.me();
      set({ user });
    } catch {
      /* 会话已失效时保持现状，交给下一次请求去触发登录引导 */
    }
  },
}));
