import { create } from 'zustand';

/** 画质档位：华丽 / 均衡 / 静谧（默认均衡） */
export type FxQuality = 'lush' | 'balanced' | 'calm';

const LEVELS: FxQuality[] = ['calm', 'balanced', 'lush'];
const STORAGE_KEY = 'xsz.fxQuality';
const WATCHDOG_KEY = 'xsz.fxWatchdog';

function isQuality(value: unknown): value is FxQuality {
  return value === 'lush' || value === 'balanced' || value === 'calm';
}

function readQuality(): FxQuality {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isQuality(saved)) return saved;
  } catch {
    /* 忽略隐私模式下的存储失败 */
  }
  return 'balanced';
}

/** 帧率检测提醒开关：默认开启，显式存过 'off' 才视为关闭 */
function readWatchdog(): boolean {
  try {
    return localStorage.getItem(WATCHDOG_KEY) !== 'off';
  } catch {
    return true;
  }
}

function detectReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 相邻的低一档画质；已是最低档时返回 null */
export function lowerQuality(quality: FxQuality): FxQuality | null {
  const index = LEVELS.indexOf(quality);
  return index > 0 ? LEVELS[index - 1] : null;
}

/** 只有系统「减弱动效」这一条硬规则会覆盖用户选择。
 *  设备性能好不好不做猜测，交给运行时看门狗实测帧率后再弹窗询问。 */
function resolve(quality: FxQuality, reducedMotion: boolean): FxQuality {
  return reducedMotion ? 'calm' : quality;
}

function apply(fx: FxQuality) {
  document.documentElement.dataset.fx = fx;
}

interface FxState {
  /** 用户在设置里选择的档位 */
  quality: FxQuality;
  /** 实际生效的档位，可能被系统「减弱动效」覆盖 */
  effective: FxQuality;
  reducedMotion: boolean;
  /** 是否开启帧率检测提醒：关闭后看门狗完全不采样、不弹窗 */
  watchdog: boolean;
  /** 自增令牌：每 +1 触发一次背景辉光脉冲（发布心事、发送弹幕时调用） */
  pulseToken: number;
  setQuality: (quality: FxQuality) => void;
  setWatchdog: (enabled: boolean) => void;
  revalidate: () => void;
  pulse: () => void;
}

const initialQuality = readQuality();
const initialReduced = detectReducedMotion();
const initialEffective = resolve(initialQuality, initialReduced);
const initialWatchdog = readWatchdog();
apply(initialEffective);

export const useFx = create<FxState>((set, get) => ({
  quality: initialQuality,
  effective: initialEffective,
  reducedMotion: initialReduced,
  watchdog: initialWatchdog,
  pulseToken: 0,

  setQuality: (quality) => {
    try {
      localStorage.setItem(STORAGE_KEY, quality);
    } catch {
      /* 忽略存储失败 */
    }
    const reducedMotion = get().reducedMotion;
    const effective = resolve(quality, reducedMotion);
    apply(effective);
    set({ quality, effective });
  },

  setWatchdog: (enabled) => {
    try {
      localStorage.setItem(WATCHDOG_KEY, enabled ? 'on' : 'off');
    } catch {
      /* 忽略存储失败 */
    }
    set({ watchdog: enabled });
  },

  revalidate: () => {
    const reducedMotion = detectReducedMotion();
    const { quality } = get();
    const effective = resolve(quality, reducedMotion);
    apply(effective);
    set({ reducedMotion, effective });
  },

  pulse: () => set({ pulseToken: get().pulseToken + 1 }),
}));

/* 系统「减弱动效」开关可能在运行中被改动，这里跟随一次 */
try {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onChange = () => useFx.getState().revalidate();
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else mq.addListener(onChange);
} catch {
  /* 老浏览器无 matchMedia 时保持初始判定 */
}
