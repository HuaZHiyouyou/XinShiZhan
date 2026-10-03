import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, CalendarClock, FileText, ImagePlus, LifeBuoy, Radio, ShieldCheck, Timer, UserPlus, Users } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { AdminStats } from '@/api/types';
import { SkeletonStats } from '@/components/common/Empty';
import { useUi } from '@/store/ui';

export function AdminDashboard() {
  const notify = useUi((s) => s.notify);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.admin
      .stats()
      .then((data) => {
        if (alive) setStats(data);
      })
      .catch((error: unknown) => {
        if (alive) notify(error instanceof ApiError ? error.message : '看板加载失败', 'danger');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  if (loading) return <SkeletonStats count={8} />;
  if (!stats) return null;

  const cards = [
    { label: '待审批总量', value: stats.pendingTotal, icon: ShieldCheck, to: '/admin/review', tone: 'var(--sand)' },
    { label: '今日发布', value: stats.publishedToday, icon: FileText, tone: 'var(--primary)' },
    { label: '今日新增住客', value: stats.newUsersToday, icon: UserPlus, tone: 'var(--teal)' },
    { label: '今日驳回', value: stats.autoRejectedToday, icon: AlertTriangle, tone: 'var(--danger)' },
    { label: '未处理举报', value: stats.openReports, icon: AlertTriangle, to: '/admin/review', tone: 'var(--warning)' },
    { label: '封禁账号', value: stats.bannedUsers, icon: Users, to: '/admin/users', tone: 'var(--rose)' },
    { label: '在线心事', value: stats.livePosts, icon: Activity, tone: 'var(--sage)' },
    { label: '定时待发', value: stats.scheduledPosts, icon: CalendarClock, tone: 'var(--indigo)' },
    { label: '已过期', value: stats.expiredPosts, icon: Timer, tone: 'var(--slate)' },
  ];

  const maxTrend = Math.max(1, ...stats.trend.map((d) => Math.max(d.posts, d.danmaku)));

  return (
    <div className="stack">
      <div className="stat-grid">
        {cards.map((card) => {
          const body = (
            <>
              <span className="stat-icon" style={{ color: card.tone }}>
                <card.icon size={18} strokeWidth={1.75} />
              </span>
              <span className="stat-value mono">{card.value}</span>
              <span className="stat-label">{card.label}</span>
            </>
          );
          return card.to ? (
            <Link key={card.label} className="card stat-card" to={card.to}>
              {body}
            </Link>
          ) : (
            <div key={card.label} className="card stat-card">
              {body}
            </div>
          );
        })}
      </div>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <Activity size={15} />
            近 7 天内容走势
            <span className="card-sub">心事与弹幕的每日新增</span>
          </div>
          <div className="row" style={{ gap: 'var(--sp-3)' }}>
            <span className="legend">
              <span className="legend-dot" style={{ background: 'var(--primary)' }} />
              心事
            </span>
            <span className="legend">
              <span className="legend-dot" style={{ background: 'var(--teal)' }} />
              弹幕
            </span>
          </div>
        </div>
        <div className="card-pad">
          <div className="trend-chart">
            {stats.trend.map((day) => (
              <div key={day.day} className="trend-col">
                <div className="trend-bars">
                  <span
                    className="trend-bar"
                    style={{ height: `${(day.posts / maxTrend) * 100}%`, background: 'var(--primary)' }}
                    title={`心事 ${day.posts}`}
                  />
                  <span
                    className="trend-bar"
                    style={{ height: `${(day.danmaku / maxTrend) * 100}%`, background: 'var(--teal)' }}
                    title={`弹幕 ${day.danmaku}`}
                  />
                </div>
                <span className="trend-day mono">{day.day.slice(5)}</span>
              </div>
            ))}
            {stats.trend.length === 0 && <div className="empty">最近 7 天还没有数据</div>}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <ShieldCheck size={15} />
            待审批分布
          </div>
          <Link className="btn btn-sm btn-primary" to="/admin/review">
            进入审批台
          </Link>
        </div>
        <div className="card-pad pending-grid">
          <div className="pending-cell">
            <span className="pending-no mono">{stats.pending.post}</span>
            <span className="pending-label">
              <FileText size={13} />
              心事
            </span>
          </div>
          <div className="pending-cell">
            <span className="pending-no mono">{stats.pending.message}</span>
            <span className="pending-label">
              <Radio size={13} />
              留言
            </span>
          </div>
          <div className="pending-cell">
            <span className="pending-no mono">{stats.pending.danmaku}</span>
            <span className="pending-label">
              <Radio size={13} />
              弹幕
            </span>
          </div>
          <div className="pending-cell">
            <span className="pending-no mono">{stats.pending.avatar}</span>
            <span className="pending-label">
              <ImagePlus size={13} />
              头像
            </span>
          </div>
          <div className="pending-cell">
            <span className="pending-no mono">{stats.pending.recovery}</span>
            <span className="pending-label">
              <LifeBuoy size={13} />
              找回申请
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}