import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Flame, Hash, Search, Sparkles } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { Post } from '@/api/types';
import { DanmakuWall } from '@/components/danmaku/DanmakuWall';
import { Empty, PostSkeleton } from '@/components/common/Empty';
import { PostCard } from '@/components/post/PostCard';
import { PostComposer } from '@/components/post/PostComposer';
import { RankingList } from '@/components/ranking/RankingList';
import { TAGS } from '@/lib/constants';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';

const PAGE_SIZE = 10;

export function Home() {
  const [params, setParams] = useSearchParams();
  const user = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const commentLayout = useUi((s) => s.commentLayout);
  const openComments = useUi((s) => s.openComments);
  const setCommentLayout = useUi((s) => s.setCommentLayout);

  const keyword = params.get('q') || '';
  const tag = params.get('tag') || '';

  const [sort, setSort] = useState<'latest' | 'hot'>('latest');
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [inlineId, setInlineId] = useState<number | null>(null);

  const load = useCallback(
    async (targetPage: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const data = await api.posts.list({
          sort,
          page: targetPage,
          limit: PAGE_SIZE,
          q: keyword || undefined,
          tag: tag || undefined,
        });
        setPosts((prev) => (append ? [...prev, ...data.posts] : data.posts));
        setTotal(data.total);
        setPage(data.page);
      } catch (error) {
        notify(error instanceof ApiError ? error.message : '内容加载失败', 'danger');
        if (!append) setPosts([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [sort, keyword, tag, notify]
  );

  useEffect(() => {
    load(1, false);
  }, [load]);

  const handleCreated = (post: Post) => {
    if (post.reviewStatus === 'published' && post.lifecycle === 'live' && post.visibility === 'public') {
      setPosts((prev) => [post, ...prev]);
      setTotal((prev) => prev + 1);
    }
  };

  const handleToggleComments = (post: Post) => {
    if (commentLayout === 'drawer') {
      openComments(post.id);
    } else {
      setInlineId((prev) => (prev === post.id ? null : post.id));
    }
  };

  const clearFilter = () => setParams({});

  return (
    <div className="home-layout">
      <div className="home-head">
        <div className="page-head">
          <h1 className="page-title">心事广场</h1>
          <p className="page-desc">
            {keyword
              ? `与「${keyword}」相关的 ${total} 件心事`
              : tag
                ? `标签「${tag}」下有 ${total} 件心事`
                : '所有心事都在这里流动，看到有共鸣的，就留下一点回应'}
          </p>
        </div>

        <DanmakuWall />
      </div>

      <div className="home-main">
        <PostComposer onCreated={handleCreated} />

        <div className="feed-toolbar">
          <div className="segmented">
            <button type="button" data-active={sort === 'latest'} onClick={() => setSort('latest')}>
              最新
            </button>
            <button type="button" data-active={sort === 'hot'} onClick={() => setSort('hot')}>
              <Flame size={13} />
              最热
            </button>
          </div>

          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <div className="segmented" title="留言的展示方式">
              <button
                type="button"
                data-active={commentLayout === 'drawer'}
                onClick={() => setCommentLayout('drawer')}
              >
                侧栏并列
              </button>
              <button
                type="button"
                data-active={commentLayout === 'inline'}
                onClick={() => setCommentLayout('inline')}
              >
                就地展开
              </button>
            </div>
            {(keyword || tag) && (
              <button type="button" className="btn btn-sm" onClick={clearFilter}>
                清除筛选
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <PostSkeleton count={3} />
        ) : posts.length === 0 ? (
          <Empty
            icon={keyword ? <Search size={26} /> : <Sparkles size={26} />}
            title={keyword ? '没有找到相关的心事' : '广场上还没有心事'}
            desc={keyword ? '换个词试试，或者把你想说的写下来' : '成为第一个留下心事的人'}
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
                onRemove={(id) => {
                  setPosts((prev) => prev.filter((p) => p.id !== id));
                  setTotal((prev) => Math.max(0, prev - 1));
                }}
                onToggleComments={handleToggleComments}
              />
            ))}

            {posts.length < total && (
              <button
                type="button"
                className="btn btn-lg load-more"
                onClick={() => load(page + 1, true)}
                disabled={loadingMore}
              >
                {loadingMore ? '加载中…' : `加载更多（还有 ${total - posts.length} 条）`}
              </button>
            )}
          </div>
        )}
      </div>

      <aside className="home-side">
        <section className="card card-pad">
          <div className="section-title">
            <Hash size={14} />
            常用标签
          </div>
          <div className="tag-cloud">
            {TAGS.map((item) => (
              <Link
                key={item}
                className="tag tag-clickable"
                data-active={tag === item}
                to={`/?tag=${encodeURIComponent(item)}`}
              >
                {item}
              </Link>
            ))}
          </div>
        </section>

        {/* 常用标签在上、热度榜在下，整列与发布框同一行起头 */}
        <section className="card">
          <div className="card-head">
            <div className="card-title">
              <Flame size={15} />
              热度榜
              <span className="card-sub">近 7 天</span>
            </div>
            <Link className="btn btn-sm btn-ghost" to="/ranking">
              完整榜单
            </Link>
          </div>
          <div className="card-pad" style={{ paddingTop: 'var(--sp-3)' }}>
            <RankingList range="week" limit={5} compact />
          </div>
        </section>

        {user && (
          <section className="card card-pad side-tip">
            <div className="section-title" style={{ marginBottom: 6 }}>
              当前身份
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              你在站内的名字是「{user.anonName}」，配色由系统分配且不会改变。所有心事、留言与弹幕都以它出现。
            </p>
            <Link className="btn btn-sm" to="/mine">
              查看我的心事
            </Link>
          </section>
        )}
      </aside>
    </div>
  );
}