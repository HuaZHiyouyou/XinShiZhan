import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Heart, MessageSquare, Radio } from 'lucide-react';
import { api } from '@/api/client';
import type { RankingItem } from '@/api/types';
import { Avatar } from '@/components/common/Avatar';
import { Empty, SkeletonList } from '@/components/common/Empty';
import { formatCount, relativeTime } from '@/lib/format';

interface Props {
  range: 'day' | 'week' | 'month' | 'all';
  limit?: number;
  compact?: boolean;
}

const RANK_TONE = ['var(--sand)', 'var(--slate)', 'var(--sand)'];

export function RankingList({ range, limit = 10, compact = false }: Props) {
  const [items, setItems] = useState<RankingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.ranking
      .list(range, limit)
      .then(({ items: data }) => {
        if (alive) setItems(data);
      })
      .catch(() => {
        if (alive) setItems([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range, limit]);

  if (loading) return <SkeletonList rows={5} body={1} />;
  if (!items.length) return <Empty title="榜单还空着" desc="等第一件被很多人共鸣的心事" />;

  return (
    <ol className={`rank-list ${compact ? 'rank-compact' : ''}`}>
      {items.map((item) => (
        <li key={item.id} className="rank-item">
          <span
            className="rank-no mono"
            data-top={item.rank <= 3}
            style={item.rank <= 3 ? { color: RANK_TONE[item.rank - 1] } : undefined}
          >
            {String(item.rank).padStart(2, '0')}
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <Link className="rank-text clamp-2" to={`/post/${item.id}`}>
              {item.content}
            </Link>
            <div className="rank-meta">
              <Avatar name={item.author.anonName} color={item.author.anonColor} src={item.author.avatarUrl} size="sm" />
              <span className="rank-name">{item.author.anonName}</span>
              <span className="meta-dot" />
              <span>{relativeTime(item.createdAt)}</span>
            </div>
            {!compact && (
              <div className="rank-stats">
                <span>
                  <Heart size={12} />
                  {formatCount(item.likeCount)}
                </span>
                <span>
                  <MessageSquare size={12} />
                  {formatCount(item.messageCount)}
                </span>
                <span>
                  <Radio size={12} />
                  {formatCount(item.danmakuCount)}
                </span>
              </div>
            )}
          </div>
          <span className="rank-score mono" title="热度分">
            <Flame size={12} />
            {item.hotScore.toFixed(1)}
          </span>
        </li>
      ))}
    </ol>
  );
}