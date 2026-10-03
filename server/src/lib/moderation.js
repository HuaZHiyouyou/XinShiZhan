import { db, getSetting, setSetting, nowIso } from '../db.js';

export const DEFAULT_RULES = {
  autoReviewEnabled: true,
  blockWords: ['代刷', '加微信', '博彩', '开票', '贷款秒批', '裸聊', '私域引流'],
  softWords: ['想死', '撑不下去', '崩溃', '吵架', '骂', '恨', '绝交'],
  linkNeedsReview: true,
  newUserNeedsReview: true,
  newUserDays: 3,
  maxPostsPerHour: 3,
  maxMessagesPerHour: 10,
  maxDanmakuPerMinute: 5,
  duplicateNeedsReview: true,
  duplicateThreshold: 0.82,
  autoApproveDanmaku: true,
  autoApproveMessages: true,
  imageNeedsReview: true,
  hotWeights: { like: 3, message: 2, danmaku: 1.5, view: 0.2 },
  hotDecay: 1.5,
};

export function getRules() {
  const stored = getSetting('rules', null);
  if (!stored) return { ...DEFAULT_RULES };
  return { ...DEFAULT_RULES, ...stored, hotWeights: { ...DEFAULT_RULES.hotWeights, ...(stored.hotWeights || {}) } };
}

export function saveRules(patch) {
  const base = getRules();
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );
  const next = {
    ...base,
    ...clean,
    hotWeights: { ...base.hotWeights, ...(clean.hotWeights || {}) },
  };
  setSetting('rules', next);
  return next;
}

export function ensureRulesSeeded() {
  if (!getSetting('rules', null)) setSetting('rules', DEFAULT_RULES);
}

const LINK_RE = /(https?:\/\/|www\.|\.com|\.cn|加\s*群|扫码|私聊)/i;

function normalize(text) {
  return text.replace(/\s+/g, '').toLowerCase();
}

function bigrams(text) {
  const set = new Set();
  for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
  return set;
}

function similarity(a, b) {
  const sa = bigrams(normalize(a));
  const sb = bigrams(normalize(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  sa.forEach((g) => {
    if (sb.has(g)) inter += 1;
  });
  return inter / (sa.size + sb.size - inter);
}

function countRecent(table, column, userId, sinceIso) {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} = ? AND created_at >= ?`)
    .get(userId, sinceIso);
  return row ? row.c : 0;
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

export function recentPostContents(userId, limit = 20) {
  return db
    .prepare('SELECT content FROM posts WHERE author_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit)
    .map((r) => r.content);
}

/**
 * 自动审核：返回 { status, mode, flags }
 * status: published（自动放行）| manual_review（转人工）| rejected（自动拒绝）
 */
export function autoReview({ kind, content, userId, user, hasImages = false, recentContents = [] }) {
  const rules = getRules();
  const flags = [];
  const text = String(content || '');

  if (!rules.autoReviewEnabled) {
    return { status: 'manual_review', mode: 'auto', flags: ['自动审核已关闭'] };
  }

  const hitBlock = rules.blockWords.filter((w) => w && text.includes(w));
  if (hitBlock.length) {
    return { status: 'rejected', mode: 'auto', flags: hitBlock.map((w) => `命中黑名单词：${w}`) };
  }

  if (kind === 'danmaku') {
    const used = countRecent('danmaku', 'user_id', userId, minutesAgo(1));
    if (used >= rules.maxDanmakuPerMinute) {
      return { status: 'rejected', mode: 'auto', flags: ['弹幕发送过于频繁'] };
    }
  }

  if (kind === 'post') {
    const used = countRecent('posts', 'author_id', userId, minutesAgo(60));
    if (used >= rules.maxPostsPerHour) {
      return { status: 'rejected', mode: 'auto', flags: ['一小时内发布次数超限'] };
    }
  }

  if (kind === 'message') {
    const used = countRecent('messages', 'author_id', userId, minutesAgo(60));
    if (used >= rules.maxMessagesPerHour) {
      return { status: 'rejected', mode: 'auto', flags: ['一小时内留言次数超限'] };
    }
  }

  const hitSoft = rules.softWords.filter((w) => w && text.includes(w));
  if (hitSoft.length) flags.push(...hitSoft.map((w) => `命中敏感词：${w}`));
  if (rules.linkNeedsReview && LINK_RE.test(text)) flags.push('包含链接或引流信息');
  if (hasImages && rules.imageNeedsReview) flags.push('包含图片，需人工确认');

  if (rules.newUserNeedsReview && user) {
    const ageDays = (Date.now() - new Date(user.created_at).getTime()) / 86400000;
    if (ageDays < rules.newUserDays) flags.push('新用户内容');
  }

  if (rules.duplicateNeedsReview && recentContents.length) {
    const top = recentContents.reduce(
      (max, prev) => Math.max(max, similarity(text, prev)),
      0
    );
    if (top >= rules.duplicateThreshold) flags.push('与历史内容高度相似');
  }

  if (flags.length) return { status: 'manual_review', mode: 'auto', flags };

  const autoApprove =
    kind === 'post' ? true : kind === 'danmaku' ? rules.autoApproveDanmaku : rules.autoApproveMessages;
  return {
    status: autoApprove ? 'published' : 'manual_review',
    mode: 'auto',
    flags: autoApprove ? [] : ['该类型默认需要人工确认'],
  };
}

/** 热度分：加权互动量 + 时间衰减 */
export function hotScore({ like_count, message_count, danmaku_count, view_count, created_at }) {
  const rules = getRules();
  const w = rules.hotWeights;
  const base =
    like_count * w.like + message_count * w.message + danmaku_count * w.danmaku + view_count * w.view;
  const hours = Math.max(0, (Date.now() - new Date(created_at).getTime()) / 3600000);
  return base / Math.pow(hours + 2, rules.hotDecay);
}

/**
 * 审计留痕。actor 可能是数据库原始行（anon_name）也可能是对外用户视图（anonName），
 * 这里统一归一化，避免把 undefined 绑进 SQLite 参数导致 500。
 */
export function logAudit({ actor, action, targetType, targetId, detail }) {
  const actorName = actor
    ? actor.anon_name ?? actor.anonName ?? actor.nickname ?? actor.username ?? 'system'
    : 'system';
  const target = targetId == null ? null : typeof targetId === 'object' ? JSON.stringify(targetId) : targetId;
  db.prepare(
    `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    actor?.id ?? null,
    String(actorName ?? 'system'),
    String(action ?? ''),
    targetType ? String(targetType) : null,
    target,
    JSON.stringify(detail || {}),
    nowIso()
  );
}

/**
 * 写一条站内信。
 * @param {number} userId 收件人
 * @param {string} type 类型（system / review / ban / recovery / site 等）
 * @param {string} title 标题
 * @param {string} body 正文
 * @param {{ popup?: boolean }} [options] popup=收件人下次进站时弹窗提醒一次
 */
export function notify(userId, type, title, body, options = {}) {
  db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, read, popup, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ).run(userId, type, title, body || '', options.popup ? 1 : 0, nowIso());
}