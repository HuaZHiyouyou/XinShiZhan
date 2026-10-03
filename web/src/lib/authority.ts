/**
 * 前端侧的角色层级判定。
 *
 * 只是「别让人点了才被拒」的预判，**真正的裁决在服务端**（lib/permissions.js）。
 * 两边共用同一套等级定义，改了这里别忘了那边。
 */
export const ROLE_RANK: Record<string, number> = {
  superadmin: 3,
  admin: 2,
  reviewer: 1,
  user: 0,
  guest: 0,
};

export const ROLE_LABEL: Record<string, string> = {
  superadmin: '超级管理员',
  admin: '管理员',
  reviewer: '审核员',
  user: '住客',
  guest: '访客',
};

export const SELF_NOTE_MIN = 4;

interface Who {
  id: number;
  role?: string;
  anonName?: string;
  username?: string;
}

/**
 * 我能不能处理这个人。
 * 超管对自己走「自我裁决」（可以，理由选填），其余人对自己是完全不能碰。
 */
export function canHandle(me: Who | null, target: Who | null): boolean {
  if (!me || !target) return false;
  if (me.id === target.id) return me.role === 'superadmin';
  if (me.role === 'superadmin') return true;
  return (ROLE_RANK[me.role || 'user'] ?? 0) > (ROLE_RANK[target.role || 'user'] ?? 0);
}

/** 不能处理时，给出人话解释；能处理就返回空字符串 */
export function authorityHint(me: Who | null, target: Who | null, subject = '内容或账号'): string {
  if (!me || !target) return '';
  if (me.id === target.id) {
    return me.role === 'superadmin'
      ? `这是你自己的${subject}，只能由你自行裁决`
      : `不能处理自己的${subject}`;
  }
  if (me.role === 'superadmin') return '';
  if ((ROLE_RANK[me.role || 'user'] ?? 0) > (ROLE_RANK[target.role || 'user'] ?? 0)) return '';
  return `不能处理${ROLE_LABEL[target.role || 'user'] || '该账号'}的${subject}，请联系超级管理员`;
}
