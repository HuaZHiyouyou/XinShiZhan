import express from 'express';
import { db, nowIso } from '../db.js';
import { requireAuth, requireStaff } from '../lib/auth.js';
import { audioUpload } from '../lib/upload.js';
import { logAudit } from '../lib/moderation.js';

export const musicRouter = express.Router();

function serializeTrack(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    cover: row.cover,
    url: row.url,
    duration: row.duration,
    source: row.source,
    sortOrder: row.sort_order,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    uploadedBy: row.uploaded_by,
  };
}

musicRouter.get('/', (req, res) => {
  const includeDisabled = req.query.all === '1' && req.user && req.user.role === 'admin';
  const rows = db
    .prepare(
      `SELECT * FROM music_tracks ${includeDisabled ? '' : 'WHERE enabled = 1'}
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.json({ tracks: rows.map(serializeTrack) });
});

musicRouter.post('/', requireAuth, audioUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有收到音频文件' });
  const body = req.body || {};
  const title = String(body.title || '').trim() || req.file.originalname.replace(/\.[^.]+$/, '');
  const artist = String(body.artist || '').trim() || '匿名投稿';
  const duration = Number(body.duration) || 0;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM music_tracks').get().m;

  const info = db
    .prepare(
      `INSERT INTO music_tracks (title, artist, album, cover, url, duration, source, uploaded_by, sort_order, enabled, created_at)
       VALUES (?, ?, '', '', ?, ?, 'user', ?, ?, 1, ?)`
    )
    .run(title.slice(0, 60), artist.slice(0, 40), `/uploads/audio/${req.file.filename}`, duration, req.user.id, maxOrder + 1, nowIso());

  logAudit({
    actor: req.user,
    action: 'music.upload',
    targetType: 'music_track',
    targetId: Number(info.lastInsertRowid),
    detail: { title },
  });

  const row = db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(info.lastInsertRowid);
  res.json({ track: serializeTrack(row) });
});

musicRouter.patch('/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '曲目不存在' });
  const body = req.body || {};

  db.prepare(
    `UPDATE music_tracks SET title = ?, artist = ?, sort_order = ?, enabled = ? WHERE id = ?`
  ).run(
    body.title !== undefined ? String(body.title).slice(0, 60) : row.title,
    body.artist !== undefined ? String(body.artist).slice(0, 40) : row.artist,
    body.sortOrder !== undefined ? Number(body.sortOrder) : row.sort_order,
    body.enabled !== undefined ? (body.enabled ? 1 : 0) : row.enabled,
    id
  );

  logAudit({
    actor: req.user,
    action: 'music.update',
    targetType: 'music_track',
    targetId: id,
    detail: body,
  });

  res.json({ track: serializeTrack(db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(id)) });
});

musicRouter.delete('/:id', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '曲目不存在' });
  if (row.source === 'builtin') return res.status(400).json({ error: '内置曲目不可删除，只能停用' });
  db.prepare('DELETE FROM music_tracks WHERE id = ?').run(id);
  logAudit({ actor: req.user, action: 'music.delete', targetType: 'music_track', targetId: id, detail: {} });
  res.json({ ok: true });
});