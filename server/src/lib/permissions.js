import { SUPER_ROLE } from './auth.js';

/**
 * 后台操作的越权判定。
 *
 * 站点里同时存在四种角色，如果没有一条统一规则，很容易出现
 * 「自己通过自己的内容」「管理员互相驳回」「审核员把管理员封了」这类事 ——
 * 不是有人恶意，而是每个接口各写一段判断，迟早会漏。
 *
 * 这里定两条原则，所有处理类接口都必须过这一关：
 *
 *   1. **不对自己动手** —— 自己发的内容、自己的头像、自己提交的举报、
 *      自己的找回申请、自己的账号，一律不能自己处理。
 *   2. **不越级动手** —— 只能处理等级**严格低于**自己的对象。
 *
 * 外加一条经过权衡的例外（见 SELF_ARBITER）：
 * 超级管理员是站点所有者，没有比他更高的人。如果他自己的内容进了待审队列，
 * 全站就没人能处理了，只能永远卡在那里。所以给超管留一条「自我裁决」通道，
 * 但必须逐条、必须留痕 —— 能干活的代价是把话说清楚（理由选填，写了就进日志）。
 */

export const ROLE_RANK = {
  [SUPER_ROLE]: 3,
  admin: 2,
  reviewer: 1,
  user: 0,
  guest: 0,
};

export const ROLE_LABEL = {
  [SUPER_ROLE]: '超级管理员',
  admin: '管理员',
  reviewer: '审核员',
  user: '住客',
  guest: '访客',
};

/** 允许「自我裁决」的角色：只有超管，因为只有他上面没人 */
export const SELF_ARBITER = SUPER_ROLE;

export function rankOf(who) {
  const role = typeof who === 'string' ? who : who?.role;
  return ROLE_RANK[role] ?? 0;
}

export function labelOf(who) {
  const role = typeof who === 'string' ? who : who?.role;
  return ROLE_LABEL[role] || role || '该账号';
}

export function isSuperAdmin(who) {
  return rankOf(who) === ROLE_RANK[SUPER_ROLE];
}

/**
 * 判定 actor 能不能处理 target（用户记录，至少要有 id / role）。
 *
 * @param {object} actor 操作者（会话里的用户视图）
 * @param {object} target 目标用户记录
 * @param {{ allowSelf?: boolean, subject?: string }} [options]
 *        allowSelf 仅由超管的自我裁决通道传 true；subject 用于拼错误提示
 * @returns {{ ok: true, self: boolean } | { ok: false, status: number, code: string, error: string }}
 */
export function checkAuthority(actor, target, { allowSelf = false, subject = '内容或账号' } = {}) {
  if (!actor) return { ok: false, status: 401, code: 'unauthenticated', error: '需要登录' };
  if (!target) return { ok: false, status: 404, code: 'missing', error: '目标不存在' };

  const isSelf = Number(target.id) === Number(actor.id);
  if (isSelf) {
    if (allowSelf && isSuperAdmin(actor)) return { ok: true, self: true };
    return {
      ok: false,
      status: 403,
      code: 'self',
      error: `不能处理自己的${subject}`,
    };
  }

  /* 超管对其他人没有层级限制；他自己会被上面那条挡住 */
  if (isSuperAdmin(actor)) return { ok: true, self: false };

  if (rankOf(actor) <= rankOf(target)) {
    return {
      ok: false,
      status: 403,
      code: 'rank',
      error: `不能处理${labelOf(target)}的${subject}，请联系超级管理员`,
    };
  }

  return { ok: true, self: false };
}

/*
 * 这里原本有一个 checkSelfNote（自我裁决必须写明理由），已经去掉：
 * 站点当前的政策是「自我裁决的理由一律选填」，写了就进审计日志与回执，
 * 不写也放行。将来如果要收紧，再把它加回来并接到各条 self 分支上。
 */

/**
 * 一条待办能不能出现在「我」的队列里。
 *
 * 队列里混进自己处理不了的条目，只会让人点一下弹一次错，
 * 所以列表直接过滤掉；超管自己的条目保留，但标成 self 由前端提示要写理由。
 */
export function queueFilter(actor) {
  const mine = Number(actor?.id);
  const superRank = ROLE_RANK[SUPER_ROLE];
  return (ownerId, ownerRole) => {
    if (Number(ownerId) === mine) return isSuperAdmin(actor);
    if (isSuperAdmin(actor)) return true;
    return rankOf(actor) > rankOf(ownerRole);
  };
}
