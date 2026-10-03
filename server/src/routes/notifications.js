import express from 'express';
import { db, nowIso } from '../db.js';
import { requireAuth } from '../lib/auth.js';

export const notificationsRouter = express.Router();

notificationsRouter.get('/', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60')
    .all(req.user.id);

  /* 未读数跟列表一起回传：前端轮询一次就能同时刷新列表和红点，不用发两个请求 */
  const unread = db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0')
    .get(req.user.id).c;

  res.json({
    unread,
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      read: !!row.read,
      createdAt: row.created_at,
    })),
  });
});

/**
 * 取下一条「下次进站要弹」的信，取走即标记已弹。
 *
 * 为什么是取走即标记，而不是等客户端上报「已关闭」：
 * 用户可能直接关掉浏览器，那次弹窗就永远结算不了，下次进站又会弹一次 ——
 * 弹过一次就记一次，宁可少弹，不要反复打扰。
 */
notificationsRouter.post('/popup/next', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM notifications
        WHERE user_id = ? AND popup = 1 AND popup_seen_at IS NULL
        ORDER BY created_at ASC, id ASC LIMIT 5`
    )
    .all(req.user.id);

  if (rows.length) {
    const ts = nowIso();
    const mark = db.prepare('UPDATE notifications SET popup_seen_at = ? WHERE id = ?');
    rows.forEach((row) => mark.run(ts, row.id));
  }

  res.json({
    letters: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      read: !!row.read,
      popup: true,
      createdAt: row.created_at,
    })),
  });
});

notificationsRouter.post('/read', requireAuth, (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(Number) : null;
  if (ids && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`
    ).run(req.user.id, ...ids);
  } else {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  }

  /* 返回剩余未读数，前端据此刻度红点，不必自己猜 */
  const unread = db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0')
    .get(req.user.id).c;

  res.json({ ok: true, unread });
});