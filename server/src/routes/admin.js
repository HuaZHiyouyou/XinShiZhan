import express from 'express';
import { db, nowIso } from '../db.js';
import {
  requireStaff,
  requireAdmin,
  requireSuperAdmin,
  activeBan,
  hashPassword,
  SUPER_ROLE,
} from '../lib/auth.js';
import { logAudit, notify, getRules, saveRules } from '../lib/moderation.js';
import { ROLE_RANK, checkAuthority, labelOf, rankOf } from '../lib/permissions.js';
import { getSiteConfig, getVerification, saveSiteConfig } from '../lib/site.js';
import { decryptField, randomPassword } from '../lib/secrets.js';
import { computeLifecycle, parseJsonArray } from '../lib/lifecycle.js';
import { secureChannel, listActiveLocks, recentAuthEvents, releaseLock, clientIp } from '../lib/secure.js';
import { channelStats } from '../lib/secureChannel.js';
import { revokeUserSessions } from '../lib/auth.js';

export const adminRouter = express.Router();

/* 后台接口强制走加密通道：没有合法握手会话，连「需要登录」这句提示都拿不到明文 */
adminRouter.use(secureChannel({ required: true }));
adminRouter.use(requireStaff);

const TABLES = {
  post: { table: 'posts', authorCol: 'author_id' },
  message: { table: 'messages', authorCol: 'author_id' },
  danmaku: { table: 'danmaku', authorCol: 'user_id' },
};

function authorOf(row, idCol) {
  return {
    id: row[idCol],
    anonName: row.anon_name,
    anonColor: row.anon_color,
    avatarUrl: row.avatar_url || '',
    username: row.username,
    /* 内容归属人的角色：前端据此说明「为什么这条你不能处理」 */
    role: row.author_role || 'user',
  };
}

/**
 * 比我低一级的角色清单，用来在 SQL 里直接过滤掉越级的队列项。
 * 超管返回空数组 —— 空数组在调用处意味着「不加角色过滤」，
 * 也就是他能看到全部（包括自己的，那些会标成 self 走自我裁决）。
 */
function rolesBelow(actor) {
  if (rankOf(actor) === ROLE_RANK.superadmin) return [];
  const mine = rankOf(actor);
  return Object.keys(ROLE_RANK).filter((role) => ROLE_RANK[role] < mine);
}

/** 把目标用户查出来交给统一的越权判定 */
function findUser(id) {
  return db.prepare('SELECT id, username, anon_name, role, status FROM users WHERE id = ?').get(id);
}

/**
 * 处理类接口的统一入口。
 * 返回 null 表示通过；否则已经把响应写出去，调用方直接 return。
 */
function guard(res, actor, target, options) {
  const verdict = checkAuthority(actor, target, options);
  if (verdict.ok) return verdict;
  res.status(verdict.status).json({ error: verdict.error, code: verdict.code });
  return null;
}

function reviewItem(type, row) {
  if (type === 'post') {
    return {
      type,
      id: row.id,
      content: row.content,
      images: parseJsonArray(row.images),
      tags: parseJsonArray(row.tags),
      visibility: row.visibility,
      lifecycle: row.lifecycle,
      publishAt: row.publish_at,
      expiresAt: row.expires_at,
      autoFlags: parseJsonArray(row.auto_flags),
      createdAt: row.created_at,
      author: authorOf(row, 'author_id'),
    };
  }
  if (type === 'message') {
    return {
      type,
      id: row.id,
      content: row.content,
      postId: row.post_id,
      parentId: row.parent_id,
      autoFlags: parseJsonArray(row.auto_flags),
      createdAt: row.created_at,
      author: authorOf(row, 'author_id'),
    };
  }
  return {
    type,
    id: row.id,
    content: row.content,
    postId: row.post_id,
    autoFlags: [],
    createdAt: row.created_at,
    author: authorOf(row, 'user_id'),
  };
}

/*
 * 审批队列按角色分层过滤：
 * 审核员只看得到普通用户的内容，管理员多看一层审核员，超管看全部。
 * 处理不了的东西压根不该出现在你的队列里 —— 点一下弹一次错最消耗耐心。
 */
const QUEUE = {
  post: {
    table: 'posts',
    join: 'JOIN users u ON u.id = p.author_id',
    alias: 'p',
    owner: 'u',
  },
  message: {
    table: 'messages',
    join: 'JOIN users u ON u.id = m.author_id',
    alias: 'm',
    owner: 'u',
  },
  danmaku: {
    table: 'danmaku',
    join: 'JOIN users u ON u.id = d.user_id',
    alias: 'd',
    owner: 'u',
  },
};

function queueQuery(type, actor) {
  const meta = QUEUE[type];
  const { alias, owner } = meta;
  const columns = `${alias}.*, ${owner}.anon_name, ${owner}.anon_color, ${owner}.avatar_url,
    ${owner}.username, ${owner}.role AS author_role`;
  const roles = rolesBelow(actor);
  /* 超管没有层级限制，但自己的内容也要看得见（标成 self 走自我裁决） */
  const scope = roles.length ? ` AND ${owner}.role IN (${roles.map(() => '?').join(',')})` : '';
  return {
    columns,
    params: roles,
    where: `${alias}.review_status = ?${scope}`,
  };
}

adminRouter.get('/review', (req, res) => {
  const type = TABLES[req.query.type] ? String(req.query.type) : 'post';
  const status = String(req.query.status || 'manual_review');
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const page = Math.max(1, Number(req.query.page) || 1);

  const meta = QUEUE[type];
  const { columns, where, params } = queueQuery(type, req.user);
  const rows = db
    .prepare(
      `SELECT ${columns} FROM ${meta.table} ${meta.alias} ${meta.join}
       WHERE ${where} ORDER BY ${meta.alias}.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, status, limit, (page - 1) * limit);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM ${meta.table} ${meta.alias} ${meta.join} WHERE ${where}`
    )
    .get(...params, status).c;

  res.json({
    type,
    status,
    total,
    page,
    limit,
    items: rows.map((row) => {
      const item = reviewItem(type, row);
      return {
        ...item,
        /* self 为真时前端会要求先写理由，这是超管的自我裁决通道 */
        self: item.author.id === req.user.id,
        canReview: true,
      };
    }),
  });
});

function applyReview({ type, id, action, reason, actor, allowSelf = true }) {
  const meta = TABLES[type];
  const row = db.prepare(`SELECT * FROM ${meta.table} WHERE id = ?`).get(id);
  if (!row) return { ok: false, status: 404, error: '目标不存在' };

  /* 内容归谁、他是什么角色，决定了这次操作合不合规 */
  const ownerCol = type === 'danmaku' ? 'user_id' : 'author_id';
  const owner = findUser(row[ownerCol]);
  const verdict = checkAuthority(actor, owner, { allowSelf, subject: '内容' });
  if (!verdict.ok) return { ok: false, status: verdict.status, error: verdict.error, code: verdict.code };

  /*
   * 自我裁决：只有超管走得通（他上面没人，没有别人能替他判）。
   * 理由**选填** —— 填了会记进审计日志，不填也放行。
   * 批量里仍然不允许夹带自己的内容：一条理由套很多条说不清楚，
   * 而且批量驳回不带说明，用户那边收不到有意义的回执。
   */

  const ts = nowIso();
  if (action === 'approve') {
    if (type === 'post') {
      const lifecycle = computeLifecycle({
        reviewStatus: 'published',
        publishAt: row.publish_at,
        expiresAt: row.expires_at,
      });
      db.prepare(
        `UPDATE posts SET review_status = 'published', review_mode = 'manual', reject_reason = NULL,
          lifecycle = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`
      ).run(lifecycle, actor.id, ts, ts, id);
      notify(
        row.author_id,
        'review',
        '心事已通过审核',
        lifecycle === 'scheduled' ? '将按设定时间自动上线。' : '现在已经可以被看见了。'
      );
    } else if (type === 'message') {
      db.prepare(
        `UPDATE messages SET review_status = 'published', review_mode = 'manual', reject_reason = NULL,
          reviewed_by = ?, reviewed_at = ? WHERE id = ?`
      ).run(actor.id, ts, id);
      db.prepare('UPDATE posts SET message_count = message_count + 1 WHERE id = ?').run(row.post_id);
      notify(row.author_id, 'review', '留言已通过审核', '');
    } else {
      db.prepare(
        `UPDATE danmaku SET review_status = 'published', review_mode = 'manual', reject_reason = NULL WHERE id = ?`
      ).run(id);
      if (row.post_id) {
        db.prepare('UPDATE posts SET danmaku_count = danmaku_count + 1 WHERE id = ?').run(row.post_id);
      }
      notify(row.user_id, 'review', '弹幕已通过审核', '');
    }
  } else {
    const col = type === 'danmaku' ? 'user_id' : 'author_id';
    if (type === 'post') {
      db.prepare(
        `UPDATE posts SET review_status = 'rejected', review_mode = 'manual', reject_reason = ?,
          lifecycle = 'draft', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`
      ).run(reason || '不符合社区规范', actor.id, ts, ts, id);
    } else if (type === 'message') {
      db.prepare(
        `UPDATE messages SET review_status = 'rejected', review_mode = 'manual', reject_reason = ?,
          reviewed_by = ?, reviewed_at = ? WHERE id = ?`
      ).run(reason || '不符合社区规范', actor.id, ts, id);
    } else {
      db.prepare(
        `UPDATE danmaku SET review_status = 'rejected', review_mode = 'manual', reject_reason = ? WHERE id = ?`
      ).run(reason || '不符合社区规范', id);
    }
    db.prepare(`UPDATE users SET violation_count = violation_count + 1 WHERE id = ?`).run(row[col]);
    notify(row[col], 'review', '内容未通过审核', `原因：${reason || '不符合社区规范'}`);
  }

  logAudit({
    actor,
    action: `review.${action}`,
    targetType: type,
    targetId: id,
    detail: { reason: reason || null },
  });
  return { ok: true };
}

adminRouter.post('/review/:type/:id', (req, res) => {
  const { type, id } = req.params;
  if (!TABLES[type]) return res.status(400).json({ error: '未知内容类型' });
  const action = req.body.action === 'reject' ? 'reject' : 'approve';
  const result = applyReview({
    type,
    id: Number(id),
    action,
    reason: String(req.body.reason || '').slice(0, 120),
    actor: req.user,
  });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error, code: result.code });
  res.json({ ok: true });
});

adminRouter.post('/review/batch', (req, res) => {
  const items = Array.isArray((req.body || {}).items) ? req.body.items : [];
  const action = req.body.action === 'reject' ? 'reject' : 'approve';
  const reason = String(req.body.reason || '').slice(0, 120);
  let done = 0;
  const blocked = [];
  items.forEach((item) => {
    if (!TABLES[item.type]) return;
    const result = applyReview({
      type: item.type,
      id: Number(item.id),
      action,
      reason,
      actor: req.user,
      /* 批量不允许自我裁决：一条理由套很多条，说不清楚 */
      allowSelf: false,
    });
    if (result.ok) done += 1;
    else blocked.push({ type: item.type, id: Number(item.id), error: result.error });
  });
  res.json({ ok: true, done, blocked });
});

adminRouter.get('/stats', (_req, res) => {
  const count = (sql, ...params) => db.prepare(sql).get(...params).c;
  const today = new Date().toISOString().slice(0, 10);

  const pending = {
    post: count("SELECT COUNT(*) AS c FROM posts WHERE review_status = 'manual_review'"),
    message: count("SELECT COUNT(*) AS c FROM messages WHERE review_status = 'manual_review'"),
    danmaku: count("SELECT COUNT(*) AS c FROM danmaku WHERE review_status = 'manual_review'"),
    avatar: count("SELECT COUNT(*) AS c FROM users WHERE avatar_pending <> ''"),
    recovery: count("SELECT COUNT(*) AS c FROM recovery_requests WHERE status = 'open'"),
  };

  const trend = db
    .prepare(
      `SELECT day, SUM(posts) AS posts, SUM(danmaku) AS danmaku FROM (
         SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS posts, 0 AS danmaku
           FROM posts WHERE substr(created_at, 1, 10) >= date('now', '-6 days') GROUP BY day
         UNION ALL
         SELECT substr(created_at, 1, 10) AS day, 0 AS posts, COUNT(*) AS danmaku
           FROM danmaku WHERE substr(created_at, 1, 10) >= date('now', '-6 days') GROUP BY day
       ) GROUP BY day ORDER BY day ASC`
    )
    .all();

  res.json({
    pending,
    pendingTotal: pending.post + pending.message + pending.danmaku + pending.avatar + pending.recovery,
    publishedToday: count(
      "SELECT COUNT(*) AS c FROM posts WHERE review_status = 'published' AND substr(created_at, 1, 10) = ?",
      today
    ),
    newUsersToday: count('SELECT COUNT(*) AS c FROM users WHERE substr(created_at, 1, 10) = ?', today),
    bannedUsers: count("SELECT COUNT(*) AS c FROM users WHERE status = 'banned'"),
    autoRejectedToday: count(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'review.reject' AND substr(created_at, 1, 10) = ?",
      today
    ),
    openReports: count("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'"),
    livePosts: count("SELECT COUNT(*) AS c FROM posts WHERE review_status = 'published' AND lifecycle = 'live'"),
    scheduledPosts: count("SELECT COUNT(*) AS c FROM posts WHERE lifecycle = 'scheduled'"),
    expiredPosts: count("SELECT COUNT(*) AS c FROM posts WHERE lifecycle = 'expired'"),
    trend: trend.map((row) => ({ day: row.day, posts: row.posts, danmaku: row.danmaku })),
  });
});

adminRouter.get('/posts', (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const q = req.query.q ? String(req.query.q) : null;
  const onlyDeleted = req.query.deleted === '1' || req.query.deleted === 'true';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const page = Math.max(1, Number(req.query.page) || 1);

  const where = [onlyDeleted ? 'p.deleted_at IS NOT NULL' : 'p.deleted_at IS NULL'];
  const params = [];
  if (status) {
    where.push('p.review_status = ?');
    params.push(status);
  }
  if (req.query.lifecycle) {
    where.push('p.lifecycle = ?');
    params.push(String(req.query.lifecycle));
  }
  if (q) {
    where.push('(p.content LIKE ? OR u.username LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const rows = db
    .prepare(
      `SELECT p.*, u.anon_name, u.anon_color, u.avatar_url, u.username, u.role AS author_role
       FROM posts p JOIN users u ON u.id = p.author_id ${whereSql}
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, (page - 1) * limit);

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM posts p JOIN users u ON u.id = p.author_id ${whereSql}`
    )
    .get(...params).c;

  res.json({
    total,
    page,
    limit,
    posts: rows.map((row) => ({
      id: row.id,
      content: row.content,
      images: parseJsonArray(row.images),
      visibility: row.visibility,
      reviewStatus: row.review_status,
      lifecycle: row.lifecycle,
      pinned: !!row.pinned,
      likeCount: row.like_count,
      messageCount: row.message_count,
      danmakuCount: row.danmaku_count,
      viewCount: row.view_count,
      publishAt: row.publish_at,
      expiresAt: row.expires_at,
      rejectReason: row.reject_reason,
      deletedAt: row.deleted_at || null,
      createdAt: row.created_at,
      author: {
        id: row.author_id,
        username: row.username,
        anonName: row.anon_name,
        anonColor: row.anon_color,
        avatarUrl: row.avatar_url || '',
      },
    })),
  });
});

adminRouter.patch('/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '内容不存在' });
  const body = req.body || {};

  let content = row.content;
  if (body.content !== undefined) {
    content = String(body.content).trim();
    if (!content) return res.status(400).json({ error: '正文不能为空' });
    if (content.length > 1000) return res.status(400).json({ error: '正文不能超过 1000 字' });
  }

  const reviewStatus = body.reviewStatus || row.review_status;
  const publishAt = body.publishAt === undefined ? row.publish_at : body.publishAt;
  const expiresAt = body.expiresAt === undefined ? row.expires_at : body.expiresAt;
  const lifecycle = computeLifecycle({ reviewStatus, publishAt, expiresAt });

  db.prepare(
    `UPDATE posts SET content = ?, pinned = ?, visibility = ?, review_status = ?, lifecycle = ?,
      publish_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`
  ).run(
    content,
    body.pinned === undefined ? row.pinned : body.pinned ? 1 : 0,
    body.visibility || row.visibility,
    reviewStatus,
    lifecycle,
    publishAt,
    expiresAt,
    nowIso(),
    id
  );

  logAudit({
    actor: req.user,
    action: 'admin.post.update',
    targetType: 'post',
    targetId: id,
    detail: { ...body, contentChanged: content !== row.content },
  });
  res.json({ ok: true, lifecycle, content });
});

/**
 * 下架 / 恢复一件心事。
 *
 * 单条与批量共用这一段 —— 批量最容易写着写着就绕开了权限判定，
 * 所以两边必须是同一份代码，只差调用方式。
 *
 * 下架/恢复自己的内容是**资源管理**，不是裁判：作者本来就能删自己的贴，
 * 没有「既当运动员又当裁判」的问题，所以允许对本人放行（allowSelf）。
 */
function applyPostTrash({ id, action, reason, actor }) {
  const row = db.prepare('SELECT id, author_id, deleted_at FROM posts WHERE id = ?').get(id);
  if (!row) return { ok: false, status: 404, error: '内容不存在' };

  const verdict = checkAuthority(actor, findUser(row.author_id), { subject: '内容', allowSelf: true });
  if (!verdict.ok) return { ok: false, status: verdict.status, error: verdict.error };

  if (action === 'restore') {
    if (!row.deleted_at) return { ok: false, status: 400, error: '该内容不在回收站中' };
    db.prepare('UPDATE posts SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id);
    logAudit({ actor, action: 'admin.post.restore', targetType: 'post', targetId: id, detail: {} });
    return { ok: true };
  }

  if (row.deleted_at) return { ok: false, status: 400, error: '该内容已在回收站中' };
  const ts = nowIso();
  db.prepare('UPDATE posts SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?').run(ts, actor.id, ts, id);
  notify(row.author_id, 'system', '你的心事已被下架', `原因：${reason}`);
  logAudit({ actor, action: 'admin.post.delete', targetType: 'post', targetId: id, detail: { reason } });
  return { ok: true };
}

adminRouter.post('/posts/:id/delete', (req, res) => {
  const result = applyPostTrash({
    id: Number(req.params.id),
    action: 'delete',
    reason: String((req.body || {}).reason || '违反社区规范').slice(0, 80),
    actor: req.user,
  });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json({ ok: true });
});

adminRouter.post('/posts/:id/restore', (req, res) => {
  const result = applyPostTrash({ id: Number(req.params.id), action: 'restore', actor: req.user });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json({ ok: true });
});

/**
 * 批量下架 / 批量恢复。
 *
 * 逐条跑同一段判定，越权的单独记进 blocked 并原样报给前端 ——
 * 不因为「是批量」就整批放弃，也不能悄悄跳过：
 * 用户需要知道哪几条没动、为什么没动。
 */
adminRouter.post('/posts/batch', (req, res) => {
  const body = req.body || {};
  const action = body.action === 'restore' ? 'restore' : 'delete';
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean))].slice(0, 100);
  if (!ids.length) return res.status(400).json({ error: '没有选中任何内容' });

  const reason = String(body.reason || '违反社区规范').slice(0, 80);
  let done = 0;
  const blocked = [];
  ids.forEach((id) => {
    const result = applyPostTrash({ id, action, reason, actor: req.user });
    if (result.ok) done += 1;
    else blocked.push({ id, error: result.error });
  });
  res.json({ ok: true, done, blocked });
});

adminRouter.get('/users', (req, res) => {
  const q = req.query.q ? String(req.query.q) : null;
  const role = req.query.role ? String(req.query.role) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const page = Math.max(1, Number(req.query.page) || 1);

  const where = [];
  const params = [];
  if (q) {
    where.push('(username LIKE ? OR anon_name LIKE ? OR nickname LIKE ? OR CAST(uid AS TEXT) LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (role) {
    where.push('role = ?');
    params.push(role);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT id, uid, username, nickname, anon_name, anon_color, avatar_url, role, status, violation_count,
        created_at, last_login_at, register_ip, last_login_ip,
        email, email_verified, phone, phone_verified, real_name, real_verified,
        (SELECT COUNT(*) FROM posts WHERE author_id = users.id AND deleted_at IS NULL) AS post_count
       FROM users ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, (page - 1) * limit);

  const total = db.prepare(`SELECT COUNT(*) AS c FROM users ${whereSql}`).get(...params).c;
  /* 联系方式与实名资料属于个人隐私，只有超级管理员能看到 */
  const canSeePrivate = req.user.role === SUPER_ROLE;

  res.json({
    total,
    page,
    limit,
    users: rows.map((row) => {
      const ban = activeBan(row.id);
      return {
        id: row.id,
        uid: row.uid ?? null,
        username: row.username,
        nickname: row.nickname || '',
        anonName: row.anon_name,
        anonColor: row.anon_color,
        avatarUrl: row.avatar_url || '',
        role: row.role,
        status: row.status,
        violationCount: row.violation_count,
        postCount: row.post_count,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        /* 注册与登录来源：真实记录，仅超级管理员可见 */
        registerIp: canSeePrivate ? row.register_ip || '' : '',
        lastLoginIp: canSeePrivate ? row.last_login_ip || '' : '',
        verified: {
          email: Boolean(row.email_verified),
          phone: Boolean(row.phone_verified),
          realName: Boolean(row.real_verified),
        },
        contact: canSeePrivate
          ? {
              email: row.email || '',
              phone: row.phone || '',
              realName: row.real_name ? decryptField(row.real_name) : '',
            }
          : null,
        ban: ban ? { id: ban.id, reason: ban.reason, until: ban.until } : null,
      };
    }),
  });
});

/**
 * 人工核验：超级管理员可以直接把某个账号的邮箱 / 手机号 / 实名标记为已核验。
 * 只在该能力已开启时可用，关闭状态下与用户侧一样不可触碰。
 */
adminRouter.patch('/users/:id/verify', requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = findUser(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  /* 核验是「替这个人背书」，不能给自己背书，也不能越过层级 */
  if (!guard(res, req.user, target, { subject: '核验资料' })) return;

  const verification = getVerification();
  const body = req.body || {};
  const now = nowIso();
  const items = [
    { field: 'emailVerified', column: 'email_verified', at: 'email_verified_at', enabled: verification.emailEnabled, label: '邮箱' },
    { field: 'phoneVerified', column: 'phone_verified', at: 'phone_verified_at', enabled: verification.phoneEnabled, label: '手机号' },
    { field: 'realVerified', column: 'real_verified', at: 'real_verified_at', enabled: verification.realNameEnabled, label: '实名' },
  ].filter((item) => body[item.field] !== undefined);

  if (items.length === 0) return res.status(400).json({ error: '没有需要更新的核验状态' });
  const blocked = items.find((item) => !item.enabled);
  if (blocked) return res.status(403).json({ error: `${blocked.label}验证尚未开放，无法核验` });

  items.forEach((item) => {
    const verified = Boolean(body[item.field]);
    db.prepare(`UPDATE users SET ${item.column} = ?, ${item.at} = ? WHERE id = ?`).run(
      verified ? 1 : 0,
      verified ? now : null,
      id
    );
  });

  const changed = items.map((item) => ({ field: item.field, verified: Boolean(body[item.field]) }));
  logAudit({ actor: req.user, action: 'user.verify', targetType: 'user', targetId: id, detail: { changed } });
  return res.json({ ok: true, changed });
});

/**
 * 封禁时长预制：短时（1 小时 / 1 天 / 3 天）、长时（7 天 / 30 天 / 90 天）、永久。
 * 前端用同一套 key，两端不会各写一份时长表而对不上。
 */
const BAN_PRESETS = {
  '1h': { minutes: 60, label: '1 小时' },
  '1d': { minutes: 1440, label: '1 天' },
  '3d': { minutes: 4320, label: '3 天' },
  '7d': { minutes: 10080, label: '7 天' },
  '30d': { minutes: 43200, label: '30 天' },
  '90d': { minutes: 129600, label: '90 天' },
  forever: { minutes: null, label: '永久' },
};

/** 解析封禁时长：preset 预制品 / durationMinutes 自定义分钟数 / until 具体解封时间，三选一 */
function parseBanWindow(body) {
  if (body.preset !== undefined) {
    const preset = BAN_PRESETS[String(body.preset)];
    if (!preset) return { error: '未知的封禁时长' };
    return {
      until: preset.minutes === null ? null : new Date(Date.now() + preset.minutes * 60_000).toISOString(),
      label: preset.label,
    };
  }
  if (body.durationMinutes !== undefined && body.durationMinutes !== null) {
    const minutes = Number(body.durationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return { error: '封禁时长需为大于 0 的分钟数' };
    return { until: new Date(Date.now() + Math.min(minutes, 525_600) * 60_000).toISOString(), label: `${minutes} 分钟` };
  }
  if (body.until) {
    const parsed = new Date(body.until);
    if (Number.isNaN(parsed.getTime())) return { error: '解封时间格式不正确' };
    return { until: parsed.toISOString(), label: '自定义时间' };
  }
  return { until: null, label: '永久' };
}

/** 封禁一个账号：单条与批量共用这一段层级判定 */
function applyBan({ id, reason, until, label, actor }) {
  const target = findUser(id);
  if (!target) return { ok: false, status: 404, error: '用户不存在' };
  /* 超管单独给一句明确的话，其余交给统一的层级判定 */
  if (target.role === SUPER_ROLE) return { ok: false, status: 400, error: '不能封禁超级管理员账号' };
  /* 不能封自己，也不能封同级或上级 —— 管理员封管理员会被挡在层级判定里 */
  const verdict = checkAuthority(actor, target, { subject: '账号' });
  if (!verdict.ok) return { ok: false, status: verdict.status, error: verdict.error };

  db.prepare('INSERT INTO bans (user_id, reason, until, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    reason,
    until,
    actor.id,
    nowIso()
  );
  db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(id);
  /* 封禁即刻吊销全部服务端会话：已签发的令牌立刻失效，无法靠旧令牌继续操作 */
  revokeUserSessions(id);
  notify(
    id,
    'ban',
    '账号已被封禁',
    `原因：${reason}；时长：${label}${until ? `；解封时间 ${until.slice(0, 16).replace('T', ' ')}` : ''}`
  );

  logAudit({
    actor,
    action: 'user.ban',
    targetType: 'user',
    targetId: id,
    detail: { reason, until, preset: label },
  });
  return { ok: true };
}

/** 解封一个账号：分层规则与封禁一致 */
function applyUnban({ id, actor }) {
  const target = findUser(id);
  if (!target) return { ok: false, status: 404, error: '用户不存在' };
  const verdict = checkAuthority(actor, target, { subject: '账号' });
  if (!verdict.ok) return { ok: false, status: verdict.status, error: verdict.error };

  db.prepare('UPDATE bans SET lifted_at = ?, lifted_by = ? WHERE user_id = ? AND lifted_at IS NULL').run(
    nowIso(),
    actor.id,
    id
  );
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id);
  notify(id, 'ban', '账号已解封', '请遵守社区规范。');
  logAudit({ actor, action: 'user.unban', targetType: 'user', targetId: id, detail: {} });
  return { ok: true };
}

adminRouter.post('/users/:id/ban', requireAdmin, (req, res) => {
  const body = req.body || {};
  const window = parseBanWindow(body);
  if (window.error) return res.status(400).json({ error: window.error });

  const result = applyBan({
    id: Number(req.params.id),
    reason: String(body.reason || '').slice(0, 120) || '违反社区规范',
    until: window.until,
    label: window.label,
    actor: req.user,
  });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json({ ok: true, until: window.until, preset: window.label });
});

/**
 * 批量封禁 / 批量解封。
 * 时长对整批生效（批量本来就是一个统一的处置决定），逐条做层级判定。
 */
adminRouter.post('/users/batch', requireAdmin, (req, res) => {
  const body = req.body || {};
  const action = body.action === 'unban' ? 'unban' : 'ban';
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean))].slice(0, 100);
  if (!ids.length) return res.status(400).json({ error: '没有选中任何账号' });

  const reason = String(body.reason || '').slice(0, 120) || '违反社区规范';
  const window = action === 'ban' ? parseBanWindow(body) : { until: null, label: '' };
  if (window.error) return res.status(400).json({ error: window.error });

  let done = 0;
  const blocked = [];
  ids.forEach((id) => {
    const result =
      action === 'unban'
        ? applyUnban({ id, actor: req.user })
        : applyBan({ id, reason, until: window.until, label: window.label, actor: req.user });
    if (result.ok) done += 1;
    else blocked.push({ id, error: result.error });
  });
  res.json({ ok: true, done, blocked, until: window.until, preset: window.label });
});

/**
 * 管理员协助重置口令：仅超级管理员。
 * 生成一次性临时口令返回给管理员（只在这一次响应里出现，不入库明文），
 * 用户拿到后登录应立刻自行修改；同时吊销该账号的全部登录态。
 */
adminRouter.post('/users/:id/reset-password', requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT id, username, role, status FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (id === req.user.id) return res.status(400).json({ error: '请用「个人信息 → 账号与安全」修改自己的密码' });

  const tempPassword = randomPassword(12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(tempPassword), id);
  revokeUserSessions(id);
  notify(id, 'system', '密码已被管理员重置', '请尽快登录并在「个人信息 → 账号与安全」里改成自己的密码。');
  logAudit({
    actor: req.user,
    action: 'user.reset_password',
    targetType: 'user',
    targetId: id,
    detail: { username: target.username },
  });
  res.json({ ok: true, tempPassword, username: target.username });
});

/* ── 找回密码申请（审批台统一处理） ─────────────────────────────── */

adminRouter.get('/recovery', (req, res) => {
  const status = req.query.status ? String(req.query.status) : 'open';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const page = Math.max(1, Number(req.query.page) || 1);
  const whereSql = status === 'all' ? '' : 'WHERE r.status = ?';
  const params = status === 'all' ? [] : [status];

  const rows = db
    .prepare(
      `SELECT r.*, u.anon_name, u.anon_color, u.avatar_url, u.username AS current_username,
        u.status AS user_status, u.role AS user_role,
        h.anon_name AS handler_name
       FROM recovery_requests r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN users h ON h.id = r.handled_by
       ${whereSql} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, (page - 1) * limit);

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM recovery_requests r ${whereSql}`)
    .get(...params).c;

  res.json({
    total,
    page,
    limit,
    status,
    requests: rows.map((row) => ({
      id: row.id,
      account: row.account,
      userId: row.user_id,
      uid: row.uid ?? null,
      username: row.current_username || '',
      anonName: row.anon_name || '',
      anonColor: row.anon_color || '',
      avatarUrl: row.avatar_url || '',
      userStatus: row.user_status || 'missing',
      method: row.method,
      status: row.status,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      handledBy: row.handler_name || '',
      handledAt: row.handled_at,
      handledNote: row.handled_note || '',
      /* 申请人自己的申请不能自己批：前端据此提示要写理由（仅超管走得通） */
      self: Number(row.user_id) === Number(req.user.id),
    })),
  });
});

adminRouter.patch('/recovery/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM recovery_requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '申请不存在' });

  const body = req.body || {};
  const status = body.status === 'rejected' ? 'rejected' : body.status === 'open' ? 'open' : 'handled';
  const note = String(body.note || '').slice(0, 200);

  /*
   * 谁不能批谁的找回申请：
   *   · 申请人自己 —— 没人会替自己核实身份；
   *   · 层级不低于操作者的人 —— 管理员批不了管理员，更批不了超管。
   * 超管自己是唯一的例外（上面没人），说明仍然选填：写了会随站内信一起送达。
   */
  const applicant = row.user_id ? findUser(row.user_id) : null;
  if (applicant) {
    const verdict = guard(res, req.user, applicant, { subject: '找回申请' });
    if (!verdict) return;
  }

  db.prepare(
    'UPDATE recovery_requests SET status = ?, handled_by = ?, handled_at = ?, handled_note = ? WHERE id = ?'
  ).run(status, status === 'open' ? null : req.user.id, status === 'open' ? null : nowIso(), note, id);

  if (row.user_id && status !== 'open') {
    /*
     * 通知里带上管理员写的说明，并且和「我的找回记录」里显示的内容保持一致：
     * 用户在这两处看到的是同一句话，不会出现「站内信说得含糊、记录里才有细节」。
     */
    const fallback =
      status === 'handled'
        ? '管理员已完成核实，请按沟通的方式获取新密码并尽快自行修改。'
        : '核实未通过，如有疑问可以再次提交申请。';
    notify(
      row.user_id,
      'recovery',
      status === 'handled' ? '找回密码申请已通过' : '找回密码申请未通过',
      note || fallback
    );
  }

  logAudit({
    actor: req.user,
    action: `recovery.${status}`,
    targetType: 'user',
    targetId: row.user_id,
    detail: { requestId: id, method: row.method },
  });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/unban', requireAdmin, (req, res) => {
  const result = applyUnban({ id: Number(req.params.id), actor: req.user });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json({ ok: true });
});

/**
 * 角色分配只有超级管理员能做，且 superadmin 本身不可被授予或剥夺
 * —— 它只由服务端启动流程自举（见 lib/auth.js ensureAdminAccount）。
 */
adminRouter.patch('/users/:id/role', requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  const role = String((req.body || {}).role || '');
  if (!['user', 'reviewer', 'admin'].includes(role)) {
    return res.status(400).json({ error: '未知角色' });
  }
  const target = db.prepare('SELECT id, role, username, anon_name, status FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  if (target.role === SUPER_ROLE) return res.status(400).json({ error: '超级管理员角色不可变更' });
  /* 不能改自己，也不能改和自己平级或更高的人 */
  if (!guard(res, req.user, target, { subject: '角色' })) return;

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  /* 角色变更同样吊销会话，降权后旧令牌不能继续使用 */
  revokeUserSessions(id);
  logAudit({ actor: req.user, action: 'user.role', targetType: 'user', targetId: id, detail: { role } });
  res.json({ ok: true });
});

adminRouter.get('/rules', (_req, res) => {
  res.json({ rules: getRules() });
});

adminRouter.put('/rules', requireSuperAdmin, (req, res) => {
  const body = req.body || {};
  const next = saveRules({
    autoReviewEnabled: !!body.autoReviewEnabled,
    blockWords: Array.isArray(body.blockWords) ? body.blockWords.filter(Boolean).slice(0, 200) : undefined,
    softWords: Array.isArray(body.softWords) ? body.softWords.filter(Boolean).slice(0, 200) : undefined,
    linkNeedsReview: !!body.linkNeedsReview,
    newUserNeedsReview: !!body.newUserNeedsReview,
    newUserDays: Number(body.newUserDays) || 0,
    maxPostsPerHour: Number(body.maxPostsPerHour) || 1,
    maxMessagesPerHour: Number(body.maxMessagesPerHour) || 1,
    maxDanmakuPerMinute: Number(body.maxDanmakuPerMinute) || 1,
    duplicateNeedsReview: !!body.duplicateNeedsReview,
    duplicateThreshold: Math.min(1, Math.max(0.3, Number(body.duplicateThreshold) || 0.82)),
    autoApproveDanmaku: !!body.autoApproveDanmaku,
    autoApproveMessages: !!body.autoApproveMessages,
    imageNeedsReview: !!body.imageNeedsReview,
    hotWeights: body.hotWeights || undefined,
    hotDecay: Number(body.hotDecay) || 1.5,
  });
  logAudit({ actor: req.user, action: 'rules.update', targetType: 'settings', targetId: null, detail: next });
  res.json({ rules: next });
});

/* ── 站点与安全配置 ─────────────────────────────────────────────── */

adminRouter.get('/site-config', (_req, res) => {
  res.json({ config: getSiteConfig() });
});

adminRouter.put('/site-config', requireSuperAdmin, (req, res) => {
  const body = req.body || {};
  const next = saveSiteConfig({
    allowRegister: body.allowRegister,
    allowGuestLogin: body.allowGuestLogin,

    avatarNeedsReview: body.avatarNeedsReview,
    guestHourlyLimitPerIp: body.guestHourlyLimitPerIp,
    announcement: body.announcement,
    verification: body.verification,
    recovery: body.recovery,
    security: body.security,
  });
  logAudit({ actor: req.user, action: 'site_config.update', targetType: 'settings', targetId: null, detail: next });
  res.json({ config: next });
});

/* ── 认证安全：锁定列表、事件留痕与手动解锁 ───────────────────── */

adminRouter.get('/security', (req, res) => {
  const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 60));
  res.json({
    locks: listActiveLocks(limit),
    events: recentAuthEvents(limit),
    channel: channelStats(),
    viewerIp: clientIp(req),
  });
});

adminRouter.post('/security/unlock', requireAdmin, (req, res) => {
  const id = Number((req.body || {}).id);
  if (!id) return res.status(400).json({ error: '缺少锁定记录 ID' });
  const ok = releaseLock(id, req.user.id);
  if (!ok) return res.status(404).json({ error: '锁定记录不存在' });
  logAudit({ actor: req.user, action: 'security.unlock', targetType: 'lock', targetId: id, detail: {} });
  return res.json({ ok: true, locks: listActiveLocks(60) });
});

/* ── 访客登录记录 ───────────────────────────────────────────────── */

adminRouter.get('/guests', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const page = Math.max(1, Number(req.query.page) || 1);
  const rows = db
    .prepare(
      `SELECT g.*, u.status AS user_status, u.violation_count, u.avatar_url, u.anon_color
       FROM guest_logins g JOIN users u ON u.id = g.user_id
       ORDER BY g.created_at DESC, g.id DESC LIMIT ? OFFSET ?`
    )
    .all(limit, (page - 1) * limit);
  const total = db.prepare('SELECT COUNT(*) AS c FROM guest_logins').get().c;
  res.json({
    total,
    page,
    limit,
    guests: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      anonName: row.anon_name,
      anonColor: row.anon_color,
      ip: row.ip,
      userAgent: row.user_agent,
      userStatus: row.user_status,
      violationCount: row.violation_count,
      createdAt: row.created_at,
    })),
  });
});

/* ── 头像审核 ───────────────────────────────────────────────────── */

adminRouter.get('/avatars', (req, res) => {
  const roles = rolesBelow(req.user);
  const scope = roles.length ? ` AND role IN (${roles.map(() => '?').join(',')})` : '';
  const rows = db
    .prepare(
      `SELECT id, username, anon_name, anon_color, role, avatar_url, avatar_pending, avatar_status, avatar_submitted_at
       FROM users WHERE avatar_pending <> ''${scope}
       ORDER BY COALESCE(avatar_submitted_at, created_at) DESC LIMIT 200`
    )
    .all(...roles);
  res.json({
    avatars: rows.map((row) => ({
      id: row.id,
      username: row.username,
      anonName: row.anon_name,
      anonColor: row.anon_color,
      role: row.role,
      avatarUrl: row.avatar_url || '',
      avatarPending: row.avatar_pending,
      avatarStatus: row.avatar_status,
      submittedAt: row.avatar_submitted_at,
      /* 自己的头像只有超管能看到并处理，前端据此要求写理由 */
      self: row.id === req.user.id,
    })),
  });
});

adminRouter.post('/avatars/:id/decide', (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target || !target.avatar_pending) return res.status(404).json({ error: '没有待审核的头像' });

  const action = (req.body || {}).action === 'reject' ? 'reject' : 'approve';
  const reason = String((req.body || {}).reason || '').slice(0, 120);

  /* 自己的头像也只有超管能处理；理由选填，填了会进审计日志与驳回通知 */
  const verdict = guard(res, req.user, target, { subject: '头像' });
  if (!verdict) return;
  if (action === 'approve') {
    db.prepare(
      "UPDATE users SET avatar_url = avatar_pending, avatar_pending = '', avatar_status = 'approved', avatar_submitted_at = NULL WHERE id = ?"
    ).run(id);
    notify(id, 'review', '头像已通过审核', '新头像已在全站生效。');
  } else {
    db.prepare(
      "UPDATE users SET avatar_pending = '', avatar_status = 'rejected', avatar_submitted_at = NULL WHERE id = ?"
    ).run(id);
    notify(id, 'review', '头像未通过审核', `原因：${reason || '图片不符合社区规范'}`);
  }
  logAudit({
    actor: req.user,
    action: `avatar.${action}`,
    targetType: 'user',
    targetId: id,
    detail: { reason: reason || null },
  });
  res.json({ ok: true });
});

adminRouter.get('/reports', (req, res) => {
  const status = req.query.status ? String(req.query.status) : 'open';
  const rows = db
    .prepare(
      `SELECT r.*, u.anon_name AS reporter_name, u.anon_color AS reporter_color,
              u.uid AS reporter_uid, u.username AS reporter_username,
              COALESCE(p.author_id, m.author_id) AS owner_id,
              COALESCE(pu.anon_name, mu.anon_name) AS owner_name,
              COALESCE(pu.role, mu.role) AS owner_role
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
       LEFT JOIN posts p ON r.target_type = 'post' AND p.id = r.target_id
       LEFT JOIN users pu ON pu.id = p.author_id
       LEFT JOIN messages m ON r.target_type = 'message' AND m.id = r.target_id
       LEFT JOIN users mu ON mu.id = m.author_id
       WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 100`
    )
    .all(status);

  const mine = Number(req.user.id);
  const superAdmin = rankOf(req.user) === ROLE_RANK.superadmin;

  res.json({
    reports: rows
      .filter((row) => {
        /* 处理不了的东西不进队列：超管照单全收，其余人只看得到下级的举报 */
        if (superAdmin) return true;
        if (!row.owner_id) return true; // 内容已删，收尾处理
        return rankOf(req.user) > rankOf(row.owner_role);
      })
      .map((row) => {
        let excerpt = '';
        if (row.target_type === 'post') {
          const post = db.prepare('SELECT content FROM posts WHERE id = ?').get(row.target_id);
          excerpt = post ? post.content.slice(0, 120) : '（内容已删除）';
        } else {
          const msg = db.prepare('SELECT content FROM messages WHERE id = ?').get(row.target_id);
          excerpt = msg ? msg.content.slice(0, 120) : '（留言已删除）';
        }
        /*
         * self：举报人或被举报内容就是自己。
         * 这类举报不该由当事人自己拍板，前端会挡下来并说明原因；
         * 超管若确实需要收尾，走「自我裁决」通道（理由选填）。
         */
        const self = Number(row.reporter_id) === mine || Number(row.owner_id) === mine;
        return {
          id: row.id,
          targetType: row.target_type,
          targetId: row.target_id,
          reason: row.reason,
          detail: row.detail,
          status: row.status,
          createdAt: row.created_at,
          handledAt: row.handled_at,
          handledNote: row.handled_note || '',
          excerpt,
          self,
          owner: {
            id: row.owner_id ?? null,
            anonName: row.owner_name || '',
            role: row.owner_role || 'user',
          },
          reporter: {
            anonName: row.reporter_name,
            anonColor: row.reporter_color,
            /* 举报人编号与当前账号：处理时能对上人 */
            uid: row.reporter_uid ?? null,
            username: row.reporter_username || '',
            id: row.reporter_id,
          },
        };
      }),
  });
});

/**
 * 处理一条举报：忽略（原样保留）或删除被举报的内容。
 * 单条与批量共用，权限与「只审判一次」的判定只有这一份。
 */
function applyReport({ id, action, note, actor }) {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!row) return { ok: false, status: 404, error: '举报不存在' };

  /* 一条举报只审判一次：已处理的不能再改判，避免反复翻案 */
  if (row.status !== 'open') return { ok: false, status: 409, error: '这条举报已经处理过了' };

  /* 被举报内容的作者：层级必须低于操作者 */
  const content = db
    .prepare(`SELECT author_id AS owner_id FROM ${row.target_type === 'post' ? 'posts' : 'messages'} WHERE id = ?`)
    .get(row.target_id);
  const owner = content ? findUser(content.owner_id) : null;
  if (owner) {
    const verdict = checkAuthority(actor, owner, { subject: '内容' });
    if (!verdict.ok) return { ok: false, status: verdict.status, error: verdict.error };
  }

  /* 当事人不能自己拍板：既不能审判自己提交的举报，也不能审判举报自己的那份。
     超管是唯一例外（上面没人），说明同样选填。 */
  const involved = Number(row.reporter_id) === Number(actor.id) || Number(owner?.id) === Number(actor.id);
  if (involved && rankOf(actor) !== ROLE_RANK.superadmin) {
    return { ok: false, status: 403, error: '不能处理与自己相关的举报' };
  }

  /*
   * 处理说明：写给举报人的一句话。
   * 「已处理」三个字对举报人没有任何信息量，所以留空时也给一句能看懂的结论。
   */
  const text = String(note || '').trim().slice(0, 200);
  db.prepare(
    'UPDATE reports SET status = ?, handled_by = ?, handled_at = ?, handled_note = ? WHERE id = ?'
  ).run(action === 'remove' ? 'removed' : 'dismissed', actor.id, nowIso(), text, id);

  if (action === 'remove') {
    if (row.target_type === 'post') db.prepare('DELETE FROM posts WHERE id = ?').run(row.target_id);
    else db.prepare('DELETE FROM messages WHERE id = ?').run(row.target_id);
  }

  /* 回执：把处理结论与说明回给举报人，让举报这件事有下文 */
  const fallback =
    action === 'remove'
      ? '你举报的内容已被核实并下架，感谢你帮忙维护这里的气氛。'
      : '我们已核实过你举报的内容，暂未发现问题，会继续留意。';
  notify(
    row.reporter_id,
    'review',
    action === 'remove' ? '你举报的内容已被处理' : '你的举报已核实',
    text || fallback
  );

  logAudit({
    actor,
    action: `report.${action}`,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: { reportId: id, note: text || null, self: involved || undefined },
  });
  return { ok: true };
}

adminRouter.post('/reports/:id/resolve', (req, res) => {
  const body = req.body || {};
  const result = applyReport({
    id: Number(req.params.id),
    action: String(body.action || 'dismiss') === 'remove' ? 'remove' : 'dismiss',
    note: body.note,
    actor: req.user,
  });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json({ ok: true });
});

/** 批量忽略 / 批量删除被举报的内容：逐条判定，越权的报回 blocked */
adminRouter.post('/reports/batch', (req, res) => {
  const body = req.body || {};
  const action = body.action === 'remove' ? 'remove' : 'dismiss';
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean))].slice(0, 100);
  if (!ids.length) return res.status(400).json({ error: '没有选中任何举报' });

  let done = 0;
  const blocked = [];
  ids.forEach((id) => {
    const result = applyReport({ id, action, note: body.note, actor: req.user });
    if (result.ok) done += 1;
    else blocked.push({ id, error: result.error });
  });
  res.json({ ok: true, done, blocked });
});

/* ── 站内回复：给指定人群发站内信 ───────────────────────────── */

const SITE_MESSAGE_ROLES = ['user', 'reviewer', 'admin', SUPER_ROLE];
const SITE_MESSAGE_LIMITS = { title: 60, body: 600, targets: 200, recipients: 5000 };

/**
 * 谁可以发站内回复。
 *
 * 目前只有站长（超级管理员）。以后要放开给值班审核员或客服，
 * 只改这一个函数即可，接口与前端都不用动。
 */
function canSendSiteMessage(user) {
  return user?.role === SUPER_ROLE;
}

const NOT_GUEST = "username NOT LIKE 'guest_%'";

/** 各人群规模的实时预览，前端据此显示「将发送给 N 人」 */
adminRouter.get('/site-messages/targets', (req, res) => {
  if (!canSendSiteMessage(req.user)) return res.status(403).json({ error: '只有站长可以发送站内回复' });
  const count = (sql, ...params) => db.prepare(sql).get(...params).c;
  res.json({
    total: count('SELECT COUNT(*) AS c FROM users'),
    registered: count(`SELECT COUNT(*) AS c FROM users WHERE ${NOT_GUEST}`),
    roles: SITE_MESSAGE_ROLES.map((role) => ({
      role,
      count: count(`SELECT COUNT(*) AS c FROM users WHERE role = ? AND ${NOT_GUEST}`, role),
    })),
  });
});

adminRouter.post('/site-messages', (req, res) => {
  if (!canSendSiteMessage(req.user)) return res.status(403).json({ error: '只有站长可以发送站内回复' });

  const body = req.body || {};
  const title = String(body.title || '').trim().slice(0, SITE_MESSAGE_LIMITS.title);
  const text = String(body.body || '').trim().slice(0, SITE_MESSAGE_LIMITS.body);
  if (!title) return res.status(400).json({ error: '请填写标题' });
  if (!text) return res.status(400).json({ error: '请填写正文内容' });

  const audience = ['all', 'registered', 'role', 'user'].includes(body.audience) ? body.audience : 'registered';
  const missing = [];
  let ids = [];

  if (audience === 'all') {
    ids = db.prepare('SELECT id FROM users').all().map((row) => row.id);
  } else if (audience === 'registered') {
    ids = db.prepare(`SELECT id FROM users WHERE ${NOT_GUEST}`).all().map((row) => row.id);
  } else if (audience === 'role') {
    const role = String(body.role || 'user');
    if (!SITE_MESSAGE_ROLES.includes(role)) return res.status(400).json({ error: '收件人角色不正确' });
    ids = db.prepare(`SELECT id FROM users WHERE role = ? AND ${NOT_GUEST}`).all(role).map((row) => row.id);
  } else {
    const raw = Array.isArray(body.targets) ? body.targets : String(body.targets || '').split(/[\s,，、]+/);
    const keys = raw
      .map((key) => String(key || '').trim())
      .filter(Boolean)
      .slice(0, SITE_MESSAGE_LIMITS.targets);
    if (!keys.length) return res.status(400).json({ error: '请填写收件人：用户名或用户编号 UID' });

    const found = new Set();
    keys.forEach((key) => {
      const row = /^\d+$/.test(key)
        ? db.prepare('SELECT id FROM users WHERE uid = ?').get(Number(key))
        : db.prepare('SELECT id FROM users WHERE username = ?').get(key);
      if (row) found.add(row.id);
      else missing.push(key);
    });
    ids = [...found];
    if (!ids.length) return res.status(400).json({ error: `没有找到这些收件人：${missing.join('、')}` });
  }

  if (ids.length > SITE_MESSAGE_LIMITS.recipients) {
    return res
      .status(400)
      .json({ error: `一次最多发送给 ${SITE_MESSAGE_LIMITS.recipients} 人，当前选中 ${ids.length} 人` });
  }

  const type = body.type === 'review' ? 'review' : 'system';
  /*
   * 弹窗提醒：勾上之后，收件人**下次进站**时会弹出这封信一次。
   * 刻意不即时弹 —— 正在写东西的人被弹窗打断，比晚一点知道更糟。
   */
  const popup = body.popup === true || body.popup === 1 || body.popup === '1';

  /* 一封封信逐个插入太慢，包在事务里一次性提交 */
  db.exec('BEGIN');
  try {
    ids.forEach((id) => notify(id, type, title, text, { popup }));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  logAudit({
    actor: req.user,
    action: 'site_message.send',
    targetType: 'notification',
    targetId: null,
    detail: { audience, role: body.role || null, sent: ids.length, title, popup },
  });

  res.json({ ok: true, sent: ids.length, audience, popup, missing });
});

adminRouter.get('/audit', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const rows = db
    .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
    .all(limit);
  res.json({
    logs: rows.map((row) => ({
      id: row.id,
      actorName: row.actor_name,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      detail: JSON.parse(row.detail || '{}'),
      createdAt: row.created_at,
    })),
  });
});