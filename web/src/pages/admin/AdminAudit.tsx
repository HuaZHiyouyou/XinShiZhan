import { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { AuditLogItem } from '@/api/types';
import { Empty, SkeletonList } from '@/components/common/Empty';
import { formatDateTime, relativeTime } from '@/lib/format';
import { useUi } from '@/store/ui';

const ACTION_LABEL: Record<string, string> = {
  'post.create': '发布心事',
  'post.update': '修改心事',
  'post.delete': '删除心事',
  'post.report': '举报心事',
  'message.create': '发表留言',
  'danmaku.create': '发送弹幕',
  'review.approve': '审批通过',
  'review.reject': '审批驳回',
  'user.ban': '封禁账号',
  'user.unban': '解除封禁',
  'user.role': '变更角色',
  'rules.update': '更新审核规则',
  'admin.post.update': '后台调整内容',
  'report.remove': '删除被举报内容',
  'report.dismiss': '忽略举报',
  'music.upload': '上传曲目',
  'music.update': '调整曲目',
  'music.delete': '删除曲目',
  'guest.login': '访客进入',
  'site_config.update': '更新站点配置',
  'avatar.approve': '头像审核通过',
  'avatar.reject': '头像审核驳回',
};

const ACTION_TONE: Record<string, string> = {
  'review.approve': 'tag-success',
  'review.reject': 'tag-danger',
  'user.ban': 'tag-danger',
  'user.unban': 'tag-teal',
  'rules.update': 'tag-sand',
  'guest.login': 'tag-teal',
  'site_config.update': 'tag-sand',
  'avatar.approve': 'tag-success',
  'avatar.reject': 'tag-danger',
};

const TARGET_LABEL: Record<string, string> = {
  post: '心事',
  user: '用户',
  message: '留言',
  danmaku: '弹幕',
  settings: '审核规则',
  music_track: '曲目',
  report: '举报',
};

const DETAIL_KEY_LABEL: Record<string, string> = {
  content: '正文',
  pinned: '置顶',
  visibility: '可见性',
  reviewStatus: '审核状态',
  review: '审核结果',
  publishAt: '上线时间',
  expiresAt: '下架时间',
  contentChanged: '正文变更',
  reason: '原因',
  until: '封禁至',
  role: '角色',
  flags: '命中规则',
  lifecycle: '生命周期',
  byStaff: '操作者',
  postId: '所属心事',
  parentId: '上级留言',
  reportId: '举报单',
  title: '标题',
  artist: '歌手',
  sortOrder: '排序',
  enabled: '启用',
  blockWords: '黑名单词',
  softWords: '需复核词',
  autoReviewEnabled: '自动审核',
  linkNeedsReview: '链接需复核',
  newUserNeedsReview: '新用户需复核',
  newUserDays: '新用户天数',
  maxPostsPerHour: '每小时发布上限',
  maxMessagesPerHour: '每小时留言上限',
  maxDanmakuPerMinute: '每分钟弹幕上限',
  duplicateNeedsReview: '重复内容需复核',
  duplicateThreshold: '重复判定阈值',
  autoApproveDanmaku: '弹幕自动放行',
  autoApproveMessages: '留言自动放行',
  imageNeedsReview: '带图需复核',
  hotWeights: '热度权重',
  hotDecay: '热度衰减',
};

const VALUE_LABEL: Record<string, string> = {
  public: '公开',
  private: '仅自己可见',
  published: '已发布',
  pending: '待审核',
  manual_review: '待人工复核',
  rejected: '已驳回',
  approved: '已通过',
  live: '展示中',
  scheduled: '定时待发',
  draft: '未发布',
  expired: '已过期',
  admin: '管理员',
  reviewer: '审核员',
  user: '住客',
  guest: '访客',
  active: '正常',
  banned: '已封禁',
};

const TIME_KEYS = new Set(['publishAt', 'expiresAt']);
const ID_KEYS = new Set(['postId', 'parentId', 'reportId']);

const WEIGHT_LABEL: Record<string, string> = {
  like: '共鸣',
  message: '留言',
  danmaku: '弹幕',
  view: '浏览',
};

function formatValue(key: string, value: unknown): string {
  if (key === 'until') return value ? formatDateTime(String(value)) : '永久';
  if (key === 'byStaff') return value ? '管理员' : '作者本人';
  if (key === 'pinned') return value ? '已置顶' : '未置顶';
  if (key === 'contentChanged') return value ? '已修改' : '未修改';
  if (typeof value === 'boolean') return value ? '开启' : '关闭';
  if (TIME_KEYS.has(key)) return formatDateTime(String(value));
  if (ID_KEYS.has(key)) return `#${String(value)}`;
  if (key === 'content') {
    const text = String(value);
    return text.length > 24 ? `${text.slice(0, 24)}…` : text;
  }
  if (key === 'hotWeights' && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([item, weight]) => `${WEIGHT_LABEL[item] ?? item} ${String(weight)}`)
      .join('、');
  }
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => formatValue('', item)).join('、') : '（无）';
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return VALUE_LABEL[text] ?? text;
}

function describeDetail(detail: Record<string, unknown>): string {
  const entries = Object.entries(detail).filter(
    ([key, value]) => key === 'until' || (value !== null && value !== undefined && value !== '')
  );
  if (!entries.length) return '';

  // 正文可能很长，放到最后，避免挤掉其他字段
  entries.sort(([a], [b]) => Number(b === 'content') - Number(a === 'content'));

  return entries
    .map(([key, value]) => `${DETAIL_KEY_LABEL[key] ?? key}：${formatValue(key, value)}`)
    .join(' · ')
    .slice(0, 160);
}

export function AdminAudit() {
  const notify = useUi((s) => s.notify);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.admin
      .audit(100)
      .then(({ logs: data }) => {
        if (alive) setLogs(data);
      })
      .catch((error: unknown) => {
        if (alive) notify(error instanceof ApiError ? error.message : '日志加载失败', 'danger');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  if (loading) return <SkeletonList rows={6} body={1} />;

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <ScrollText size={15} />
          操作日志
          <span className="card-sub">最近 100 条，包含自动审核与人工操作</span>
        </div>
      </div>

      {logs.length === 0 ? (
        <Empty title="还没有日志" />
      ) : (
        <div className="audit-list">
          {logs.map((log) => (
            <article key={log.id} className="audit-row">
              <span className={`tag ${ACTION_TONE[log.action] || ''}`}>
                {ACTION_LABEL[log.action] || log.action}
              </span>
              <span className="audit-actor">{log.actorName}</span>
              <span className="faint audit-target">
                {TARGET_LABEL[log.targetType] ?? log.targetType}
                {log.targetId ? ` #${log.targetId}` : ''}
              </span>
              <span className="grow audit-detail">{describeDetail(log.detail)}</span>
              <span className="faint audit-time" title={formatDateTime(log.createdAt)}>
                {relativeTime(log.createdAt)}
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}