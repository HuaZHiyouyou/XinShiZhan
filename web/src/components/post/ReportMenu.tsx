import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Send } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { REPORT_REASONS } from '@/lib/constants';
import { useInteractionGate } from '@/lib/useInteractionGate';
import { useUi } from '@/store/ui';

interface Props {
  targetType: 'post' | 'message';
  targetId: number;
  compact?: boolean;
}

const DETAIL_MAX = 200;
const PANEL_WIDTH = 300;
const GAP = 8;
const MARGIN = 12;
/** 低于这个高度就认为「下方放不下」，宁可往上翻 */
const MIN_ROOM = 320;

interface Placement {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * 举报菜单。
 *
 * 先选原因，再（可选）补一段描述，最后提交 —— 不再是点一下就发出去：
 * 「为什么举报」这件事，值班的人需要一点上下文才能判断，
 * 举报人也需要一个地方把话说完。
 *
 * 面板用 createPortal 挂到 body 上，而不是留在卡片里：
 * 卡片在入场动画、悬停抬升时会带上 transform，从而**新建一个层叠上下文**，
 * 里面的浮层再怎么设 z-index 也压不过后面那些卡片 ——
 * 表现出来就是「菜单被下面那张卡片切掉一截」「能透看到后面的内容」。
 * 挂到 body 之后，定位改用 fixed + 实时量取按钮坐标，谁也别想再夹住它。
 */
export function ReportMenu({ targetType, targetId, compact = false }: Props) {
  const notify = useUi((s) => s.notify);
  const { allow } = useInteractionGate();
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const reset = useCallback(() => {
    setOpen(false);
    setReason('');
    setDetail('');
  }, []);

  /** 贴着按钮定位：下方空间不够就往上翻，左右也不许越出视口 */
  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(window.innerWidth - PANEL_WIDTH - MARGIN, rect.right - PANEL_WIDTH));
    const below = window.innerHeight - rect.bottom - GAP - MARGIN;
    const above = rect.top - GAP - MARGIN;

    if (below >= MIN_ROOM || below >= above) {
      setPlacement({ left, top: rect.bottom + GAP, maxHeight: Math.max(200, below) });
    } else {
      /* 往上翻时用 bottom 定位，不必先知道面板有多高 */
      setPlacement({ left, bottom: window.innerHeight - rect.top + GAP, maxHeight: Math.max(200, above) });
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setPlacement(null);
      return undefined;
    }
    place();
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      reset();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
    };
    /* 滚动/缩放时跟着按钮走，而不是自作主张关掉 */
    const sync = () => place();
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    };
  }, [open, place, reset]);

  const send = async () => {
    if (!reason) {
      notify('请先选择举报原因', 'info');
      return;
    }
    setBusy(true);
    try {
      const text = detail.trim();
      if (targetType === 'post') await api.posts.report(targetId, reason, text);
      else await api.messages.report(targetId, reason, text);
      notify('举报已提交，值班的人会尽快查看并给你回执', 'success');
      reset();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '举报失败', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const panel = (
    <div
      ref={panelRef}
      className="dropdown dropdown-report dropdown-fixed"
      style={{ left: placement?.left, top: placement?.top, bottom: placement?.bottom, maxHeight: placement?.maxHeight }}
      role="dialog"
      aria-label="举报"
    >
      <div className="dropdown-head">
        <span className="card-title" style={{ fontSize: 12 }}>
          举报原因
        </span>
      </div>

      <div className="dropdown-body">
        <div className="report-reasons">
          {REPORT_REASONS.map((item) => (
            <button
              key={item}
              type="button"
              className="report-reason"
              data-active={reason === item}
              onClick={() => setReason(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <label className="report-detail">
          <span className="report-detail-label">
            补充说明<span className="faint">选填，能让值班的人更快判断</span>
          </span>
          <textarea
            className="textarea"
            rows={3}
            maxLength={DETAIL_MAX}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="例如：这条内容在评论区反复发同一个引流链接；或说明你被冒犯的具体位置"
          />
          <span className="report-detail-count faint">
            {detail.length}/{DETAIL_MAX}
          </span>
        </label>
      </div>

      <div className="dropdown-foot">
        <button type="button" className="btn btn-sm" onClick={reset} disabled={busy}>
          取消
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={send} disabled={busy || !reason}>
          <Send size={13} />
          {busy ? '提交中…' : '提交举报'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="dropdown-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={compact ? 'btn btn-sm btn-ghost' : 'btn-icon'}
        onClick={() => {
          if (!allow()) return;
          setOpen((v) => !v);
        }}
        data-active={open}
        disabled={busy}
        aria-label="举报"
        title="举报"
      >
        <AlertTriangle size={compact ? 13 : 15} />
        {compact && <span>举报</span>}
      </button>

      {open && placement && createPortal(panel, document.body)}
    </div>
  );
}
