import { useEffect, useState } from 'react';
import { Columns2, Frame, X } from 'lucide-react';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';

/** 一张可查看的头像：label 说明它是「新头像」还是「当前头像」 */
export interface AvatarShot {
  label: string;
  src: string;
  hint?: string;
}

interface Props {
  shots: AvatarShot[];
  /** 标题里显示的人名 */
  name: string;
  onClose: () => void;
}

/** 显示范围：既能看小图的实际观感，也能拉大看细节 */
const SIZES = [
  { key: 'thumb', label: '缩略', px: 96 },
  { key: 'medium', label: '中等', px: 240 },
  { key: 'full', label: '原图', px: 0 },
] as const;

type SizeKey = (typeof SIZES)[number]['key'];

/**
 * 头像查看器。
 *
 * 审核头像时最需要的是「看得清」：小圆圈里根本判断不了有没有水印或二维码。
 * 这里把两件事都交给看的人决定 ——
 *   · 显示**内容**：在看新头像 / 当前头像，或者干脆并排对比；
 *   · 显示**范围**：缩略、中等还是原图。
 */
export function AvatarViewer({ shots, name, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [size, setSize] = useState<SizeKey>('medium');
  const [compare, setCompare] = useState(shots.length > 1);

  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = shots[index] || shots[0];
  const px = SIZES.find((item) => item.key === size)?.px || 0;
  const imageStyle = px ? { width: px, height: px } : { maxWidth: '100%', maxHeight: '56vh' };

  return (
    <div className="overlay avatar-viewer" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="avatar-viewer-card" onClick={(event) => event.stopPropagation()}>
        <div className="card-head">
          <div className="card-title">
            <Frame size={15} />
            {name} 的头像
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="avatar-viewer-toolbar">
          {shots.length > 1 && (
            <div className="segmented">
              {shots.map((shot, i) => (
                <button
                  key={`${shot.label}-${i}`}
                  type="button"
                  data-active={!compare && index === i}
                  onClick={() => {
                    setIndex(i);
                    setCompare(false);
                  }}
                >
                  {shot.label}
                </button>
              ))}
            </div>
          )}

          <div className="segmented">
            {SIZES.map((item) => (
              <button key={item.key} type="button" data-active={size === item.key} onClick={() => setSize(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="avatar-viewer-stage">
          {compare && shots.length > 1 ? (
            shots.map((shot, i) => (
              <figure key={`pair-${i}`} className="avatar-viewer-shot">
                <img src={shot.src} alt={shot.label} style={imageStyle} />
                <figcaption>
                  {shot.label}
                  {shot.hint ? <span className="faint"> · {shot.hint}</span> : null}
                </figcaption>
              </figure>
            ))
          ) : (
            <figure className="avatar-viewer-shot">
              <img src={current.src} alt={current.label} style={imageStyle} />
              <figcaption>
                {current.label}
                {current.hint ? <span className="faint"> · {current.hint}</span> : null}
              </figcaption>
            </figure>
          )}
        </div>

        <div className="avatar-viewer-foot">
          <span className="hint">
            {size === 'full' ? '按原始像素显示，可以看清细节' : `按 ${px}px 显示，接近它在页面里的实际观感`}
          </span>
          {shots.length > 1 && (
            <button type="button" className="btn btn-sm" onClick={() => setCompare((v) => !v)}>
              <Columns2 size={13} />
              {compare ? '单张查看' : '并排对比'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
