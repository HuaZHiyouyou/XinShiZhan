import { db, nowIso } from '../db.js';
import { hotScore } from './moderation.js';

/** lifecycle: draft（未上线）| scheduled（定时待发）| live（已上线）| expired（已过期） */

export const POST_SELECT = `
  SELECT p.*, u.anon_name AS anon_name, u.anon_color AS anon_color, u.avatar_url AS author_avatar,
    u.role AS author_role
  FROM posts p JOIN users u ON u.id = p.author_id`;

export const MESSAGE_SELECT = `
  SELECT m.*, u.anon_name AS anon_name, u.anon_color AS anon_color, u.avatar_url AS author_avatar,
    u.role AS author_role
  FROM messages m JOIN users u ON u.id = m.author_id`;

export const DANMAKU_SELECT = `
  SELECT d.*, u.anon_name AS anon_name, u.anon_color AS anon_color, u.avatar_url AS author_avatar
  FROM danmaku d JOIN users u ON u.id = d.user_id`;

export function computeLifecycle({ reviewStatus, publishAt, expiresAt }) {
  if (reviewStatus !== 'published') return 'draft';
  const now = Date.now();
  if (publishAt && new Date(publishAt).getTime() > now) return 'scheduled';
  if (expiresAt && new Date(expiresAt).getTime() <= now) return 'expired';
  return 'live';
}

/** 定时发布 / 限时下架的推进，由 tick 调用；读取接口另做兜底过滤 */
export function advanceTimeline() {
  const now = nowIso();
  const promoted = db
    .prepare(
      `UPDATE posts SET lifecycle = 'live', updated_at = ?
       WHERE lifecycle = 'scheduled' AND review_status = 'published'
         AND (publish_at IS NULL OR publish_at <= ?)`
    )
    .run(now, now);
  const expired = db
    .prepare(
      `UPDATE posts SET lifecycle = 'expired', updated_at = ?
       WHERE lifecycle = 'live' AND expires_at IS NOT NULL AND expires_at <= ?`
    )
    .run(now, now);
  return { promoted: promoted.changes, expired: expired.changes };
}

export function publicPostWhere(alias = 'p') {
  return `${alias}.review_status = 'published'
    AND ${alias}.lifecycle = 'live'
    AND ${alias}.visibility = 'public'
    AND ${alias}.deleted_at IS NULL
    AND (${alias}.expires_at IS NULL OR julianday(${alias}.expires_at) > julianday('now'))`;
}

export function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializePost(row, viewer) {
  if (!row) return null;
  const isAuthor = !!viewer && viewer.id === row.author_id;
  const isStaff = !!viewer && (viewer.role === 'admin' || viewer.role === 'reviewer');
  const liked = viewer
    ? !!db
        .prepare('SELECT 1 FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?')
        .get(viewer.id, 'post', row.id)
    : false;
  return {
    id: row.id,
    content: row.content,
    mood: row.mood,
    tags: parseJsonArray(row.tags),
    images: parseJsonArray(row.images),
    visibility: row.visibility,
    reviewStatus: row.review_status,
    reviewMode: row.review_mode,
    rejectReason: row.reject_reason,
    autoFlags: parseJsonArray(row.auto_flags),
    lifecycle: row.lifecycle,
    publishAt: row.publish_at,
    expiresAt: row.expires_at,
    pinned: !!row.pinned,
    likeCount: row.like_count,
    viewCount: row.view_count,
    messageCount: row.message_count,
    danmakuCount: row.danmaku_count,
    hotScore: Number(hotScore(row).toFixed(4)),
    deletedAt: row.deleted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    author: {
      id: row.author_id,
      anonName: row.anon_name,
      anonColor: row.anon_color,
      avatarUrl: row.author_avatar || '',
      role: row.author_role || 'user',
    },
    isAuthor,
    canView: isAuthor || isStaff,
    liked,
  };
}

export function serializeMessage(row, viewer, postAuthorId) {
  const isAuthorOfPost = row.author_id === postAuthorId;
  const liked = viewer
    ? !!db
        .prepare('SELECT 1 FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?')
        .get(viewer.id, 'message', row.id)
    : false;
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id,
    content: row.content,
    reviewStatus: row.review_status,
    rejectReason: row.reject_reason,
    likeCount: row.like_count,
    createdAt: row.created_at,
    liked,
    isPostAuthor: isAuthorOfPost,
    isStaff: row.author_role === 'admin' || row.author_role === 'reviewer',
    author: {
      id: row.author_id,
      anonName: row.anon_name,
      anonColor: row.anon_color,
      avatarUrl: row.author_avatar || '',
    },
  };
}

export function serializeDanmaku(row) {
  return {
    id: row.id,
    content: row.content,
    color: row.color,
    effect: row.effect,
    mode: row.mode,
    postId: row.post_id,
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    author: {
      id: row.user_id,
      anonName: row.anon_name,
      anonColor: row.anon_color,
      avatarUrl: row.author_avatar || '',
    },
  };
}