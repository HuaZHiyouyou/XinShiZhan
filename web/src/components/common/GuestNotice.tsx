import { Ghost } from 'lucide-react';
import { useUi } from '@/store/ui';

/**
 * 访客只读提示。
 * 用在原本要放输入框 / 发布按钮的位置，明确告诉访客「你现在能做什么、怎么才能做更多」。
 */
export function GuestNotice({
  title = '你正在以访客身份浏览',
  desc = '访客账号只能看，不能发言、留言、发弹幕或修改资料。注册一个正式账号即刻解锁全部功能。',
}: {
  title?: string;
  desc?: string;
}) {
  const openAuth = useUi((s) => s.openAuth);

  return (
    <div className="guest-notice">
      <Ghost size={16} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="guest-notice-title">{title}</div>
        <div className="guest-notice-desc">{desc}</div>
      </div>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => openAuth('register')}>
        去注册
      </button>
    </div>
  );
}
