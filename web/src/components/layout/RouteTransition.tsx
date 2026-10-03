import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useProgress } from '@/store/progress';

/**
 * 页面切换的两件事：
 *
 * 1. **进场动画**：按 pathname 换 key，新页面淡入并轻微上移。
 *    这里刻意不做「退出动画」—— 退场要等动画跑完才挂载新页面，
 *    反而让每次点击都多等 200ms；只让新内容浮上来，体感更跟手。
 *
 * 2. **把页面滚回顶部**：换了一页却停在上一页的滚动位置，
 *    会让人以为内容没变。
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [token, setToken] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    /* 换页/换查询条件时回到顶部，并触发一次重排让进场动画重新跑 */
    window.scrollTo({ top: 0, behavior: 'auto' });
    setToken((v) => v + 1);
  }, [location.pathname, location.search]);

  return (
    <div key={token} className="page-enter">
      {children}
    </div>
  );
}

/**
 * 顶部进度条，受真实请求数驱动（见 store/progress）。
 * 挂在 AppShell 里一次即可，全局共用。
 */
export function RouteProgress() {
  const visible = useProgress((s) => s.visible);
  return <div className="route-bar" data-active={visible} role="progressbar" aria-label="正在加载" />;
}
