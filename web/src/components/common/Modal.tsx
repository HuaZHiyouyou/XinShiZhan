import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  children: ReactNode;
  /** 卡片最大宽度，默认交给 .modal-card 的样式 */
  maxWidth?: number;
  role?: 'dialog' | 'alertdialog';
  /** 无障碍名称 */
  label?: string;
  /** 点遮罩关闭（默认不关：弹窗里多是有内容的表单，误点代价大） */
  onBackdrop?: () => void;
  /** 按 Esc 关闭，传了才生效 */
  onEscape?: () => void;
}

/**
 * 全屏弹窗。
 *
 * 两件事必须由它来做，散在各个页面里迟早会漏：
 *
 * 1. **挂到 body 上**。`position: fixed` 的参照物是最近的「包含块」，而
 *    祖先只要带 `transform` / `filter` / `backdrop-filter` 就会新建一个 ——
 *    后台页面里到处是玻璃卡片和入场动画，弹窗一旦渲染在卡片内部，
 *    遮罩就只会盖住那张卡片（看起来像「卡片黑了一块」），
 *    位置也跟着卡片跑，而不是屏幕中央。
 * 2. **遮罩全屏 + 背后模糊**：`.overlay` 负责 `inset: 0` 与 `backdrop-filter`，
 *    卡片用 flex 居中，和视口对齐。
 */
export function Modal({ children, maxWidth, role = 'dialog', label, onBackdrop, onEscape }: Props) {
  useEffect(() => {
    if (!onEscape) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onEscape]);

  return createPortal(
    <div
      className="overlay"
      role={role}
      aria-modal="true"
      aria-label={label}
      onMouseDown={
        onBackdrop
          ? (event) => {
              if (event.target === event.currentTarget) onBackdrop();
            }
          : undefined
      }
    >
      <div className="modal-card" style={maxWidth ? { maxWidth } : undefined}>
        {children}
      </div>
    </div>,
    document.body
  );
}
