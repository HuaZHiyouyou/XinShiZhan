import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { relativeTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { Empty } from '@/components/common/Empty';

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

export function NotificationBell() {
  const user = useAuth((s) => s.user);
  const items = useNotifications((s) => s.items);
  const unread = useNotifications((s) => s.unread);
  const loading = useNotifications((s) => s.loading);
  const refresh = useNotifications((s) => s.refresh);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const openDetail = useNotifications((s) => s.openDetail);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!user) return null;

  return (
    <div className="dropdown-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn-icon"
        data-active={open}
        onClick={() => {
          setOpen((v) => !v);
          /* 打开时补拉一次，看到的就是此刻最新的 */
          if (!open) void refresh();
        }}
        aria-label="站内信"
      >
        <Bell size={17} />
        {unread > 0 && <span className="dot-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="dropdown dropdown-wide"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            <div className="dropdown-head">
              <span className="card-title" style={{ fontSize: 13 }}>
                站内信
                {loading && <Loader2 size={12} className="spin" />}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => void markAllRead()}
                disabled={!unread}
              >
                <CheckCheck size={13} />
                全部已读
              </button>
            </div>
            <div className="dropdown-body">
              {items.length === 0 && <Empty title="暂时没有新的消息" />}
              {items.map((item) => (
                /* 整条可点：列表里只放得下摘要，点开看全文 */
                <button
                  key={item.id}
                  type="button"
                  className="notice-item notice-open"
                  data-unread={!item.read}
                  onClick={() => {
                    openDetail(item);
                    setOpen(false);
                  }}
                >
                  <div className="row-between">
                    <span className="tag tag-primary">{TYPE_LABEL[item.type] || item.type}</span>
                    <span className="faint" style={{ fontSize: 11 }}>
                      {relativeTime(item.createdAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</div>
                  {item.body && (
                    <div className="muted notice-preview" style={{ fontSize: 12 }}>
                      {item.body}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
