import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Eye, Flame, Heart, MessageSquare, Radio, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { Post } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { Empty, SkeletonArticle } from '@/components/common/Empty';
import { ImageGrid } from '@/components/post/ImageGrid';
import { CommentList } from '@/components/post/CommentList';
import { useInteractionGate } from '@/lib/useInteractionGate';
import { ReportMenu } from '@/components/post/ReportMenu';
import { LIFECYCLE_LABELS, REVIEW_STATUS_LABELS, moodMeta } from '@/lib/constants';
import { formatCount, formatDateTime, relativeTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';

export function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const askConfirm = useUi((s) => s.askConfirm);
  const { allow } = useInteractionGate();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liking, setLiking] = useState(false);

  useEffect(() => {
    const postId = Number(id);
    if (!Number.isFinite(postId)) {
      setError('内容编号不正确');
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api.posts
      .get(postId)
      .then(({ post: data }) => {
        if (alive) setPost(data);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : '内容加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const like = async () => {
    if (!post) return;
    if (!allow()) return;
    setLiking(true);
    try {
      const { liked, likeCount } = await api.posts.like(post.id);
      setPost({ ...post, liked, likeCount });
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '操作失败', 'danger');
    } finally {
      setLiking(false);
    }
  };

  const remove = () => {
    if (!post) return;
    askConfirm({
      title: '删除这件心事',
      message: '删除后无法恢复，相关的留言与弹幕也会一并消失。',
      confirmText: '确认删除',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.posts.remove(post.id);
          notify('已删除', 'success');
          navigate('/');
        } catch (err) {
          notify(err instanceof ApiError ? err.message : '删除失败', 'danger');
        }
      },
    });
  };

  if (loading) return <SkeletonArticle />;
  if (error || !post) {
    return (
      <Empty
        title={error || '内容不存在'}
        desc="它可能已经被删除，或设置了仅自己可见"
        action={
          <Link className="btn btn-sm" to="/" style={{ marginTop: 'var(--sp-2)' }}>
            回到广场
          </Link>
        }
      />
    );
  }

  const mood = moodMeta(post.mood);
  const showStatus = post.isAuthor || (user && user.role !== 'user');

  return (
    <div className="detail-layout">
      <div className="detail-main">
        <button type="button" className="btn btn-sm btn-ghost back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} />
          返回
        </button>

        <article className="card">
          <header className="post-head">
            <Avatar name={post.author.anonName} color={post.author.anonColor} src={post.author.avatarUrl} size="lg" />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="post-head-line">
                <span className="post-name">{post.author.anonName}</span>
                <span className="tag" style={{ color: `var(--${mood.token})` }}>
                  {mood.label}
                </span>
                {post.pinned && <span className="tag tag-primary">置顶</span>}
              </div>
              <div className="post-meta">
                <span>{formatDateTime(post.createdAt)}</span>
                <span className="meta-dot" />
                <span>{relativeTime(post.createdAt)}</span>
              </div>
            </div>
            {!post.isAuthor && <ReportMenu targetType="post" targetId={post.id} />}
          </header>

          <div className="post-body detail-body">
            <p className="post-content">{post.content}</p>
          </div>

          {post.images.length > 0 && (
            <div className="post-images">
              <ImageGrid images={post.images} alt={post.author.anonName} />
            </div>
          )}

          {post.tags.length > 0 && (
            <div className="post-tags">
              {post.tags.map((tag) => (
                <Link key={tag} className="tag tag-clickable" to={`/?tag=${encodeURIComponent(tag)}`}>
                  {tag}
                </Link>
              ))}
            </div>
          )}

          <footer className="post-foot">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-active={post.liked}
              onClick={like}
              disabled={liking}
            >
              <Heart size={14} fill={post.liked ? 'currentColor' : 'none'} />
              {formatCount(post.likeCount)}
            </button>
            <span className="btn btn-sm btn-ghost" style={{ cursor: 'default' }}>
              <MessageSquare size={14} />
              {formatCount(post.messageCount)}
            </span>
            <span className="btn btn-sm btn-ghost" style={{ cursor: 'default' }}>
              <Radio size={14} />
              {formatCount(post.danmakuCount)}
            </span>
            <span className="btn btn-sm btn-ghost" style={{ cursor: 'default' }}>
              <Eye size={14} />
              {formatCount(post.viewCount)}
            </span>
            <span className="grow" />
            <span className="hot-chip mono">
              <Flame size={12} />
              {post.hotScore.toFixed(2)}
            </span>
            {post.isAuthor && (
              <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
                <Trash2 size={13} />
                删除
              </button>
            )}
          </footer>
        </article>

        {showStatus && (
          <section className="card card-pad status-card">
            <div className="section-title" style={{ marginBottom: 'var(--sp-3)' }}>
              <Clock size={14} />
              发布状态
            </div>
            <dl className="status-grid">
              <div>
                <dt>审核状态</dt>
                <dd>{REVIEW_STATUS_LABELS[post.reviewStatus]}</dd>
              </div>
              <div>
                <dt>审核方式</dt>
                <dd>{post.reviewMode === 'auto' ? '自动审核' : '人工复核'}</dd>
              </div>
              <div>
                <dt>生命周期</dt>
                <dd>{LIFECYCLE_LABELS[post.lifecycle]}</dd>
              </div>
              <div>
                <dt>可见范围</dt>
                <dd>{post.visibility === 'private' ? '仅自己可见' : '公开'}</dd>
              </div>
              <div>
                <dt>定时上线</dt>
                <dd>{post.publishAt ? formatDateTime(post.publishAt) : '未设置'}</dd>
              </div>
              <div>
                <dt>限时下架</dt>
                <dd>{post.expiresAt ? formatDateTime(post.expiresAt) : '未设置'}</dd>
              </div>
            </dl>
            {post.autoFlags.length > 0 && (
              <div className="auto-flags">
                {post.autoFlags.map((flag) => (
                  <span key={flag} className="tag tag-warning">
                    {flag}
                  </span>
                ))}
              </div>
            )}
            {post.rejectReason && <div className="post-reject">未通过原因：{post.rejectReason}</div>}
          </section>
        )}
      </div>

      <aside className="detail-side">
        <section className="card">
          <div className="card-head">
            <div className="card-title">
              <MessageSquare size={15} />
              留言
              <span className="card-sub">与原文并列</span>
            </div>
          </div>
          <CommentList
            postId={post.id}
            onCountChange={(delta) =>
              setPost((prev) => (prev ? { ...prev, messageCount: prev.messageCount + delta } : prev))
            }
          />
        </section>
      </aside>
    </div>
  );
}