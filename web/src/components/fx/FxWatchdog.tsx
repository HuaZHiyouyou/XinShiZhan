import { useEffect, useRef } from 'react';
import { lowerQuality, useFx, type FxQuality } from '@/store/fx';
import { useUi } from '@/store/ui';

const LABEL: Record<FxQuality, string> = { lush: '华丽', balanced: '均衡', calm: '静谧' };

/** 预热时长：首屏字体、图片与首帧渲染都会拉低帧率，这段时间的采样不算数 */
const WARMUP_MS = 6000;
/** 单个采样窗口长度，窗口结束时结算一次平均帧率 */
const WINDOW_MS = 3000;
/** 低于这个帧率才认为动效在拖后腿；30 帧及以上一律不提醒 */
const LOW_FPS = 30;
/** 连续多少个窗口都偏低才开口，避免滚动长列表时的偶发掉帧误判 */
const LOW_STREAK = 2;

/** 背景画质运行时看门狗：实测帧率，卡了就问用户要不要降档，绝不静默改动设置。
 *  检测本身可以在设置里关掉；帧率不低于 30fps 时也绝不打扰。 */
export function FxWatchdog() {
  const effective = useFx((s) => s.effective);
  const enabled = useFx((s) => s.watchdog);
  const askConfirm = useUi((s) => s.askConfirm);
  const prompted = useRef(false);

  useEffect(() => {
    /* 用户在设置里关掉了帧率检测提醒 */
    if (!enabled) return undefined;
    /* 静谧档已是最省的一档，没有再降的空间，也就不必采样 */
    if (effective === 'calm') return undefined;

    /* 重新开启检测或改动画质后重新给一次机会，避免这一轮再也不开口 */
    prompted.current = false;

    let raf = 0;
    let windowStart = 0;
    let frames = 0;
    let lowStreak = 0;
    const armedAt = performance.now() + WARMUP_MS;

    const reset = () => {
      windowStart = 0;
      frames = 0;
    };

    const promptOnce = (fps: number) => {
      if (prompted.current) return;
      prompted.current = true;
      const current = useFx.getState().quality;
      const next = lowerQuality(current);
      if (!next) return;
      askConfirm({
        title: '背景动效似乎有点吃力',
        message: `最近 ${Math.round((WINDOW_MS * LOW_STREAK) / 1000)} 秒实测平均约 ${Math.round(fps)} fps，低于 ${LOW_FPS} fps 的提醒线。要把画质从「${LABEL[current]}」降到「${LABEL[next]}」吗？也可以保持不变，之后在设置里随时调整或关掉这项检测。`,
        confirmText: `降到${LABEL[next]}档`,
        tone: 'default',
        onConfirm: () => {
          useFx.getState().setQuality(next);
          useUi.getState().notify(`背景画质已切到${LABEL[next]}档`, 'success');
        },
      });
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      /* 页面不可见时 rAF 会被节流，这类采样直接丢掉 */
      if (document.hidden || now < armedAt) {
        reset();
        return;
      }

      if (!windowStart) {
        windowStart = now;
        frames = 0;
      }
      frames += 1;

      const span = now - windowStart;
      if (span < WINDOW_MS) return;

      const fps = (frames * 1000) / span;
      reset();

      /* 30 帧及以上视为流畅，直接清零连续偏低的计数，不提醒 */
      if (fps >= LOW_FPS) {
        lowStreak = 0;
        return;
      }
      lowStreak += 1;
      if (lowStreak >= LOW_STREAK) promptOnce(fps);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, effective, askConfirm]);

  return null;
}
