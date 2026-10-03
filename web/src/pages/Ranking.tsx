import { useState } from 'react';
import { Flame, Info } from 'lucide-react';
import { RankingList } from '@/components/ranking/RankingList';

const RANGES = [
  { value: 'day', label: '今日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'all', label: '总榜' },
] as const;

export function Ranking() {
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('week');

  return (
    <div className="ranking-layout">
      <div className="page-head">
        <h1 className="page-title">热度榜</h1>
        <p className="page-desc">热度由共鸣、回应与弹幕共同计算，越新的心事权重越高</p>
      </div>

      <div className="feed-toolbar">
        <div className="segmented">
          {RANGES.map((item) => (
            <button
              key={item.value}
              type="button"
              data-active={range === item.value}
              onClick={() => setRange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ranking-grid">
        <section className="card">
          <div className="card-head">
            <div className="card-title">
              <Flame size={15} />
              榜单
              <span className="card-sub">前 20 件心事</span>
            </div>
          </div>
          <div className="card-pad">
            <RankingList range={range} limit={20} />
          </div>
        </section>

        <aside className="card card-pad algo-card">
          <div className="section-title">
            <Info size={14} />
            热度怎么算
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            每件心事的分数由互动量加权后，再除以时间的衰减因子得到。刚发布的内容更容易被看见，久置的内容会自然下沉。
          </p>
          <ul className="algo-list">
            <li>
              <span>共鸣（点赞）</span>
              <span className="mono">×3</span>
            </li>
            <li>
              <span>留言</span>
              <span className="mono">×2</span>
            </li>
            <li>
              <span>弹幕</span>
              <span className="mono">×1.5</span>
            </li>
            <li>
              <span>浏览</span>
              <span className="mono">×0.2</span>
            </li>
          </ul>
          <div className="hint">时间衰减：分数 ÷ (发布小时数 + 2) ^ 1.5</div>
        </aside>
      </div>
    </div>
  );
}