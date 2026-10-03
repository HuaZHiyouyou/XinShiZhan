import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Select } from '@/components/common/Select';

interface Props {
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  align?: 'start' | 'end';
  className?: string;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const hour = String(i).padStart(2, '0');
  return { value: hour, label: `${hour} 时` };
});

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => {
  const minute = String(i).padStart(2, '0');
  return { value: minute, label: `${minute} 分` };
});

interface Parts {
  y: number;
  m: number;
  d: number;
  hh: string;
  mm: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 解析原生格式：yyyy-MM-dd 或 yyyy-MM-ddTHH:mm */
function parseParts(value: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!match) return null;
  return {
    y: Number(match[1]),
    m: Number(match[2]),
    d: Number(match[3]),
    hh: match[4] ?? '00',
    mm: match[5] ?? '00',
  };
}

function serialize(parts: Parts, withTime: boolean): string {
  const date = `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;
  return withTime ? `${date}T${parts.hh}:${parts.mm}` : date;
}

export function DatePicker({
  value,
  onChange,
  withTime = false,
  placeholder = '选择日期',
  ariaLabel,
  align = 'start',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [view, setView] = useState({ y: 0, m: 1 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = parseParts(value);
  const now = new Date();
  const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };

  const panelWidth = withTime ? 296 : 264;
  const panelHeight = withTime ? 372 : 344;

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rawLeft = align === 'end' ? rect.right - panelWidth : rect.left;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - panelWidth - 8));
    let top = rect.bottom + 6;
    if (top + panelHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - panelHeight - 6);
    }
    setPos({ top, left });
  }, [align, panelHeight, panelWidth]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }

    const base = parseParts(value);
    setView(base ? { y: base.y, m: base.m } : { y: now.getFullYear(), m: now.getMonth() + 1 });
    place();

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // 仅在展开时同步视图到当前值，展开后翻月不应被 value 变化打断
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, place]);

  const cells = useMemo(() => {
    const lead = (new Date(view.y, view.m - 1, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(view.y, view.m, 0).getDate();
    const prevMonthDays = new Date(view.y, view.m - 1, 0).getDate();
    const prev = view.m === 1 ? { y: view.y - 1, m: 12 } : { y: view.y, m: view.m - 1 };
    const next = view.m === 12 ? { y: view.y + 1, m: 1 } : { y: view.y, m: view.m + 1 };

    const list: { y: number; m: number; d: number; outside: boolean }[] = [];
    for (let i = lead - 1; i >= 0; i -= 1) {
      list.push({ ...prev, d: prevMonthDays - i, outside: true });
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      list.push({ y: view.y, m: view.m, d, outside: false });
    }
    let d = 1;
    while (list.length < 42) {
      list.push({ ...next, d, outside: true });
      d += 1;
    }
    return list;
  }, [view]);

  const pick = (y: number, m: number, d: number) => {
    onChange(serialize({ y, m, d, hh: selected?.hh ?? '00', mm: selected?.mm ?? '00' }, withTime));
    setView({ y, m });
    if (!withTime) setOpen(false);
  };

  const setTime = (key: 'hh' | 'mm', next: string) => {
    const base = selected ?? { y: today.y, m: today.m, d: today.d, hh: '00', mm: '00' };
    onChange(serialize({ ...base, [key]: next }, withTime));
  };

  const display = selected
    ? `${selected.y}-${pad(selected.m)}-${pad(selected.d)}${withTime ? ` ${selected.hh}:${selected.mm}` : ''}`
    : '';

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`date-picker-trigger ${className}`.trim()}
        data-open={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <Calendar className="date-picker-icon" size={14} />
        <span className="date-picker-value" data-empty={!display}>
          {display || placeholder}
        </span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={panelRef}
              className="date-picker-panel"
              role="dialog"
              aria-label={ariaLabel ?? '选择日期'}
              style={{ top: pos.top, left: pos.left, width: panelWidth }}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            >
              <div className="date-picker-head">
                <button
                  type="button"
                  className="date-picker-nav"
                  aria-label="上个月"
                  onClick={() =>
                    setView((v) => (v.m === 1 ? { y: v.y - 1, m: 12 } : { y: v.y, m: v.m - 1 }))
                  }
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="date-picker-title">
                  {view.y} 年 {view.m} 月
                </span>
                <button
                  type="button"
                  className="date-picker-nav"
                  aria-label="下个月"
                  onClick={() =>
                    setView((v) => (v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 }))
                  }
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              <div className="date-picker-weekdays">
                {WEEKDAYS.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>

              <div className="date-picker-grid">
                {cells.map((cell) => (
                  <button
                    key={`${cell.y}-${cell.m}-${cell.d}`}
                    type="button"
                    className="date-picker-day"
                    data-outside={cell.outside}
                    data-today={cell.y === today.y && cell.m === today.m && cell.d === today.d}
                    data-selected={
                      !!selected && selected.y === cell.y && selected.m === cell.m && selected.d === cell.d
                    }
                    aria-label={`${cell.y} 年 ${cell.m} 月 ${cell.d} 日`}
                    onClick={() => pick(cell.y, cell.m, cell.d)}
                  >
                    {cell.d}
                  </button>
                ))}
              </div>

              {withTime && (
                <div className="date-picker-time">
                  <span className="date-picker-time-label">时间</span>
                  <Select
                    size="sm"
                    value={selected?.hh ?? '00'}
                    options={HOUR_OPTIONS}
                    ariaLabel="选择小时"
                    onChange={(next) => setTime('hh', next)}
                  />
                  <Select
                    size="sm"
                    value={selected?.mm ?? '00'}
                    options={MINUTE_OPTIONS}
                    ariaLabel="选择分钟"
                    onChange={(next) => setTime('mm', next)}
                  />
                </div>
              )}

              <div className="date-picker-foot">
                <button type="button" className="date-picker-action" onClick={() => { onChange(''); setOpen(false); }}>
                  清除
                </button>
                <button
                  type="button"
                  className="date-picker-action date-picker-action-primary"
                  onClick={() => pick(today.y, today.m, today.d)}
                >
                  今天
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}