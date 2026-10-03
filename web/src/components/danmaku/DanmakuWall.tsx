import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Send, Sparkles } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { DanmakuEffect, DanmakuItem } from '@/api/types';
import { GuestNotice } from '@/components/common/GuestNotice';
import { useInteractionGate } from '@/lib/useInteractionGate';
import { COLOR_KEYS, DANMAKU_COLORS, EFFECT_HINTS, EFFECT_LABELS, colorHex } from '@/lib/constants';
import { useAuth } from '@/store/auth';
import { useFx } from '@/store/fx';
import { useUi } from '@/store/ui';

const LANE_COUNT = 6;
const LANE_HEIGHT = 40;
const CHAR_WIDTH = 15;
/* 六条泳道都还没腾出位置时的重试间隔：越小越跟手，太大会显得空场 */
const LANE_RETRY_MS = 150;

/**
 * 两档密度不是「发得更快」一件事，而是速度、间距、同屏上限一起变：
 * 舒缓像傍晚散步，密集像放学铃响时的走廊。
 */
const DENSITY = {
  normal: {
    minWait: 1400,
    maxWait: 2600,
    speedMin: 40,
    speedMax: 72,
    gapMin: 120,
    gapMax: 260,
    maxActive: 9,
  },
  dense: {
    minWait: 300,
    maxWait: 700,
    speedMin: 96,
    speedMax: 168,
    gapMin: 24,
    gapMax: 80,
    maxActive: 26,
  },
} as const;

type DensityKey = keyof typeof DENSITY;

interface FlyingItem {
  key: string;
  content: string;
  color: string;
  effect: DanmakuEffect;
  lane: number;
  duration: number;
  distance: number;
  mine: boolean;
}

function estimateWidth(text: string) {
  return text.length * CHAR_WIDTH + 26;
}

function pickIn(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function DanmakuText({
  content,
  color,
  effect,
}: {
  content: string;
  color: string;
  effect: DanmakuEffect;
}) {
  const hex = colorHex(color);
  const style = {
    '--dm-color': hex,
    color: effect === 'outline' ? 'transparent' : hex,
    textShadow:
      effect === 'outline'
        ? `0 0 10px ${hex}66`
        : effect === 'glow'
          ? `0 0 7px ${hex}b3, 0 0 18px ${hex}66, 0 1px 2px rgba(0,0,0,.45)`
          : effect === 'trace'
            ? `0 0 6px ${hex}99`
            : `0 0 10px ${hex}80`,
    WebkitTextStroke: effect === 'outline' ? `1px ${hex}` : undefined,
  } as React.CSSProperties;

  return (
    <span className={`dm-text dm-${effect}`} style={style}>
      {content}
    </span>
  );
}

export function DanmakuWall() {
  const user = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const pulse = useFx((s) => s.pulse);
  /* 未登录 / 访客都会被拦下并引导到对应入口 */
  const { allow, isGuest } = useInteractionGate();

  const stageRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<DanmakuItem[]>([]);
  const poolRef = useRef<DanmakuItem[]>([]);
  const poolIdsRef = useRef<Set<number>>(new Set());
  const laneFreeRef = useRef<number[]>(new Array(LANE_COUNT).fill(0));
  const laneBusyRef = useRef<number[]>(new Array(LANE_COUNT).fill(0));
  const laneSpeedRef = useRef<number[]>(new Array(LANE_COUNT).fill(0));
  const lastIdRef = useRef(0);
  const keySeq = useRef(0);
  const pausedRef = useRef(false);
  const pauseStartRef = useRef(0);

  const [flying, setFlying] = useState<FlyingItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [density, setDensity] = useState<DensityKey>('normal');

  const [draft, setDraft] = useState('');
  const [color, setColor] = useState('azure');
  const [effect, setEffect] = useState<DanmakuEffect>('glow');
  const [sending, setSending] = useState(false);

  /* 同屏数量：定时器里要读到最新值，用 ref 跟着 state 走 */
  const activeRef = useRef(0);
  useEffect(() => {
    activeRef.current = flying.length;
  }, [flying]);

  const removeFlying = useCallback((key: string) => {
    setFlying((prev) => prev.filter((f) => f.key !== key));
  }, []);

  /**
   * 只在**真正空出来**的泳道里随机挑一条。
   *
   * 老实现会在六条泳道全忙时退而求其次，挑「最早会空」的那条并把弹幕立刻发出去 ——
   * 那一拍和前一条是重叠的，于是开场几秒后就开始糊成一片。
   * 现在没有空闲泳道就返回 -1，这一拍直接不发，宁缺毋滥，从根上不会重叠。
   */
  const pickFreeLane = useCallback(() => {
    const now = performance.now();
    const free: number[] = [];
    for (let i = 0; i < LANE_COUNT; i += 1) {
      if (laneFreeRef.current[i] <= now) free.push(i);
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : -1;
  }, []);

  const spawn = useCallback((item: DanmakuItem, lane: number, cfg: (typeof DENSITY)[DensityKey], mine = false) => {
    const stage = stageRef.current;
    const width = stage?.clientWidth || 720;
    keySeq.current += 1;
    const key = `${item.id}-${keySeq.current}`;

    const now = performance.now();
    /*
     * 一条泳道的速度必须「锁」到它彻底空掉为止。
     * 泳道空出来只说明前一条的**尾巴**进了屏，它还在往左飞；
     * 此时若换一个更快的速度，后一条会从右边缘追上去把它盖住 ——
     * 所以只有在 laneBusy 到期（前一条已经飞出舞台）时才重新随机速度。
     * 切换密度也走同一条规则，新速度会随泳道逐个自然生效。
     */
    if (laneBusyRef.current[lane] <= now) {
      laneSpeedRef.current[lane] = pickIn(cfg.speedMin, cfg.speedMax);
    }
    const speed = laneSpeedRef.current[lane] || pickIn(cfg.speedMin, cfg.speedMax);

    const textWidth = estimateWidth(item.content);
    const distance = width + textWidth;
    const duration = distance / speed;
    const hold = ((textWidth + pickIn(cfg.gapMin, cfg.gapMax)) / speed) * 1000;

    laneFreeRef.current[lane] = Math.max(now, laneFreeRef.current[lane]) + hold;
    laneBusyRef.current[lane] = Math.max(laneBusyRef.current[lane], now + duration * 1000);

    setFlying((prev) => [
      ...prev.slice(-60),
      { key, content: item.content, color: item.color, effect: item.effect, lane, duration, distance, mine },
    ]);
  }, []);

  const pushItems = useCallback(
    (items: DanmakuItem[]) => {
      const fresh = items.filter((item) => item.id > lastIdRef.current);
      if (!fresh.length) return;
      lastIdRef.current = Math.max(...fresh.map((item) => item.id));
      queueRef.current.push(...fresh);
      // 全部弹幕留存在池中，队列见底时循环复播，避免广场长时间空场
      for (const item of fresh) {
        if (!poolIdsRef.current.has(item.id)) {
          poolIdsRef.current.add(item.id);
          poolRef.current.push(item);
        }
      }
    },
    []
  );

  useEffect(() => {
    let alive = true;
    api.danmaku
      .list({ limit: 90 })
      .then(({ danmaku }) => {
        if (alive) pushItems(danmaku);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pushItems]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const { danmaku } = await api.danmaku.list({ after: lastIdRef.current, limit: 40 });
        pushItems(danmaku);
      } catch {
        /* 静默重试 */
      }
    }, 12000);
    return () => window.clearInterval(timer);
  }, [pushItems]);

  /* 队列见底时把池中弹幕洗牌后重新排入，顺序随机，避免出现固定循环感 */
  const refillQueue = useCallback(() => {
    if (queueRef.current.length || !poolRef.current.length) return;
    const recycled = poolRef.current.slice();
    for (let i = recycled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [recycled[i], recycled[j]] = [recycled[j], recycled[i]];
    }
    queueRef.current.push(...recycled);
  }, []);

  useEffect(() => {
    const cfg = DENSITY[density];
    let timer = 0;

    const schedule = (ms: number) => {
      timer = window.setTimeout(run, ms);
    };

    const run = () => {
      let retrySoon = false;

      if (!pausedRef.current && activeRef.current < cfg.maxActive) {
        const lane = pickFreeLane();
        if (lane < 0) {
          // 六条泳道都还没腾出位置：这一拍不发，过一会儿再来探
          retrySoon = true;
        } else {
          refillQueue();
          const next = queueRef.current.shift();
          if (next) spawn(next, lane, cfg);
          else retrySoon = true;
        }
      }

      // 每次发射间隔都带随机抖动，弹幕不会像节拍器一样规律出现
      schedule(retrySoon ? LANE_RETRY_MS : pickIn(cfg.minWait, cfg.maxWait));
    };

    // 开场先缓一拍，页面刚出来时不至于立刻涌出一排
    schedule(cfg.minWait * 0.6);
    return () => window.clearTimeout(timer);
  }, [spawn, density, pickFreeLane, refillQueue]);

  /*
   * 切换密度时让**已经空掉**的泳道立刻换上新速度，切过去马上有感觉；
   * 还在飞的那几条保持原速飞完再换，避免同轨出现速度差造成追尾。
   */
  useEffect(() => {
    const now = performance.now();
    for (let i = 0; i < LANE_COUNT; i += 1) {
      if (laneBusyRef.current[i] <= now) laneSpeedRef.current[i] = 0;
    }
  }, [density]);

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) {
      pauseStartRef.current = performance.now();
      return;
    }
    if (pauseStartRef.current) {
      // 恢复时把泳道计时整体后移，保持暂停前的间距
      const delta = performance.now() - pauseStartRef.current;
      for (let i = 0; i < LANE_COUNT; i += 1) {
        laneFreeRef.current[i] += delta;
        laneBusyRef.current[i] += delta;
      }
      pauseStartRef.current = 0;
    }
  }, [paused]);

  /** 自己发的弹幕：优先立刻飞出去；实在没有空泳道就稍等一拍，不去跟别人叠在一起 */
  const spawnMine = (item: DanmakuItem) => {
    const cfg = DENSITY[density];
    const lane = pickFreeLane();
    if (lane >= 0) {
      spawn(item, lane, cfg, true);
      return;
    }
    window.setTimeout(() => {
      const retry = pickFreeLane();
      if (retry < 0) return;
      spawn(item, retry, cfg, true);
    }, LANE_RETRY_MS * 2);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    if (!allow()) return;
    setSending(true);
    try {
      const { danmaku, review } = await api.danmaku.send({ content, color, effect });
      if (review.status === 'published') {
        spawnMine(danmaku);
        pulse();
        notify('弹幕已飞过广场', 'success');
      } else if (review.status === 'manual_review') {
        notify('弹幕已提交人工复核，通过后会出现', 'warning');
      } else {
        notify(review.flags[0] || '弹幕未通过自动审核', 'danger');
      }
      setDraft('');
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '发送失败，请稍后再试', 'danger');
    } finally {
      setSending(false);
    }
  };

  const colorSwatches = useMemo(
    () =>
      COLOR_KEYS.map((key) => ({
        key,
        ...DANMAKU_COLORS[key],
      })),
    []
  );

  return (
    <section className="card danmaku-card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <Sparkles size={15} />
            流动的弹幕
            <span className="card-sub">正在飞过的心事</span>
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <div className="segmented">
            <button
              type="button"
              data-active={density === 'normal'}
              onClick={() => setDensity('normal')}
              title="少而慢：同一时刻最多 9 条，慢慢飘过"
            >
              舒缓
            </button>
            <button
              type="button"
              data-active={density === 'dense'}
              onClick={() => setDensity('dense')}
              title="多而快：同屏最多 26 条，快速刷过"
            >
              密集
            </button>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? '继续播放弹幕' : '暂停弹幕'}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
        </div>
      </div>

      <div
        className="danmaku-stage"
        ref={stageRef}
        data-paused={paused}
        style={{ height: LANE_COUNT * LANE_HEIGHT + 16 }}
      >
        {flying.map((item) => (
          <div
            key={item.key}
            className="danmaku-fly"
            style={{
              top: item.lane * LANE_HEIGHT + 8,
              animationDuration: `${item.duration}s`,
              '--dm-distance': `${item.distance}px`,
              '--dm-play': paused ? 'paused' : 'running',
            } as React.CSSProperties}
            onAnimationEnd={() => removeFlying(item.key)}
            title={item.mine ? '你发送的弹幕' : undefined}
          >
            <DanmakuText content={item.content} color={item.color} effect={item.effect} />
          </div>
        ))}

        {flying.length === 0 && <div className="danmaku-idle">弹幕正在路上，稍等片刻</div>}
      </div>

      <form className="danmaku-composer" onSubmit={submit}>
        {isGuest ? (
          <GuestNotice
            title="访客不能发送弹幕"
            desc="访客账号只能浏览全站内容与弹幕。注册一个正式账号后，就能写下自己的话了。"
          />
        ) : (
          <>
        <div className="dm-input-row">
          <input
            className="input"
            value={draft}
            maxLength={60}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={user ? '写一句想让它飘过去的话（最多 60 字）' : '登录后即可发送弹幕'}
            aria-label="弹幕内容"
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
            <Send size={14} />
            {sending ? '发送中…' : '发射'}
          </button>
        </div>

        <div className="dm-options">
          <div className="dm-option-group">
            <span className="dm-option-label">颜色</span>
            <div className="dm-swatches">
              {colorSwatches.map((swatch) => (
                <button
                  key={swatch.key}
                  type="button"
                  className="dm-swatch"
                  data-active={color === swatch.key}
                  style={{ '--dm-color': swatch.hex } as React.CSSProperties}
                  onClick={() => setColor(swatch.key)}
                  title={swatch.label}
                  aria-label={`颜色 ${swatch.label}`}
                />
              ))}
            </div>
          </div>

          <div className="dm-option-group">
            <span className="dm-option-label">光效</span>
            <div className="dm-effects">
              {(Object.keys(EFFECT_LABELS) as DanmakuEffect[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="dm-effect-chip"
                  data-active={effect === key}
                  onClick={() => setEffect(key)}
                  title={EFFECT_HINTS[key]}
                >
                  {EFFECT_LABELS[key]}
                </button>
              ))}
            </div>
          </div>
        </div>
          </>
        )}
      </form>
    </section>
  );
}