import { useEffect } from 'react';

/**
 * 弹窗打开时锁住页面滚动。
 *
 * 用「计数」而不是直接赋值：多个弹窗可能同时存在（例如弹窗里再开确认框），
 * 谁先关闭都不应该把锁提前解除。
 * 同时补偿滚动条宽度，避免锁住/解锁时页面内容整体左右跳动。
 */
let lockCount = 0;
let savedOverflow = '';
let savedPaddingRight = '';

function applyLock() {
  if (lockCount === 0) {
    const body = document.body;
    savedOverflow = body.style.overflow;
    savedPaddingRight = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function releaseLock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;
  const body = document.body;
  body.style.overflow = savedOverflow;
  body.style.paddingRight = savedPaddingRight;
}

/** active 为 true 时锁住页面滚动，false 或组件卸载时自动解锁 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    applyLock();
    return releaseLock;
  }, [active]);
}
