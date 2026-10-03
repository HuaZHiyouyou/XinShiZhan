import type { CSSProperties, ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface Props {
  title?: string;
  desc?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function Empty({ title = '这里还很安静', desc, action, icon }: Props) {
  return (
    <div className="empty">
      {icon || <Inbox size={26} />}
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{title}</div>
      {desc && <div style={{ fontSize: 12 }}>{desc}</div>}
      {action}
    </div>
  );
}

/**
 * 骨架屏的逐条延迟。
 *
 * 封顶到 8 条：长列表第 40 条不该等两秒才出现，那样「加载感」会变成「卡顿感」。
 */
function stagger(index: number): CSSProperties {
  return { '--i': Math.min(index, 8) } as CSSProperties;
}

interface SkeletonListProps {
  rows?: number;
  /** 左侧是否留一个圆形头像位 */
  avatar?: boolean;
  /** 每行正文的行数 */
  body?: number;
  /** 行首右侧是否留一个短标签位 */
  sub?: boolean;
}

/**
 * 列表骨架。
 *
 * 用它而不是转圈：位置和最终内容一致，数据到位时是「填进去」而不是「换一屏」，
 * 视觉上不会跳。
 */
export function SkeletonList({ rows = 4, avatar = true, body = 2, sub = true }: SkeletonListProps) {
  return (
    <div className="card stagger" aria-busy="true" aria-label="正在加载">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sk-row" style={stagger(i)}>
          {avatar && <div className="skeleton sk-avatar" />}
          <div className="grow stack" style={{ gap: 8, minWidth: 0 }}>
            <div className="row-between">
              <div className="skeleton sk-title" />
              {sub && <div className="skeleton sk-sub" />}
            </div>
            {Array.from({ length: body }).map((__, j) => (
              <div key={j} className={`skeleton sk-body${j > 0 ? ' sk-body-short' : ''}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 数据看板一类的指标卡骨架 */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="sk-grid stagger" aria-busy="true" aria-label="正在加载">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sk-stat" style={stagger(i)}>
          <div className="skeleton sk-stat-value" />
          <div className="skeleton sk-stat-label" />
        </div>
      ))}
    </div>
  );
}

/** 心事详情页的骨架：标题 + 若干正文行 + 一行操作 */
export function SkeletonArticle() {
  return (
    <div className="sk-page" aria-busy="true" aria-label="正在加载">
      <div className="card card-pad stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <div className="skeleton sk-avatar" />
          <div className="grow stack" style={{ gap: 8, minWidth: 0 }}>
            <div className="skeleton sk-title" />
            <div className="skeleton sk-sub" />
          </div>
        </div>
        <div className="skeleton sk-body" style={{ height: 15 }} />
        <div className="skeleton sk-body" style={{ height: 15 }} />
        <div className="skeleton sk-body sk-body-short" style={{ height: 15 }} />
        <div className="skeleton" style={{ height: 140, borderRadius: 'var(--r-md)' }} />
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <div className="skeleton" style={{ height: 26, width: 64, borderRadius: 999 }} />
          <div className="skeleton" style={{ height: 26, width: 64, borderRadius: 999 }} />
          <div className="skeleton" style={{ height: 26, width: 64, borderRadius: 999 }} />
        </div>
      </div>
    </div>
  );
}

/** 留言/评论区的紧凑骨架：没有卡片外框与头像列的一部分 */
export function SkeletonThread({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stagger" aria-busy="true" aria-label="正在加载留言">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sk-row" style={{ ...stagger(i), padding: 'var(--sp-3) 0' }}>
          <div className="skeleton sk-avatar" style={{ width: 32, height: 32 }} />
          <div className="grow stack" style={{ gap: 8, minWidth: 0 }}>
            <div className="skeleton sk-sub" style={{ width: '28%' }} />
            <div className="skeleton sk-body" />
            <div className="skeleton sk-body sk-body-short" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PostSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="stack stagger">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card card-pad stack" style={stagger(i)}>
          <div className="row">
            <div className="skeleton sk-avatar" />
            <div className="grow stack" style={{ gap: 6 }}>
              <div className="skeleton" style={{ width: 120, height: 12 }} />
              <div className="skeleton" style={{ width: 72, height: 10 }} />
            </div>
          </div>
          <div className="skeleton sk-body" style={{ height: 14 }} />
          <div className="skeleton sk-body sk-body-short" style={{ height: 14 }} />
        </div>
      ))}
    </div>
  );
}

/** 极短的操作（按钮内、局部刷新）仍然用转圈，比骨架更轻 */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 'var(--sp-6)', color: 'var(--text-faint)' }}>
      <span className="spinner" />
      {label && <span style={{ fontSize: 12 }}>{label}</span>}
    </div>
  );
}
