/**
 * 密码强度评估。
 *
 * 定位是「建议」而不是「门禁」：
 * - 服务端只拦最小长度，任何达到长度底线的密码都能注册成功；
 * - 这里给出强度分级与改进建议，让愿意听劝的人把密码变得更安全，
 *   而不是用一堆规则把普通用户挡在门外。
 */

export type StrengthLevel = 'empty' | 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordAssessment {
  level: StrengthLevel;
  label: string;
  /** 0-100，用于进度条宽度 */
  percent: number;
  /** 未达标的改进建议，按重要性排序；为空表示当前密码已经不错 */
  suggestions: string[];
  /** 是否达到站点最小长度这一硬性底线 */
  meetsMinimum: boolean;
  /** 是否命中常见弱口令清单 */
  isCommon: boolean;
}

/** 常见弱口令：命中时强烈建议更换，但不阻止注册 */
const COMMON_PASSWORDS = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '111111',
  '000000',
  '888888',
  '666666',
  'password',
  'password1',
  'passw0rd',
  'qwerty',
  'qwerty123',
  'abc123',
  'abc123456',
  'a123456',
  'iloveyou',
  'admin',
  'admin123',
  'admin888',
  'woaini520',
  'woaini1314',
  'zxcvbnm',
  'asdfgh',
  'asdfghjkl',
  'letmein',
  'welcome',
  'monkey',
  'dragon',
]);

/** 连续键盘/字母序列，命中说明是「顺手敲的」 */
const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const LABELS: Record<StrengthLevel, string> = {
  empty: '',
  weak: '偏弱',
  fair: '一般',
  good: '不错',
  strong: '很强',
};

function hasSequence(lowered: string) {
  if (lowered.length < 5) return false;
  return SEQUENCES.some((seq) => {
    for (let i = 0; i + 5 <= seq.length; i += 1) {
      const chunk = seq.slice(i, i + 5);
      if (lowered.includes(chunk) || lowered.includes([...chunk].reverse().join(''))) return true;
    }
    return false;
  });
}

function hasRepeat(lowered: string) {
  return /(.)\1{3,}/.test(lowered);
}

export function assessPassword(
  password: string,
  { minLength = 6, username = '' }: { minLength?: number; username?: string } = {}
): PasswordAssessment {
  const value = String(password || '');

  if (!value) {
    return { level: 'empty', label: '', percent: 0, suggestions: [], meetsMinimum: false, isCommon: false };
  }

  const lowered = value.toLowerCase();
  const meetsMinimum = value.length >= minLength;
  const isCommon = COMMON_PASSWORDS.has(lowered);

  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);
  const mixedCase = hasLower && hasUpper;

  const relatedToUsername =
    username.length >= 3 && (lowered.includes(username.toLowerCase()) || username.toLowerCase().includes(lowered));
  const sequenced = hasSequence(lowered);
  const repeated = hasRepeat(lowered);

  /* 长度是收益最高的一维，权重最大 */
  let score = 0;
  if (meetsMinimum) score += 1;
  if (value.length >= 10) score += 1;
  if (value.length >= 14) score += 1;
  if (mixedCase) score += 1;
  if (hasDigit) score += 1;
  if (hasSymbol) score += 1;

  if (relatedToUsername) score -= 1;
  if (sequenced || repeated) score -= 1;
  if (isCommon) score = Math.min(score, 1);
  if (!meetsMinimum) score = Math.min(score, 0);
  score = Math.max(0, Math.min(6, score));

  const level: StrengthLevel = score <= 2 ? 'weak' : score <= 4 ? 'fair' : score === 5 ? 'good' : 'strong';

  const suggestions: string[] = [];
  if (!meetsMinimum) suggestions.push(`至少需要 ${minLength} 位，这是本站的硬性要求`);
  if (isCommon) suggestions.push('这是高频弱口令，强烈建议换一个');
  if (relatedToUsername) suggestions.push('密码里包含用户名，容易被猜出来');
  if (value.length < 12) suggestions.push('再加长一些，12 位以上会安全很多');
  if (!mixedCase) suggestions.push('混入大写字母（A-Z）');
  if (!hasDigit) suggestions.push('混入数字（0-9）');
  if (!hasSymbol) suggestions.push('混入符号（如 ! @ #￥ %）');
  if (sequenced) suggestions.push('避免连续字母或键盘顺序（如 qwerty、12345）');
  if (repeated) suggestions.push('避免连续重复同一个字符');

  /* 强度高时保留前两条「锦上添花」的建议，弱时全部展示 */
  const shown = level === 'strong' || level === 'good' ? suggestions.slice(0, 2) : suggestions.slice(0, 4);

  return {
    level,
    label: LABELS[level],
    percent: Math.round((score / 6) * 100),
    suggestions: shown,
    meetsMinimum,
    isCommon,
  };
}
