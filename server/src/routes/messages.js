import express from 'express';
import { db, nowIso } from '../db.js';
import { requireSpeaking } from '../lib/auth.js';
import { autoReview, logAudit, notify } from '../lib/moderation.js';
import { MESSAGE_SELECT, serializeMessage } from '../lib/lifecycle.js';

export const messagesRouter = express.Router({ mergeParams: true });
export const messageActionsRouter = express.Router();

function loadPost(postId) {
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
}

function viewerCanRead(post, viewer) {
  if (!viewer) return false;
  if (viewer.id === post.author_id) return true;
  if (viewer.role === 'admin' || viewer.role === 'reviewer') return true;
  if (post.deleted_at) return false;
  return post.review_status === 'published' && post.lifecycle === 'live' && post.visibility === 'public';
}

messagesRouter.get('/', (req, res) => {
  const post = loadPost(Number(req.params.postId));
  if (!post) return res.status(404).json({ error: '内容不存在' });
  if (!viewerCanRead(post, req.user)) return res.status(403).json({ error: '该内容暂不可见' });

  const showAll = !!req.user && (req.user.id === post.author_id || req.user.role !== 'user');
  const where = showAll ? '' : "AND m.review_status = 'published'";
  const rows = db
    .prepare(`${MESSAGE_SELECT} WHERE m.post_id = ? ${where} ORDER BY m.created_at ASC`)
    .all(post.id);

  res.json({
    messages: rows.map((row) => serializeMessage(row, req.user, post.author_id)),
  });
});

messagesRouter.post('/', requireSpeaking, (req, res) => {
  const post = loadPost(Number(req.params.postId));
  if (!post) return res.status(404).json({ error: '内容不存在' });
  if (!viewerCanRead(post, req.user)) return res.status(403).json({ error: '该内容暂不可见' });

  const content = String((req.body || {}).content || '').trim();
  if (!content) return res.status(400).json({ error: '留言不能为空' });
  if (content.length > 500) return res.status(400).json({ error: '留言不能超过 500 字' });

  const parentId = req.body.parentId ? Number(req.body.parentId) : null;
  if (parentId) {
    const parent = db
      .prepare('SELECT id, parent_id FROM messages WHERE id = ? AND post_id = ?')
      .get(parentId, post.id);
    if (!parent) return res.status(400).json({ error: '被回复的留言不存在' });
    if (parent.parent_id) return res.status(400).json({ error: '回复仅支持两级' });
  }

  const review = autoReview({
    kind: 'message',
    content,
    userId: req.user.id,
    user: req.user,
  });

  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO messages
        (post_id, author_id, parent_id, content, review_status, review_mode, auto_flags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      post.id,
      req.user.id,
      parentId,
      content,
      review.status,
      review.mode,
      JSON.stringify(review.flags),
      ts
    );

  if (review.status === 'published') {
    db.prepare('UPDATE posts SET message_count = message_count + 1 WHERE id = ?').run(post.id);
    const target = parentId
      ? db.prepare('SELECT author_id FROM messages WHERE id = ?').get(parentId)
      : { author_id: post.author_id };
    if (target && target.author_id !== req.user.id) {
      notify(target.author_id, 'reply', '你的心事有了新回应', content.slice(0, 40));
    }
  } else if (review.status === 'rejected') {
    notify(req.user.id, 'review', '留言未通过自动审核', review.flags.join('；'));
  }

  const row = db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(info.lastInsertRowid);
  logAudit({
    actor: req.user,
    action: 'message.create',
    targetType: 'message',
    targetId: row.id,
    detail: { postId: post.id, review: review.status, parentId },
  });

  res.json({ message: serializeMessage(row, req.user, post.author_id), review });
});

messageActionsRouter.post('/:id/like', requireSpeaking, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '留言不存在' });

  const existing = db
    .prepare('SELECT id FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?')
    .get(req.user.id, 'message', id);

  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
    db.prepare('UPDATE messages SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(id);
  } else {
    db.prepare(
      'INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, 'message', id, nowIso());
    db.prepare('UPDATE messages SET like_count = like_count + 1 WHERE id = ?').run(id);
  }

  const updated = db.prepare('SELECT like_count FROM messages WHERE id = ?').get(id);
  res.json({ liked: !existing, likeCount: updated.like_count });
});

messageActionsRouter.post('/:id/report', requireSpeaking, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, author_id FROM messages WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '留言不存在' });
  /* 与心事一致：不能举报自己的内容 */
  if (row.author_id === req.user.id) {
    return res.status(400).json({ error: '不能举报自己的留言', code: 'self' });
  }
  const reason = String((req.body || {}).reason || '其他').slice(0, 32);
  const detail = String((req.body || {}).detail || '').slice(0, 200);
  db.prepare(
    'INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, 'message', id, reason, detail, 'open', nowIso());
  res.json({ ok: true });
});