import { useEffect } from 'react';
import { X } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';

const TYPE_LABEL: Record<string, string> = {
  system: '系统',
  review: '审核',
  like: '共鸣',
  reply: '回应',
  ban: '账号',
  publish: '发布',
  recovery: '找回',
  site: '站内回复',
};

const TYPE_TONE: Record<string, string> = {
  system: 'tag-primary',
  review: 'tag-warning',
  like: 'tag-teal',
  reply: 'tag-teal',
  ban: 'tag-danger',
  publish: 'tag-sand',
  recovery: 'tag-primary',
  site: 'tag-primary',
};

/**
 * 站内信正文。
 *
 * 列表里只放得下摘要，长一点的说明会被截断 —— 点开这里看全文。
 * 挂在 AppShell 上，铃铛下拉与站内信页面共用同一个弹窗。
 */
export function NotificationLetter() {
  const detail = useNotifications((s) => s.detail);
  const close = useNotifications((s) => s.closeDetail);

  useBodyScrollLock(Boolean(detail));

  useEffect(() => {
    if (!detail) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detail, close]);

  if (!detail) return null;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="站内信正文" onClick={close}>
      <div className="modal-card letter-card" onClick={(event) => event.stopPropagation()}>
        <div className="card-head">
          <div className="row" style={{ gap: 'var(--sp-2)', minWidth: 0 }}>
            <span className={`tag ${TYPE_TONE[detail.type] || 'tag-primary'}`}>
              {TYPE_LABEL[detail.type] || detail.type}
            </span>
            <span className="faint" style={{ fontSize: 11 }}>
              {formatDateTime(detail.createdAt)}
            </span>
          </div>
          <button type="button" className="btn-icon" onClick={close} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="card-pad stack" style={{ gap: 'var(--sp-3)' }}>
          <h2 className="letter-title">{detail.title}</h2>
          <div className="letter-body">{detail.body || '（这封信没有正文）'}</div>
        </div>

        <div className="letter-foot">
          <button type="button" className="btn btn-primary btn-sm" onClick={close}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
