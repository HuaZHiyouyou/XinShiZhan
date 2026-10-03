import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Flame, Heart, MessageSquare, MoreHorizontal, Radio, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { Post } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { ImageGrid } from '@/components/post/ImageGrid';
import { ReportMenu } from '@/components/post/ReportMenu';
import { CommentList } from '@/components/post/CommentList';
import { useInteractionGate } from '@/lib/useInteractionGate';
import { LIFECYCLE_LABELS, REVIEW_STATUS_LABELS, moodMeta } from '@/lib/constants';
import { formatCount, relativeTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';

interface Props {
  post: Post;
  onUpdate: (post: Post) => void;
  onRemove: (id: number) => void;
  onToggleComments: (post: Post) => void;
  commentsOpen?: boolean;
  renderComments?: boolean;
  /** 由列表传入的入场延迟序号（配合 .stagger 逐条浮入） */
  style?: CSSProperties;
}

export function PostCard({
  post,
  onUpdate,
  onRemove,
  onToggleComments,
  commentsOpen = false,
  renderComments = false,
  style,
}: Props) {
  const user = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const askConfirm = useUi((s) => s.askConfirm);
  /* 未登录与访客都在这里被拦下，并引导到正确的入口 */
  const { allow } = useInteractionGate();

  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [liking, setLiking] = useState(false);

  const mood = moodMeta(post.mood);
  const isLong = post.content.length > 170;
  const showFull = expanded || !isLong;

  const like = async () => {
    if (!allow()) return;
    setLiking(true);
    try {
      const { liked, likeCount } = await api.posts.like(post.id);
      onUpdate({ ...post, liked, likeCount });
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    } finally {
      setLiking(false);
    }
  };

  const remove = () => {
    askConfirm({
      title: '删除这件心事',
      message: '删除后无法恢复，相关的留言与弹幕也会一并消失。',
      confirmText: '确认删除',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.posts.remove(post.id);
          onRemove(post.id);
          notify('已删除', 'success');
        } catch (error) {
          notify(error instanceof ApiError ? error.message : '删除失败', 'danger');
        }
      },
    });
  };

  const showStatus = post.isAuthor || (user && user.role !== 'user');

  return (
    <article className="card post-card" style={style}>
      <header className="post-head">
        <Avatar name={post.author.anonName} color={post.author.anonColor} src={post.author.avatarUrl} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="post-head-line">
            <span className="post-name">{post.author.anonName}</span>
            <span className="tag" style={{ color: `var(--${mood.token})` }}>
              {mood.label}
            </span>
            {post.pinned && <span className="tag tag-primary">置顶</span>}
          </div>
          <div className="post-meta">
            <span>{relativeTime(post.createdAt)}</span>
            {showStatus && (
              <>
                <span className="meta-dot" />
                <span>{LIFECYCLE_LABELS[post.lifecycle]}</span>
                {post.reviewStatus !== 'published' && (
                  <>
                    <span className="meta-dot" />
                    <span style={{ color: 'var(--warning)' }}>{REVIEW_STATUS_LABELS[post.reviewStatus]}</span>
                  </>
                )}
                {post.visibility === 'private' && (
                  <>
                    <span className="meta-dot" />
                    <span>仅自己可见</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="row" style={{ gap: 2 }}>
          {post.isAuthor ? (
            <div className="dropdown-wrap">
              <button
                type="button"
                className="btn-icon"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="内容管理"
              >
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <div className="dropdown dropdown-menu-right" onMouseLeave={() => setMenuOpen(false)}>
                  <div className="dropdown-body">
                    <Link className="menu-item" to={`/post/${post.id}`} onClick={() => setMenuOpen(false)}>
                      <Eye size={14} />
                      查看详情
                    </Link>
                    <button
                      type="button"
                      className="menu-item menu-item-danger"
                      onClick={() => {
                        setMenuOpen(false);
                        remove();
                      }}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <ReportMenu targetType="post" targetId={post.id} />
          )}
        </div>
      </header>

      {post.rejectReason && showStatus && (
        <div className="post-reject">未通过原因：{post.rejectReason}</div>
      )}

      <div className="post-body">
        <p className={`post-content ${showFull ? '' : 'clamp-4'}`}>{post.content}</p>
        {isLong && (
          <button type="button" className="link-btn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : '展开全文'}
          </button>
        )}
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
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-active={commentsOpen}
          onClick={() => onToggleComments(post)}
        >
          <MessageSquare size={14} />
          {formatCount(post.messageCount)}
        </button>
        <span className="btn btn-sm btn-ghost" style={{ cursor: 'default' }}>
          <Radio size={14} />
          {formatCount(post.danmakuCount)}
        </span>
        <span className="btn btn-sm btn-ghost" style={{ cursor: 'default' }}>
          <Eye size={14} />
          {formatCount(post.viewCount)}
        </span>
        <span className="grow" />
        <span className="hot-chip mono" title="热度分">
          <Flame size={12} />
          {post.hotScore.toFixed(2)}
        </span>
        <Link className="btn btn-sm btn-ghost" to={`/post/${post.id}`}>
          详情
        </Link>
      </footer>

      {/* 展开留言：用 0fr → 1fr 做高度过渡，不必先知道留言有多少条 */}
      <div className="collapse" data-open={renderComments}>
        <div>
          {renderComments && (
            <div className="post-inline-comments">
              <CommentList postId={post.id} dense />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}