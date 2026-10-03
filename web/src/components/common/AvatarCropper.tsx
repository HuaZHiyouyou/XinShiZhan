import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Move, RotateCcw, X, ZoomIn } from 'lucide-react';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';

interface Props {
  file: File;
  onCancel: () => void;
  /** 回调给出的是**裁剪并压缩后**的方图，直接拿去上传即可 */
  onConfirm: (blob: Blob) => void;
  busy?: boolean;
}

/** 导出边长：头像最大也就显示到 96px 左右，512 足够清晰又不至于很大 */
const OUTPUT_SIZE = 512;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

/**
 * 头像裁剪器。
 *
 * 头像最终是圆形展示的，直接拿原图去传，用户根本不知道自己会被切掉哪一块 ——
 * 这里先让他把要露出的部分拖到圆里，确认后再导出方图上传。
 *
 * 裁剪状态用「归一化的原图坐标」保存（cx / cy 是裁剪框中心在原图中的比例），
 * 而不是像素位移：这样窗口缩放、容器变宽变窄都不会让已选好的构图跑掉。
 */
export function AvatarCropper({ file, onCancel, onConfirm, busy = false }: Props) {
  const [url, setUrl] = useState('');
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const [size, setSize] = useState(300);
  const [dragging, setDragging] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ x: 0, y: 0, cx: 0.5, cy: 0.5 });
  /* 滚轮监听是原生的，闭包里读要最新值 */
  const zoomRef = useRef(1);

  useBodyScrollLock(true);

  /* 读文件：用 objectURL，组件卸载时记得回收 */
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      setImage(img);
      setZoom(1);
      setCenter({ x: 0.5, y: 0.5 });
    };
    img.onerror = () => alive && setFailed(true);
    img.src = url;
    return () => {
      alive = false;
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);

  /* 舞台是正方形，跟着容器宽高走 */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const sync = () => setSize(el.clientWidth);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /** 裁剪框在原图上的边长（zoom 越大，取的区域越小） */
  const sourceSize = image ? Math.min(image.naturalWidth, image.naturalHeight) / zoom : 0;

  const clampCenter = useCallback(
    (x: number, y: number, nextZoom: number) => {
      if (!image) return { x: 0.5, y: 0.5 };
      const half = Math.min(image.naturalWidth, image.naturalHeight) / nextZoom / 2;
      const spanX = half / image.naturalWidth;
      const spanY = half / image.naturalHeight;
      return {
        x: Math.min(1 - spanX, Math.max(spanX, x)),
        y: Math.min(1 - spanY, Math.max(spanY, y)),
      };
    },
    [image]
  );

  const changeZoom = useCallback(
    (next: number) => {
      const target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      zoomRef.current = target;
      setZoom(target);
      setCenter((prev) => clampCenter(prev.x, prev.y, target));
    },
    [clampCenter]
  );

  /* 滚轮缩放要 preventDefault，React 的合成事件是被动的，这里直接挂原生监听 */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      changeZoom(zoomRef.current - event.deltaY / 600);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [changeZoom]);

  /* 拖拽：把像素位移换算回原图比例 */
  const onPointerDown = (event: React.PointerEvent) => {
    if (!image) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, cx: center.x, cy: center.y };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging || !image) return;
    const scale = size / sourceSize; // 视口 1px 对应多少原图像素
    const dx = (event.clientX - dragRef.current.x) / scale / image.naturalWidth;
    const dy = (event.clientY - dragRef.current.y) / scale / image.naturalHeight;
    setCenter(clampCenter(dragRef.current.cx - dx, dragRef.current.cy - dy, zoom));
  };

  const endDrag = () => setDragging(false);

  const reset = () => {
    setZoom(1);
    setCenter({ x: 0.5, y: 0.5 });
  };

  const confirm = () => {
    if (!image) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const sx = center.x * image.naturalWidth - sourceSize / 2;
    const sy = center.y * image.naturalHeight - sourceSize / 2;
    ctx.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    /* 带透明通道的格式保留透明；其余压成 JPEG，体积小很多 */
    const keepAlpha = /png|webp|gif/i.test(file.type);
    canvas.toBlob(
      (blob) => {
        if (blob) onConfirm(blob);
      },
      keepAlpha ? 'image/png' : 'image/jpeg',
      keepAlpha ? undefined : 0.92
    );
  };

  const scale = image ? size / sourceSize : 1;
  const preview = image ? (
    <img
      src={url}
      alt="待裁剪的头像"
      draggable={false}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: image.naturalWidth * scale,
        height: image.naturalHeight * scale,
        transform: `translate3d(${-(center.x * image.naturalWidth - sourceSize / 2) * scale}px, ${
          -(center.y * image.naturalHeight - sourceSize / 2) * scale
        }px, 0)`,
        maxWidth: 'none',
      }}
    />
  ) : null;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal-card crop-card">
        <div className="card-head">
          <div className="card-title">
            <Move size={15} />
            选择头像要展示的区域
          </div>
          <button type="button" className="btn-icon" onClick={onCancel} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="card-pad stack">
          {failed ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              这张图片读不出来，换一张试试（支持 png / jpg / webp / gif）。
            </p>
          ) : (
            <>
              <p className="hint" style={{ margin: 0 }}>
                拖动调整位置，滚轮或下面的滑杆缩放。圆里的部分就是最终显示的头像。
              </p>

              <div className="crop-stage-wrap">
                <div
                  className="crop-stage"
                  ref={stageRef}
                  data-dragging={dragging}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  {preview}
                  {/* 圆外的部分压暗，一眼看清会露出什么 */}
                  <div className="crop-mask" />
                  <div className="crop-ring" />
                </div>
              </div>

              <div className="crop-zoom">
                <ZoomIn size={14} />
                <input
                  type="range"
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => changeZoom(Number(e.target.value))}
                  aria-label="缩放"
                />
                <button type="button" className="btn btn-sm" onClick={reset}>
                  <RotateCcw size={12} />
                  复位
                </button>
              </div>
            </>
          )}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy || !image}>
              <Check size={14} />
              {busy ? '上传中…' : '就用这张'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
