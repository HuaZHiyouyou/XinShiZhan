import type { DanmakuEffect, Lifecycle, ReviewStatus } from '@/api/types';

export const DANMAKU_COLORS: Record<string, { label: string; hex: string }> = {
  azure: { label: '雾蓝', hex: '#6BA3F0' },
  teal: { label: '青碧', hex: '#4FB8AE' },
  sand: { label: '暖沙', hex: '#D9A05B' },
  sage: { label: '苔绿', hex: '#8FBF7F' },
  indigo: { label: '黛蓝', hex: '#8A8FE0' },
  rose: { label: '豆沙', hex: '#D98C93' },
  slate: { label: '石青', hex: '#93A5B8' },
  amber: { label: '琥珀', hex: '#D6B45C' },
};

export const COLOR_KEYS = Object.keys(DANMAKU_COLORS);

export const EFFECT_LABELS: Record<DanmakuEffect, string> = {
  glow: '辉光',
  trace: '拖尾',
  outline: '描边',
  shimmer: '流光',
};

export const EFFECT_HINTS: Record<DanmakuEffect, string> = {
  glow: '柔和的呼吸光晕，适合安静的表达',
  trace: '带一条渐隐的尾迹，像划过夜空的痕迹',
  outline: '空心描边字，适合堆叠在明亮背景上',
  shimmer: '文字上流动的高光，情绪更外放',
};

export function colorHex(key: string): string {
  return DANMAKU_COLORS[key]?.hex || DANMAKU_COLORS.azure.hex;
}

export function colorLabel(key: string): string {
  return DANMAKU_COLORS[key]?.label || '雾蓝';
}

export const MOODS: { value: string; label: string; token: string }[] = [
  { value: 'plain', label: '平常', token: 'slate' },
  { value: 'calm', label: '平静', token: 'teal' },
  { value: 'warm', label: '温暖', token: 'sand' },
  { value: 'hopeful', label: '期待', token: 'sage' },
  { value: 'tired', label: '疲惫', token: 'indigo' },
  { value: 'anxious', label: '焦虑', token: 'amber' },
  { value: 'lonely', label: '孤独', token: 'azure' },
];

export function moodMeta(value: string) {
  return MOODS.find((m) => m.value === value) || MOODS[0];
}

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: '待审核',
  published: '已发布',
  manual_review: '待人工复核',
  rejected: '未通过',
};

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  draft: '未上线',
  scheduled: '定时待发',
  live: '已上线',
  expired: '已过期',
};

export const REPORT_REASONS = ['广告引流', '人身攻击', '涉及隐私', '虚假信息', '其他'];

export const TAGS = [
  '深夜', '独处', '家人', '工作', '朋友', '城市', '自我', '日常',
  '治愈', '回忆', '陌生人', '健康', '猫', '考试', '恋爱',
];