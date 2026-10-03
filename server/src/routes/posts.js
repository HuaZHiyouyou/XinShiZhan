import express from 'express';
import { db, nowIso } from '../db.js';
import { requireAuth, requireSpeaking } from '../lib/auth.js';
import { autoReview, hotScore, logAudit, notify } from '../lib/moderation.js';
import {
  POST_SELECT,
  computeLifecycle,
  parseJsonArray,
  publicPostWhere,
  serializePost,
} from '../lib/lifecycle.js';

export const postsRouter = express.Router();

const MAX_IMAGES = 9;

function normalizeImages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v) => typeof v === 'string' && v.startsWith('/uploads/'))
    .slice(0, MAX_IMAGES);
}

function normalizeTags(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.trim().slice(0, 12))
    .slice(0, 4);
}

function normalizeTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function loadPost(id) {
  return db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(id);
}

postsRouter.get('/', (req, res) => {
  const scope = String(req.query.scope || 'public');
  const sort = String(req.query.sort || 'latest');
  const tag = req.query.tag ? String(req.query.tag) : null;
  const q = req.query.q ? String(req.query.q) : null;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  const page = Math.max(1, Number(req.query.page) || 1);

  const where = [];
  const params = [];

  if (scope === 'mine') {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    where.push('p.author_id = ?');
    params.push(req.user.id);
    where.push('p.deleted_at IS NULL');
    if (req.query.lifecycle) {
      where.push('p.lifecycle = ?');
      params.push(String(req.query.lifecycle));
    }
    if (req.query.reviewStatus) {
      where.push('p.review_status = ?');
      params.push(String(req.query.reviewStatus));
    }
  } else {
    where.push(publicPostWhere('p'));
  }

  if (tag) {
    where.push("p.tags LIKE ?");
    params.push(`%${tag}%`);
  }
  if (q) {
    where.push('p.content LIKE ?');
    params.push(`%${q}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  if (sort === 'hot') {
    const rows = db.prepare(`${POST_SELECT} ${whereSql}`).all(...params);
    const scored = rows
      .map((row) => ({ row, score: hotScore(row) }))
      .sort((a, b) => b.score - a.score);
    const start = (page - 1) * limit;
    const slice = scored.slice(start, start + limit).map((item) => item.row);
    return res.json({
      posts: slice.map((row) => serializePost(row, req.user)),
      total: scored.length,
      page,
      limit,
    });
  }

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM posts p ${whereSql}`)
    .get(...params).c;
  const rows = db
    .prepare(
      `${POST_SELECT} ${whereSql} ORDER BY p.pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, (page - 1) * limit);

  res.json({ posts: rows.map((row) => serializePost(row, req.user)), total, page, limit });
});

postsRouter.get('/:id', (req, res) => {
  const row = loadPost(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '内容不存在' });

  const isOwner = !!req.user && req.user.id === row.author_id;
  const isStaff = !!req.user && (req.user.role === 'admin' || req.user.role === 'reviewer');
  if (row.deleted_at && !isOwner && !isStaff) {
    return res.status(404).json({ error: '内容不存在' });
  }
  const isPublicLive =
    !row.deleted_at &&
    row.review_status === 'published' &&
    row.lifecycle === 'live' &&
    row.visibility === 'public';

  if (!isPublicLive && !isOwner && !isStaff) {
    return res.status(403).json({ error: '该内容暂不可见' });
  }

  if (!isOwner && !isStaff) {
    db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(row.id);
    row.view_count += 1;
  }

  res.json({ post: serializePost(row, req.user) });
});

postsRouter.post('/', requireSpeaking, (req, res) => {
  const body = req.body || {};
  const content = String(body.content || '').trim();
  if (content.length < 1) return res.status(400).json({ error: '内容不能为空' });
  if (content.length > 1000) return res.status(400).json({ error: '内容不能超过 1000 字' });

  const images = normalizeImages(body.images);
  const tags = normalizeTags(body.tags);
  const mood = String(body.mood || 'plain').slice(0, 16);
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  const publishAt = normalizeTime(body.publishAt);
  const expiresAt = normalizeTime(body.expiresAt);

  if (expiresAt && expiresAt <= new Date().toISOString()) {
    return res.status(400).json({ error: '限时发布的结束时间必须晚于当前时间' });
  }
  if (expiresAt && publishAt && expiresAt <= publishAt) {
    return res.status(400).json({ error: '结束时间必须晚于开始时间' });
  }

  const recentContents = db
    .prepare('SELECT content FROM posts WHERE author_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(req.user.id)
    .map((r) => r.content);

  const review = autoReview({
    kind: 'post',
    content,
    userId: req.user.id,
    user: req.user,
    hasImages: images.length > 0,
    recentContents,
  });

  const lifecycle = computeLifecycle({
    reviewStatus: review.status,
    publishAt,
    expiresAt,
  });
  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO posts
        (author_id, content, mood, tags, images, visibility, review_status, review_mode,
         auto_flags, lifecycle, publish_at, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      content,
      mood,
      JSON.stringify(tags),
      JSON.stringify(images),
      visibility,
      review.status,
      review.mode,
      JSON.stringify(review.flags),
      lifecycle,
      publishAt,
      expiresAt,
      ts,
      ts
    );

  const postId = Number(info.lastInsertRowid);
  logAudit({
    actor: req.user,
    action: 'post.create',
    targetType: 'post',
    targetId: postId,
    detail: { review: review.status, flags: review.flags, visibility, lifecycle },
  });

  if (review.status === 'rejected') {
    notify(
      req.user.id,
      'review',
      '内容未通过自动审核',
      `原因：${review.flags.join('；') || '命中规则'}`
    );
  } else if (review.status === 'manual_review') {
    notify(req.user.id, 'review', '内容已提交人工复核', '复核结果会通过站内信告知。');
  } else if (lifecycle === 'scheduled') {
    notify(req.user.id, 'publish', '已排入定时发布', `将在 ${publishAt} 自动上线。`);
  }

  res.json({
    post: serializePost(loadPost(postId), req.user),
    review: { status: review.status, flags: review.flags },
  });
});

postsRouter.patch('/:id', requireAuth, (req, res) => {
  const row = loadPost(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '内容不存在' });
  if (row.author_id !== req.user.id) return res.status(403).json({ error: '只能修改自己的内容' });
  if (row.deleted_at) return res.status(400).json({ error: '已下架的内容无法修改' });
  if (row.review_status === 'rejected') {
    return res.status(400).json({ error: '已被驳回的内容无法直接修改，请重新发布' });
  }

  const body = req.body || {};
  const content = body.content === undefined ? row.content : String(body.content).trim();
  if (content.length < 1 || content.length > 1000) {
    return res.status(400).json({ error: '内容长度需在 1-1000 字之间' });
  }
  const visibility = body.visibility === 'private' ? 'private' : body.visibility === 'public' ? 'public' : row.visibility;
  const publishAt = body.publishAt === undefined ? row.publish_at : normalizeTime(body.publishAt);
  const expiresAt = body.expiresAt === undefined ? row.expires_at : normalizeTime(body.expiresAt);

  const review = autoReview({
    kind: 'post',
    content,
    userId: req.user.id,
    user: req.user,
    hasImages: parseJsonArray(row.images).length > 0,
    recentContents: [],
  });

  const lifecycle = computeLifecycle({
    reviewStatus: review.status,
    publishAt,
    expiresAt,
  });

  db.prepare(
    `UPDATE posts SET content = ?, visibility = ?, publish_at = ?, expires_at = ?,
      review_status = ?, review_mode = ?, auto_flags = ?, lifecycle = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    content,
    visibility,
    publishAt,
    expiresAt,
    review.status,
    review.mode,
    JSON.stringify(review.flags),
    lifecycle,
    nowIso(),
    row.id
  );

  logAudit({
    actor: req.user,
    action: 'post.update',
    targetType: 'post',
    targetId: row.id,
    detail: { review: review.status },
  });

  res.json({ post: serializePost(loadPost(row.id), req.user), review });
});

postsRouter.delete('/:id', requireAuth, (req, res) => {
  const row = loadPost(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '内容不存在' });
  const isStaff = req.user.role === 'admin' || req.user.role === 'reviewer';
  if (row.author_id !== req.user.id && !isStaff) {
    return res.status(403).json({ error: '没有删除权限' });
  }
  if (row.deleted_at) return res.status(400).json({ error: '内容已在回收站中' });

  const ts = nowIso();
  db.prepare('UPDATE posts SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?').run(
    ts,
    req.user.id,
    ts,
    row.id
  );
  logAudit({
    actor: req.user,
    action: 'post.delete',
    targetType: 'post',
    targetId: row.id,
    detail: { byStaff: row.author_id !== req.user.id },
  });
  res.json({ ok: true });
});

postsRouter.post('/:id/like', requireSpeaking, (req, res) => {
  const postId = Number(req.params.id);
  const row = loadPost(postId);
  if (!row || row.deleted_at) return res.status(404).json({ error: '内容不存在' });

  const existing = db
    .prepare('SELECT id FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?')
    .get(req.user.id, 'post', postId);

  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
    db.prepare('UPDATE posts SET like_count = MAX(like_count - 1, 0) WHERE id = ?').run(postId);
  } else {
    db.prepare(
      'INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, 'post', postId, nowIso());
    db.prepare('UPDATE posts SET like_count = like_count + 1 WHERE id = ?').run(postId);
    if (row.author_id !== req.user.id) {
      notify(row.author_id, 'like', '有人对你的心事产生了共鸣', '');
    }
  }

  const updated = loadPost(postId);
  res.json({ liked: !existing, likeCount: updated.like_count });
});

postsRouter.post('/:id/report', requireSpeaking, (req, res) => {
  const postId = Number(req.params.id);
  const row = loadPost(postId);
  if (!row) return res.status(404).json({ error: '内容不存在' });
  /* 举报自己的内容是无效路径，而且会给「自己审自己」留口子，直接挡掉 */
  if (row.author_id === req.user.id) {
    return res.status(400).json({ error: '不能举报自己的内容', code: 'self' });
  }
  const reason = String((req.body || {}).reason || '其他').slice(0, 32);
  const detail = String((req.body || {}).detail || '').slice(0, 200);
  db.prepare(
    'INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, 'post', postId, reason, detail, 'open', nowIso());
  logAudit({
    actor: req.user,
    action: 'post.report',
    targetType: 'post',
    targetId: postId,
    detail: { reason },
  });
  res.json({ ok: true });
});