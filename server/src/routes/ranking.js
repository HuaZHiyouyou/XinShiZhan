import express from 'express';
import { db } from '../db.js';
import { hotScore } from '../lib/moderation.js';
import { POST_SELECT, publicPostWhere, serializePost } from '../lib/lifecycle.js';

export const rankingRouter = express.Router();

const RANGE_MS = {
  day: 24 * 3600 * 1000,
  week: 7 * 24 * 3600 * 1000,
  month: 30 * 24 * 3600 * 1000,
  all: Number.POSITIVE_INFINITY,
};

function withAuthor(post, viewer) {
  const serialized = serializePost(post, viewer);
  return {
    id: serialized.id,
    content: serialized.content,
    mood: serialized.mood,
    tags: serialized.tags,
    likeCount: serialized.likeCount,
    messageCount: serialized.messageCount,
    danmakuCount: serialized.danmakuCount,
    viewCount: serialized.viewCount,
    hotScore: serialized.hotScore,
    createdAt: serialized.createdAt,
    author: serialized.author,
    liked: serialized.liked,
  };
}

rankingRouter.get('/', (req, res) => {
  const range = String(req.query.range || 'week');
  const windowMs = RANGE_MS[range] ?? RANGE_MS.week;
  const limit = Math.min(50, Math.max(3, Number(req.query.limit) || 10));

  const params = [];
  let timeFilter = '';
  if (Number.isFinite(windowMs)) {
    timeFilter = 'AND julianday(p.created_at) > julianday(?)';
    params.push(new Date(Date.now() - windowMs).toISOString());
  }

  const rows = db
    .prepare(`${POST_SELECT} WHERE ${publicPostWhere('p')} ${timeFilter}`)
    .all(...params);

  const scored = rows
    .map((row) => ({ row, score: hotScore(row) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  res.json({
    range,
    items: scored.map((item, index) => ({ rank: index + 1, ...withAuthor(item.row, req.user) })),
  });
});

/** 站点概览：供首页与看板复用 */
rankingRouter.get('/overview', (req, res) => {
  const postCount = db
    .prepare(`SELECT COUNT(*) AS c FROM posts p WHERE ${publicPostWhere('p')}`)
    .get().c;
  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").get().c;
  const danmakuCount = db
    .prepare("SELECT COUNT(*) AS c FROM danmaku WHERE review_status = 'published'")
    .get().c;
  const pending = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM posts WHERE review_status = 'manual_review')
        + (SELECT COUNT(*) FROM messages WHERE review_status = 'manual_review')
        + (SELECT COUNT(*) FROM danmaku WHERE review_status = 'manual_review') AS c`
    )
    .get().c;

  res.json({ postCount, userCount, danmakuCount, pending, viewer: req.user ? req.user.anonName : null });
});