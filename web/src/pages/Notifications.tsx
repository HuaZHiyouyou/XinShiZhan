import { useEffect } from 'react';
import { BellRing, CheckCheck, Loader2, RefreshCw } from 'lucide-react';
import { Empty, SkeletonList } from '@/components/common/Empty';
import { formatDateTime, relativeTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { useUi } from '@/store/ui';

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

export function Notifications() {
  const user = useAuth((s) => s.user);
  const openAuth = useUi((s) => s.openAuth);
  const notify = useUi((s) => s.notify);

  /* 列表与未读数都来自全局那一份，铃铛、侧栏、这里始终是同一个事实 */
  const items = useNotifications((s) => s.items);
  const unread = useNotifications((s) => s.unread);
  const loading = useNotifications((s) => s.loading);
  const loaded = useNotifications((s) => s.loaded);
  const refresh = useNotifications((s) => s.refresh);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const openDetail = useNotifications((s) => s.openDetail);

  useEffect(() => {
    if (user) void refresh();
  }, [user?.id, refresh]);

  if (!user) {
    return (
      <Empty
        title="登录后查看站内信"
        desc="审核结果、他人回应与账号变动都会在这里通知你"
        action={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => openAuth('login')}
            style={{ marginTop: 'var(--sp-2)' }}
          >
            去登录
          </button>
        }
      />
    );
  }

  const markAll = async () => {
    const ok = await markAllRead();
    notify(
      ok ? '已全部标记为已读' : '操作失败，请稍后再试',
      ok ? 'success' : 'danger'
    );
  };

  /* 首屏还没拿到数据时才铺骨架，之后的轮询静默进行 */
  if (loading && !loaded) return <SkeletonList rows={5} body={1} />;

  return (
    <div className="notice-layout">
      <div className="page-head">
        <h1 className="page-title">站内信</h1>
        <p className="page-desc">{unread > 0 ? `有 ${unread} 条未读消息` : '所有消息都已读'}</p>
      </div>

      <div className="feed-toolbar">
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <BellRing size={14} />
          <span className="muted" style={{ fontSize: 12 }}>
            共 {items.length} 条
          </span>
          {/* 轮询之外也留一个手动入口，等不及的时候点一下 */}
          {loading && <Loader2 size={12} className="spin" />}
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={13} />
            刷新
          </button>
          <button type="button" className="btn btn-sm" onClick={markAll} disabled={!unread}>
            <CheckCheck size={13} />
            全部标记已读
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <Empty title="暂时没有消息" />
      ) : (
        <div className="stack stagger">
          {items.map((item, index) => (
            /* 点任意一条打开全文；长说明在列表里只显示两行 */
            <button
              key={item.id}
              type="button"
              className="card card-pad notice-row notice-open"
              data-unread={!item.read}
              style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
              onClick={() => openDetail(item)}
            >
              <div className="row-between">
                <span className={`tag ${TYPE_TONE[item.type] || 'tag-primary'}`}>
                  {TYPE_LABEL[item.type] || item.type}
                </span>
                <span className="faint" style={{ fontSize: 11 }} title={formatDateTime(item.createdAt)}>
                  {relativeTime(item.createdAt)}
                </span>
              </div>
              <div className="notice-title">{item.title}</div>
              {item.body && <p className="muted notice-body clamp-2">{item.body}</p>}
              <span className="notice-more">点击查看全文</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
