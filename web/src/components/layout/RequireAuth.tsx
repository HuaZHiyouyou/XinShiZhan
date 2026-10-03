import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Empty, Spinner } from '@/components/common/Empty';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';

interface Props {
  children: ReactNode;
  title?: string;
}

/* 个人页面守卫：未登录时不渲染内容，直接给出登录引导，避免打出一堆注定失败的接口请求 */
export function RequireAuth({ children, title = '这个页面需要先登录' }: Props) {
  const user = useAuth((s) => s.user);
  const ready = useAuth((s) => s.ready);
  const openAuth = useUi((s) => s.openAuth);

  if (!ready) {
    return (
      <div className="card">
        <Spinner label="正在确认身份…" />
      </div>
    );
  }

  if (user) return <>{children}</>;

  return (
    <Empty
      icon={<Lock size={26} />}
      title={title}
      desc="登录后就能查看与管理自己的心事、资料、站内信与偏好设置"
      action={
        <div className="row" style={{ gap: 'var(--sp-2)', justifyContent: 'center' }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => openAuth('login')}>
            去登录
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => openAuth('register')}>
            注册新账号
          </button>
        </div>
      }
    />
  );
}
