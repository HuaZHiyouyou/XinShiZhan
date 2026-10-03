import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PenLine, Sparkles, UserRound } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { Post } from '@/api/types';
import { Empty, PostSkeleton } from '@/components/common/Empty';
import { PostCard } from '@/components/post/PostCard';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';

const FILTERS = [
  { key: 'all', label: '全部', query: {} },
  { key: 'live', label: '已上线', query: { lifecycle: 'live' } },
  { key: 'scheduled', label: '定时待发', query: { lifecycle: 'scheduled' } },
  { key: 'draft', label: '未上线', query: { lifecycle: 'draft' } },
  { key: 'expired', label: '已过期', query: { lifecycle: 'expired' } },
  { key: 'review', label: '待复核', query: { reviewStatus: 'manual_review' } },
  { key: 'rejected', label: '未通过', query: { reviewStatus: 'rejected' } },
] as const;

export function Mine() {
  const user = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const commentLayout = useUi((s) => s.commentLayout);
  const openComments = useUi((s) => s.openComments);
  const openAuth = useUi((s) => s.openAuth);

  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [inlineId, setInlineId] = useState<number | null>(null);

  const active = FILTERS.find((f) => f.key === filter) || FILTERS[0];

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.posts.list({ scope: 'mine', page: 1, limit: 50, ...active.query });
      setPosts(data.posts);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '加载失败', 'danger');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [user, active.query, notify]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) {
    return (
      <Empty
        title="登录后才能查看自己的心事"
        desc="这里会保存你发布过的全部内容，包括定时与限时的那部分"
        action={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openAuth('login')} style={{ marginTop: 'var(--sp-2)' }}>
            去登录
          </button>
        }
      />
    );
  }

  return (
    <div className="mine-layout">
      <div className="page-head">
        <h1 className="page-title">我的心事</h1>
        <p className="page-desc">这里是你写下的全部内容，包含尚未上线与已经过期的那部分</p>
      </div>

      <div className="feed-toolbar">
        <div className="segmented segmented-wrap">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              data-active={filter === item.key}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <Link className="btn btn-sm btn-ghost" to="/profile">
            <UserRound size={13} />
            个人信息
          </Link>
          <Link className="btn btn-sm btn-primary" to="/">
            <PenLine size={13} />
            写新心事
          </Link>
        </div>
      </div>

      {loading ? (
        <PostSkeleton count={2} />
      ) : posts.length === 0 ? (
        <Empty
          icon={<Sparkles size={26} />}
          title="这个分类下还没有内容"
          desc={filter === 'all' ? '去广场写下第一件心事吧' : '换个分类看看'}
        />
      ) : (
        <div className="feed stagger">
          {posts.map((post, index) => (
            <PostCard
              key={post.id}
              style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
              post={post}
              commentsOpen={commentLayout === 'inline' && inlineId === post.id}
              renderComments={commentLayout === 'inline' && inlineId === post.id}
              onUpdate={(next) => setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)))}
              onRemove={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
              onToggleComments={(target) =>
                commentLayout === 'drawer'
                  ? openComments(target.id)
                  : setInlineId((prev) => (prev === target.id ? null : target.id))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}