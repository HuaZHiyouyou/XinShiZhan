import { useEffect } from 'react';
import { Megaphone, X } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useNotifications } from '@/store/notifications';
import { useAuth } from '@/store/auth';

/**
 * 「下次进站弹窗一次」的公告。
 *
 * 与普通的信件弹窗刻意做得不一样：这个是**被推到眼前**的，
 * 所以要更明确地告诉用户「这是一条要你留意的通知」，而不是一封信。
 * 关掉即出队；服务端那边在取走时就已经标记过，不会下次再弹。
 */
export function NotificationPopup() {
  const user = useAuth((s) => s.user);
  const queue = useNotifications((s) => s.popupQueue);
  const pullPopups = useNotifications((s) => s.pullPopups);
  const dismiss = useNotifications((s) => s.dismissPopup);

  /* 每次进站只拉一次：正在浏览的人不该被临时公告打断 */
  useEffect(() => {
    if (!user) return;
    void pullPopups();
  }, [user?.id, pullPopups]);

  const current = queue[0] || null;
  useBodyScrollLock(Boolean(current));

  useEffect(() => {
    if (!current) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, dismiss]);

  if (!current) return null;

  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-label="重要通知">
      <div className="modal-card popup-card">
        <div className="popup-head">
          <span className="popup-badge">
            <Megaphone size={14} />
            重要通知
          </span>
          <button type="button" className="btn-icon" onClick={dismiss} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="card-pad stack" style={{ gap: 'var(--sp-3)' }}>
          <h2 className="letter-title">{current.title}</h2>
          <div className="letter-body">{current.body || '（这封信没有正文）'}</div>
          <span className="faint" style={{ fontSize: 11 }}>
            {formatDateTime(current.createdAt)}
            {queue.length > 1 ? ` · 还有 ${queue.length - 1} 条` : ''}
          </span>
        </div>

        <div className="letter-foot">
          <button type="button" className="btn btn-primary btn-sm" onClick={dismiss}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
