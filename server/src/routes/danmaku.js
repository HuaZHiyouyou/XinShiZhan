import express from 'express';
import { db, nowIso } from '../db.js';
import { requireSpeaking } from '../lib/auth.js';
import { autoReview, logAudit } from '../lib/moderation.js';
import { DANMAKU_SELECT, serializeDanmaku } from '../lib/lifecycle.js';
import { DANMAKU_COLORS, EFFECTS } from '../lib/anon.js';

export const danmakuRouter = express.Router();

danmakuRouter.get('/', (req, res) => {
  const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 80));
  const after = req.query.after ? Number(req.query.after) : null;

  const rows = after
    ? db
        .prepare(
          `${DANMAKU_SELECT} WHERE d.review_status = 'published' AND d.id > ?
           ORDER BY d.id ASC LIMIT ?`
        )
        .all(after, limit)
    : db
        .prepare(
          `${DANMAKU_SELECT} WHERE d.review_status = 'published'
           ORDER BY d.id DESC LIMIT ?`
        )
        .all(limit)
        .reverse();

  res.json({ danmaku: rows.map(serializeDanmaku) });
});

danmakuRouter.post('/', requireSpeaking, (req, res) => {
  const body = req.body || {};
  const content = String(body.content || '').trim();
  if (!content) return res.status(400).json({ error: '弹幕内容不能为空' });
  if (content.length > 60) return res.status(400).json({ error: '弹幕不能超过 60 字' });

  const color = Object.keys(DANMAKU_COLORS).includes(body.color) ? body.color : 'azure';
  const effect = EFFECTS.includes(body.effect) ? body.effect : 'glow';
  const mode = body.mode === 'bubble' ? 'bubble' : 'scroll';
  const postId = body.postId ? Number(body.postId) : null;

  const review = autoReview({
    kind: 'danmaku',
    content,
    userId: req.user.id,
    user: req.user,
  });

  const info = db
    .prepare(
      `INSERT INTO danmaku
        (user_id, post_id, content, color, effect, mode, review_status, review_mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      postId,
      content,
      color,
      effect,
      mode,
      review.status,
      review.mode,
      nowIso()
    );

  if (review.status === 'published' && postId) {
    db.prepare('UPDATE posts SET danmaku_count = danmaku_count + 1 WHERE id = ?').run(postId);
  }

  const row = db.prepare(`${DANMAKU_SELECT} WHERE d.id = ?`).get(info.lastInsertRowid);
  logAudit({
    actor: req.user,
    action: 'danmaku.create',
    targetType: 'danmaku',
    targetId: row.id,
    detail: { review: review.status },
  });

  res.json({ danmaku: serializeDanmaku(row), review });
});

danmakuRouter.get('/palette', (_req, res) => {
  res.json({ colors: DANMAKU_COLORS, effects: EFFECTS });
});