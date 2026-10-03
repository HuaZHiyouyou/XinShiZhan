import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { api } from '@/api/client';
import type { Post } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { CommentList } from '@/components/post/CommentList';
import { useUi } from '@/store/ui';

export function CommentDrawer() {
  const target = useUi((s) => s.commentTarget);
  const close = useUi((s) => s.closeComments);
  const [post, setPost] = useState<Post | null>(null);

  useEffect(() => {
    document.documentElement.dataset.commentsOpen = target ? 'true' : 'false';
    return () => {
      document.documentElement.dataset.commentsOpen = 'false';
    };
  }, [target]);

  useEffect(() => {
    if (!target) {
      setPost(null);
      return undefined;
    }
    let alive = true;
    api.posts
      .get(target)
      .then(({ post: data }) => {
        if (alive) setPost(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [target]);

  return (
    <AnimatePresence>
      {target && (
        <motion.aside
          className="comment-drawer"
          initial={{ x: 420, opacity: 0.4 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 420, opacity: 0.4 }}
          transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className="card-head">
            <div style={{ minWidth: 0 }}>
              <div className="card-title">留言</div>
              <div className="card-sub">原文在左侧，留言从右侧滑出覆盖在上层</div>
            </div>
            <button type="button" className="btn-icon" onClick={close} aria-label="收起留言">
              <X size={16} />
            </button>
          </div>

          {/* 原文放进滚动容器：往下翻留言时它会跟着滚走，不再整块钉在顶部 */}
          <div className="drawer-body">
            {post && (
              <div className="drawer-quote">
                <Avatar
                  name={post.author.anonName}
                  color={post.author.anonColor}
                  src={post.author.avatarUrl}
                  size="sm"
                />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="drawer-quote-name">{post.author.anonName}</div>
                  <p className="drawer-quote-text">{post.content}</p>
                </div>
              </div>
            )}

            <CommentList postId={target} dense />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}