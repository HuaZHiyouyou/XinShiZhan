import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, MessageSquareText, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { api } from '@/api/client';
import type { DanmakuItem, Overview as OverviewData } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { Empty, SkeletonList, SkeletonStats } from '@/components/common/Empty';
import { RankingList } from '@/components/ranking/RankingList';
import { EFFECT_LABELS, colorHex, colorLabel } from '@/lib/constants';
import { formatCount, relativeTime } from '@/lib/format';
import { useAuth } from '@/store/auth';

export function Overview() {
  const user = useAuth((s) => s.user);

  const [stats, setStats] = useState<OverviewData | null>(null);
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([api.ranking.overview(), api.danmaku.list({ limit: 24 })])
      .then(([overview, list]) => {
        if (!alive) return;
        setStats(overview);
        setDanmaku(list.danmaku.filter((item) => item.mode !== 'bubble'));
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user?.id]);

  const cards = [
    { key: 'post', label: '心事总数', value: stats?.postCount ?? 0, icon: Sparkles, tone: 'primary' },
    { key: 'danmaku', label: '弹幕总数', value: stats?.danmakuCount ?? 0, icon: MessageSquareText, tone: 'teal' },
    { key: 'user', label: '在册住客', value: stats?.userCount ?? 0, icon: Users, tone: 'sand' },
    { key: 'pending', label: '待审内容', value: stats?.pending ?? 0, icon: ShieldCheck, tone: 'slate' },
  ];

  return (
    <div className="overview-layout">
      <div className="page-head">
        <h1 className="page-title">站内概览</h1>
        <p className="page-desc">这里汇总了站内的整体动静，以及此刻正在被共鸣的内容</p>
      </div>

      {loading ? (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <SkeletonStats count={4} />
          <SkeletonList rows={3} body={1} />
        </div>
      ) : (
        <>
          <section className="stat-grid">
            {cards.map((card) => (
              <div key={card.key} className="card stat-card" data-tone={card.tone}>
                <span className="stat-icon">
                  <card.icon size={18} strokeWidth={1.75} />
                </span>
                <span className="stat-label">{card.label}</span>
                <span className="stat-value mono">{formatCount(card.value)}</span>
              </div>
            ))}
          </section>

          <div className="overview-grid">
            <section className="card">
              <div className="card-head">
                <div className="card-title">
                  <Flame size={15} />
                  热度榜
                  <span className="card-sub">近 7 天</span>
                </div>
                <Link className="btn btn-sm btn-ghost" to="/ranking">
                  完整榜单
                </Link>
              </div>
              <div className="card-pad" style={{ paddingTop: 'var(--sp-3)' }}>
                <RankingList range="week" limit={8} />
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <div className="card-title">
                  <MessageSquareText size={15} />
                  最新弹幕
                  <span className="card-sub">刚刚飞过的心事</span>
                </div>
              </div>
              <div className="card-pad dm-feed">
                {danmaku.length === 0 ? (
                  <Empty title="还没有弹幕经过" desc="去广场发射第一条吧" />
                ) : (
                  danmaku.map((item) => (
                    <div key={item.id} className="dm-feed-item">
                      <span
                        className="dm-feed-dot"
                        style={{ color: colorHex(item.color) }}
                        title={`${colorLabel(item.color)} · ${EFFECT_LABELS[item.effect]}`}
                      />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="dm-feed-text" style={{ color: colorHex(item.color) }}>
                          {item.content}
                        </div>
                        <div className="dm-feed-meta">
                          <Avatar name={item.author.anonName} color={item.author.anonColor} src={item.author.avatarUrl} size="sm" />
                          <span className="rank-name">{item.author.anonName}</span>
                          <span className="meta-dot" />
                          <span>{relativeTime(item.createdAt)}</span>
                          {item.postId && (
                            <>
                              <span className="meta-dot" />
                              <Link className="dm-feed-link" to={`/post/${item.postId}`}>
                                来自某件心事
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}