import { useCallback } from 'react';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';

/**
 * 互动闸门（前端侧）。
 *
 * 服务端对访客是硬性只读的，这里负责把「为什么不能点」讲清楚，
 * 并直接把用户送到该去的地方，而不是让他点完只看到一个报错：
 * - 未登录 → 打开登录弹窗
 * - 访客   → 说明只读，并打开注册弹窗
 */
export function useInteractionGate() {
  const user = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const openAuth = useUi((s) => s.openAuth);

  const allow = useCallback(() => {
    if (!user) {
      openAuth('login');
      return false;
    }
    if (user.isGuest) {
      notify('访客账号只能浏览，注册后即可参与互动', 'info');
      openAuth('register');
      return false;
    }
    return true;
  }, [user, notify, openAuth]);

  return { user, allow, isGuest: Boolean(user?.isGuest) };
}
