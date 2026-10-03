import { create } from 'zustand';
import { api } from '@/api/client';
import type { NotificationItem } from '@/api/types';
import { useAuth } from '@/store/auth';

/** 站内信的轮询间隔：够快，又不至于把服务端当心跳打 */
const POLL_MS = 20_000;

/**
 * 站内信的唯一数据源。
 *
 * 铃铛下拉、侧栏红点、站内信页面都读这一份状态，
 * 任何一处标记已读，其它地方立刻同步 —— 不会再出现
 * 「页面里全读完了，侧栏红点还在」这种各说各话的情况。
 */
interface NotificationsState {
  items: NotificationItem[];
  unread: number;
  loading: boolean;
  /** 已拉到过数据（避免首屏闪一下空状态） */
  loaded: boolean;
  /** 正在展开查看的那封信；列表只显示摘要，正文在这里看全 */
  detail: NotificationItem | null;
  /** 「下次进站弹窗」排队：一次拉取可能带回多封，逐封关掉 */
  popupQueue: NotificationItem[];
  /**
   * 取一次待弹的信。
   * **每次进站只调一次** —— 这样正在浏览的人不会被临时发来的公告打断，
   * 也让「下次进站弹一次」的语义落在「进站」这个动作上。
   */
  pullPopups: () => Promise<void>;
  dismissPopup: () => void;
  refresh: () => Promise<void>;
  markAllRead: () => Promise<boolean>;
  markRead: (ids: number[]) => Promise<void>;
  /** 打开信件：顺手标记已读，不用再点一次 */
  openDetail: (item: NotificationItem) => void;
  closeDetail: () => void;
  /** 登出时清空，避免把上一个人的站内信留给下一个人 */
  reset: () => void;
}

export const useNotifications = create<NotificationsState>((set, get) => ({
  items: [],
  unread: 0,
  loading: false,
  loaded: false,
  detail: null,
  popupQueue: [],

  pullPopups: async () => {
    if (!useAuth.getState().user) return;
    try {
      const { letters } = await api.notifications.nextPopup();
      if (letters.length) set({ popupQueue: letters });
    } catch {
      /* 弹窗不是关键路径，失败就安静跳过 */
    }
  },

  dismissPopup: () => set((state) => ({ popupQueue: state.popupQueue.slice(1) })),

  refresh: async () => {
    if (!useAuth.getState().user) return;
    set({ loading: true });
    try {
      const { notifications, unread } = await api.notifications.list();
      set({ items: notifications, unread, loaded: true });
      /* 侧栏红点直接读 user.unreadNotifications，顺手校准一次 */
      useAuth.getState().patchUser({ unreadNotifications: unread });
    } catch {
      /* 网络抖动时保留上一次的数据，比清空更好 */
    } finally {
      set({ loading: false });
    }
  },

  markAllRead: async () => {
    try {
      const { unread } = await api.notifications.read();
      set((state) => ({
        items: state.items.map((item) => ({ ...item, read: true })),
        unread,
      }));
      useAuth.getState().patchUser({ unreadNotifications: unread });
      return true;
    } catch {
      return false;
    }
  },

  markRead: async (ids) => {
    if (!ids.length) return;
    try {
      const { unread } = await api.notifications.read(ids);
      const done = new Set(ids);
      set((state) => ({
        items: state.items.map((item) => (done.has(item.id) ? { ...item, read: true } : item)),
        unread,
      }));
      useAuth.getState().patchUser({ unreadNotifications: unread });
    } catch {
      /* 静默：下次轮询会纠正 */
    }
  },

  openDetail: (item) => {
    set({ detail: item });
    if (!item.read) void get().markRead([item.id]);
  },

  closeDetail: () => set({ detail: null }),

  reset: () => set({ items: [], unread: 0, loading: false, loaded: false, detail: null }),
}));

/**
 * 挂一次就够：登录期间定时拉取，页面重新可见 / 回到前台时立刻补一次。
 * 页面在后台时不发请求，别让一个开着的标签页白烧电。
 */
export function startNotificationSync() {
  const refresh = () => void useNotifications.getState().refresh();
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, POLL_MS);

  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);

  refresh();

  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}
