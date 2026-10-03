import { create } from 'zustand';

/**
 * 顶部进度条的真实数据源。
 *
 * 由 api/client 在每次请求进出时打点 —— 所以它反映的是**真的有东西在加载**，
 * 而不是「路由变了就假装加载一下」。切页时页面组件自己去拉数据，
 * 请求一发出去条就动，数据回来条就收。
 *
 * 两个时间参数都是为了观感：
 *   · SHOW_DELAY：几十毫秒就返回的请求不该闪一下；
 *   · MIN_VISIBLE：已经显示出来了就至少留一会儿，否则像眼花了。
 */
const SHOW_DELAY = 130;
const MIN_VISIBLE = 320;

let showTimer: number | null = null;
let hideTimer: number | null = null;

interface ProgressState {
  /** 进行中的请求数 */
  active: number;
  visible: boolean;
  start: () => void;
  end: () => void;
}

export const useProgress = create<ProgressState>((set, get) => ({
  active: 0,
  visible: false,

  start: () => {
    const next = get().active + 1;
    set({ active: next });
    /* 有新请求就把「收尾」取消掉，条子继续跑 */
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (next === 1 && !get().visible && showTimer === null) {
      showTimer = window.setTimeout(() => {
        showTimer = null;
        set({ visible: true });
      }, SHOW_DELAY);
    }
  },

  end: () => {
    const next = Math.max(0, get().active - 1);
    set({ active: next });
    if (next > 0) return;

    if (showTimer !== null) {
      /* 还没露面就结束了，那就不露面 */
      window.clearTimeout(showTimer);
      showTimer = null;
    }
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      set({ visible: false });
    }, MIN_VISIBLE);
  },
}));
