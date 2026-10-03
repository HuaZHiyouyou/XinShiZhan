import { useEffect, useRef } from 'react';
import { StardustField } from '@/lib/stardust';
import { useFx } from '@/store/fx';
import { useMusic } from '@/store/music';
import { useTheme } from '@/store/theme';

/** 各档位的粒子预算：华丽档粒子更多、允许更高像素比 */
const PRESET = {
  lush: { count: 150, bokeh: 9, dprCap: 2 },
  balanced: { count: 82, bokeh: 5, dprCap: 1.5 },
} as const;

const PULSE_MS = 1800;

function readStardustColor(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--stardust').trim();
  return raw || '214, 230, 255';
}

/** 全屏背景层：极光、光束、星尘与暗角纱。纯装饰，不参与交互与无障碍树。 */
export function Backdrop() {
  const effective = useFx((s) => s.effective);
  const pulseToken = useFx((s) => s.pulseToken);
  const playing = useMusic((s) => s.playing);
  const theme = useTheme((s) => s.theme);

  const rootRef = useRef<HTMLDivElement>(null);
  const auroraRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<StardustField | null>(null);

  /* L1 鼠标视差：只写自定义属性，由 CSS transform 消费，不触发重排 */
  useEffect(() => {
    const aurora = auroraRef.current;
    if (!aurora || effective === 'calm') return;
    if (window.matchMedia('(pointer: coarse)').matches) return;

    let nx = 0;
    let ny = 0;
    let queued = false;

    const onMove = (event: PointerEvent) => {
      nx = (event.clientX / window.innerWidth) * 2 - 1;
      ny = (event.clientY / window.innerHeight) * 2 - 1;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        aurora.style.setProperty('--px', `${(-nx * 16).toFixed(2)}px`);
        aurora.style.setProperty('--py', `${(-ny * 11).toFixed(2)}px`);
        fieldRef.current?.setPointer(nx, ny);
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [effective]);

  /* L3 星尘粒子场生命周期 */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || effective === 'calm') return;

    const field = new StardustField({ canvas, ...PRESET[effective], color: readStardustColor() });
    fieldRef.current = field;
    field.start();

    const onResize = () => field.resize();
    const onVisibility = () => (document.hidden ? field.stop() : field.start());
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      field.stop();
      fieldRef.current = null;
    };
  }, [effective]);

  /* 主题切换后星尘颜色要跟着走，否则浅色下会是一层白点 */
  useEffect(() => {
    fieldRef.current?.setColor(readStardustColor());
  }, [theme]);

  /* 发出心事 / 弹幕时的一次性辉光回应 */
  useEffect(() => {
    if (pulseToken === 0) return;
    const root = rootRef.current;
    fieldRef.current?.pulse(PULSE_MS);
    root?.setAttribute('data-pulse', 'true');
    const timer = window.setTimeout(() => root?.removeAttribute('data-pulse'), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [pulseToken]);

  return (
    <div className="backdrop" ref={rootRef} data-playing={playing || undefined} aria-hidden="true">
      <div className="backdrop-base" />
      <div className="backdrop-aurora" ref={auroraRef}>
        <span className="blob blob-1" />
        <span className="blob blob-2" />
        <span className="blob blob-3" />
        <span className="blob blob-4" />
        <span className="blob blob-5" />
      </div>
      <div className="backdrop-beams" />
      {effective !== 'calm' && <canvas className="backdrop-stardust" ref={canvasRef} />}
      <div className="backdrop-veil" />
      <div className="backdrop-noise" />
    </div>
  );
}
