import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownRight, Heart, MessageSquare, Send, X } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { PostMessage } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { Empty, SkeletonThread } from '@/components/common/Empty';
import { GuestNotice } from '@/components/common/GuestNotice';
import { ReportMenu } from '@/components/post/ReportMenu';
import { relativeTime } from '@/lib/format';
import { useInteractionGate } from '@/lib/useInteractionGate';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';

interface Props {
  postId: number;
  onCountChange?: (delta: number) => void;
  dense?: boolean;
}

/** 留言的自动同步间隔：别人刚回你一句，不用手动刷新就能看到 */
const SYNC_MS = 15_000;

/**
 * 列表有没有真的变过。
 * 轮询每次都拿到新数组，直接 setState 会让整棵树无意义地重渲染、
 * 也会打断正在输入的人，所以先比一遍再决定要不要更新。
 */
function sameList(a: PostMessage[], b: PostMessage[]) {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const next = b[index];
    return item.id === next.id && item.likeCount === next.likeCount && item.reviewStatus === next.reviewStatus;
  });
}

function MessageRow({
  message,
  replyTo,
  onReply,
  onLike,
  dense,
}: {
  message: PostMessage;
  replyTo: PostMessage | null;
  onReply: (message: PostMessage | null) => void;
  onLike: (message: PostMessage) => void;
  dense: boolean;
}) {
  /* 共鸣与回复都要过互动闸门：未登录去登录，访客引导注册 */
  const { allow } = useInteractionGate();
  const pending = message.reviewStatus !== 'published';

  return (
    <article className={`msg-row ${dense ? 'msg-row-dense' : ''}`} data-pending={pending}>
      <Avatar
        name={message.author.anonName}
        color={message.author.anonColor}
        src={message.author.avatarUrl}
        size={dense ? 'sm' : 'md'}
      />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="msg-head">
          <span className="msg-name">{message.author.anonName}</span>
          {message.isPostAuthor && <span className="tag badge-author">楼主</span>}
          {message.isStaff && <span className="tag badge-staff">值班</span>}
          {pending && <span className="tag tag-warning">待复核</span>}
          <span className="faint msg-time">{relativeTime(message.createdAt)}</span>
        </div>

        <p className="msg-body">{message.content}</p>

        <div className="msg-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            data-active={message.liked}
            onClick={() => allow() && onLike(message)}
          >
            <Heart size={13} fill={message.liked ? 'currentColor' : 'none'} />
            {message.likeCount > 0 ? message.likeCount : '共鸣'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => allow() && onReply(replyTo?.id === message.id ? null : message)}
          >
            <CornerDownRight size={13} />
            {replyTo?.id === message.id ? '取消回复' : '回复'}
          </button>
          <ReportMenu targetType="message" targetId={message.id} compact />
        </div>
      </div>
    </article>
  );
}

export function CommentList({ postId, onCountChange, dense = false }: Props) {
  const user = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const { allow, isGuest } = useInteractionGate();

  const [messages, setMessages] = useState<PostMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<PostMessage | null>(null);
  const [sending, setSending] = useState(false);

  /* 轮询时要和「上一次的列表」比较，用 ref 拿最新值，避免把副作用写进 setState */
  const messagesRef = useRef<PostMessage[]>([]);

  const apply = useCallback(
    (list: PostMessage[]) => {
      const prev = messagesRef.current;
      if (sameList(prev, list)) return;
      const delta =
        list.filter((m) => m.reviewStatus === 'published').length -
        prev.filter((m) => m.reviewStatus === 'published').length;
      messagesRef.current = list;
      setMessages(list);
      /* 别人新增或删掉留言时，把原文上的计数一并校准 */
      if (delta !== 0) onCountChange?.(delta);
    },
    [onCountChange]
  );

  const load = useCallback(async () => {
    try {
      const { messages: list } = await api.messages.list(postId);
      messagesRef.current = list;
      setMessages(list);
    } catch (error) {
      if (error instanceof ApiError && error.status !== 403) {
        notify(error.message, 'danger');
      }
      messagesRef.current = [];
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [postId, notify]);

  /** 静默同步：失败不打扰用户，下一次轮询会补上 */
  const sync = useCallback(async () => {
    try {
      const { messages: list } = await api.messages.list(postId);
      apply(list);
    } catch {
      /* 静默 */
    }
  }, [postId, apply]);

  useEffect(() => {
    setLoading(true);
    setReplyTo(null);
    messagesRef.current = [];
    load();
  }, [load]);

  /* 本地点赞、发新留言之后 ref 也要跟上，否则下一轮同步会拿旧值做比较 */
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* 动态加载：页面可见时定时同步，切回前台立刻补一次 */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void sync();
    }, SYNC_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sync]);

  const tree = useMemo(() => {
    const tops = messages.filter((m) => !m.parentId);
    const replies = new Map<number, PostMessage[]>();
    messages
      .filter((m) => m.parentId)
      .forEach((m) => {
        const key = m.parentId as number;
        replies.set(key, [...(replies.get(key) || []), m]);
      });
    return { tops, replies };
  }, [messages]);

  const like = async (message: PostMessage) => {
    try {
      const { liked, likeCount } = await api.messages.like(message.id);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, liked, likeCount } : m)));
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    if (!allow()) return;
    setSending(true);
    try {
      const { message, review } = await api.messages.create(postId, content, replyTo?.id ?? null);
      setMessages((prev) => [...prev, message]);
      setDraft('');
      setReplyTo(null);
      if (review.status === 'published') {
        onCountChange?.(1);
        notify('留言已送达', 'success');
      } else if (review.status === 'manual_review') notify('留言已提交人工复核，通过后会显示', 'warning');
      else notify(review.flags[0] || '留言未通过自动审核', 'danger');
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '留言失败', 'danger');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="comment-panel">
      <form className="comment-composer" onSubmit={submit}>
        {/* 回复条滑出而不是突然出现，视线不会被顶得跳一下 */}
        <div className="collapse" data-open={Boolean(replyTo)}>
          <div>
            {replyTo && (
              <div className="reply-chip">
                <CornerDownRight size={13} />
                <span className="grow">正在回复 {replyTo.author.anonName}</span>
                <button
                  type="button"
                  className="btn-icon btn-sm"
                  onClick={() => setReplyTo(null)}
                  aria-label="取消回复"
                >
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
        </div>
        {isGuest ? (
          <GuestNotice
            title="访客不能留言"
            desc="访客账号只能阅读别人的心事与留言。注册后就能写下你的回应，对方会收到站内信。"
          />
        ) : (
          <>
            <textarea
              className="textarea comment-input"
              value={draft}
              maxLength={500}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={user ? '写一句回应，对方会收到站内信' : '登录后可以留言'}
              rows={3}
            />
            <div className="row-between">
              <span className="hint">{draft.length}/500</span>
              <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !draft.trim()}>
                <Send size={13} />
                {sending ? '发送中…' : '送出'}
              </button>
            </div>
          </>
        )}
      </form>

      <div className="comment-list">
        {loading && <SkeletonThread rows={3} />}
        {!loading && tree.tops.length === 0 && <Empty title="还没有人回应" desc="你可以成为第一个留下痕迹的人" />}
        {tree.tops.map((top) => {
          const replies = tree.replies.get(top.id) || [];
          return (
            <div key={top.id} className="msg-thread">
              <MessageRow message={top} replyTo={replyTo} onReply={setReplyTo} onLike={like} dense={dense} />
              {replies.length > 0 && (
                <div className="msg-replies">
                  {replies.map((reply) => (
                    <MessageRow
                      key={reply.id}
                      message={reply}
                      replyTo={replyTo}
                      onReply={setReplyTo}
                      onLike={like}
                      dense
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!loading && messages.length > 0 && (
        <div className="comment-foot">
          <MessageSquare size={13} />
          共 {messages.length} 条留言
          <span className="faint">· 有新回应会自动出现</span>
        </div>
      )}
    </div>
  );
}