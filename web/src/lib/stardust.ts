/** 星尘粒子场（L3）
 *  用一张预渲染的柔光精灵图代替逐帧 arc 绘制，粒子数量上百也能稳定 60fps。
 *  所有运动按时间步长归一，刷新率不同的屏幕速度一致。 */

interface Mote {
  x: number;
  y: number;
  /** 视觉半径，CSS 像素 */
  r: number;
  /** 上升速度，以 60fps 的一帧为单位 */
  vy: number;
  swayAmp: number;
  swaySpeed: number;
  phase: number;
  twinkle: number;
  /** 0.25–1，决定视差强度：越「近」的星尘跟随鼠标越多 */
  depth: number;
  /** 大颗虚化光斑，营造景深与梦幻感 */
  bokeh: boolean;
}

export interface StardustOptions {
  canvas: HTMLCanvasElement;
  count: number;
  bokeh: number;
  dprCap: number;
  /** "r, g, b" 形式的颜色分量，取自 CSS 变量 --stardust */
  color: string;
}

const SPRITE_SIZE = 64;
const POINTER_RANGE = 18;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function makeSprite(color: string): HTMLCanvasElement {
  const sprite = document.createElement('canvas');
  sprite.width = SPRITE_SIZE;
  sprite.height = SPRITE_SIZE;
  const ctx = sprite.getContext('2d');
  if (ctx) {
    const half = SPRITE_SIZE / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, `rgba(${color}, 1)`);
    gradient.addColorStop(0.22, `rgba(${color}, 0.62)`);
    gradient.addColorStop(0.55, `rgba(${color}, 0.16)`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  }
  return sprite;
}

export class StardustField {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private sprite: HTMLCanvasElement;
  private motes: Mote[] = [];
  private raf = 0;
  private last = 0;
  private width = 0;
  private height = 0;
  private dprCap: number;
  private count: number;
  private bokehCount: number;
  private alpha: number;

  /** 鼠标视差：目标值与缓动后的当前值 */
  private targetX = 0;
  private targetY = 0;
  private px = 0;
  private py = 0;

  /** 脉冲截止时间戳，用于发布心事时的一次性提亮 */
  private pulseUntil = 0;

  constructor(options: StardustOptions) {
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.sprite = makeSprite(options.color);
    this.dprCap = options.dprCap;
    this.count = options.count;
    this.bokehCount = options.bokeh;
    this.alpha = 1;
    this.resize();
    this.seed();
  }

  setColor(color: string) {
    this.sprite = makeSprite(color);
  }

  setPointer(nx: number, ny: number) {
    this.targetX = nx * POINTER_RANGE;
    this.targetY = ny * POINTER_RANGE;
  }

  pulse(duration = 1800) {
    this.pulseUntil = performance.now() + duration;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    if (nextWidth === this.width && nextHeight === this.height) return;

    const prevWidth = this.width || nextWidth;
    const prevHeight = this.height || nextHeight;
    const ratioX = nextWidth / prevWidth;
    const ratioY = nextHeight / prevHeight;

    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this.width = nextWidth;
    this.height = nextHeight;
    this.canvas.width = Math.round(nextWidth * dpr);
    this.canvas.height = Math.round(nextHeight * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 尺寸变化时按比例搬运已有粒子，避免全部挤到左上角
    for (const mote of this.motes) {
      mote.x *= ratioX;
      mote.y *= ratioY;
    }
  }

  private seed() {
    const total = this.count + this.bokehCount;
    // 粒子密度随视口面积伸缩，超宽屏不加码到离谱，小屏也不至于空荡
    const areaScale = Math.min(1.5, Math.max(0.55, (this.width * this.height) / (1440 * 900)));
    this.motes = Array.from({ length: Math.round(total * areaScale) }, () => this.createMote(true));
  }

  private createMote(anywhere: boolean): Mote {
    const bokeh = this.motes.filter((m) => m.bokeh).length < this.bokehCount && Math.random() < 0.12;
    const depth = bokeh ? rand(0.25, 0.5) : rand(0.4, 1);
    return {
      x: rand(0, this.width),
      y: anywhere ? rand(0, this.height) : this.height + rand(10, 60),
      r: bokeh ? rand(7, 16) : rand(0.5, 1.9) * (0.6 + depth * 0.7),
      vy: bokeh ? rand(0.02, 0.07) : rand(0.05, 0.26) * (0.5 + depth * 0.8),
      swayAmp: rand(0.05, 0.4),
      swaySpeed: rand(0.0004, 0.0014),
      phase: rand(0, Math.PI * 2),
      twinkle: rand(0.0006, 0.0022),
      depth,
      bokeh,
    };
  }

  start() {
    if (this.raf || !this.ctx) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx?.clearRect(0, 0, this.width, this.height);
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const ctx = this.ctx;
    if (!ctx) return;

    const step = Math.min(4, Math.max(0, (now - this.last) / 16.667));
    this.last = now;

    const ease = Math.min(1, 0.05 * step);
    this.px += (this.targetX - this.px) * ease;
    this.py += (this.targetY - this.py) * ease;

    const pulseLeft = this.pulseUntil - now;
    const boost = pulseLeft > 0 ? 1 + 0.85 * Math.sin(Math.PI * (1 - pulseLeft / 1800)) : 1;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = 'lighter';

    for (const mote of this.motes) {
      mote.phase += mote.swaySpeed * step * 16.667;
      mote.y -= mote.vy * step * boost;
      mote.x += Math.sin(mote.phase) * mote.swayAmp * step;

      if (mote.y < -40) {
        const fresh = this.createMote(false);
        Object.assign(mote, fresh, { x: rand(0, this.width) });
      }
      if (mote.x < -40) mote.x = this.width + 30;
      else if (mote.x > this.width + 40) mote.x = -30;

      const flicker = 0.55 + 0.45 * Math.sin(now * mote.twinkle + mote.phase);
      const alpha = Math.min(1, (mote.bokeh ? 0.1 : 0.72) * flicker * boost * this.alpha);
      if (alpha <= 0.004) continue;

      const size = mote.r * (mote.bokeh ? 5.2 : 7.5);
      const dx = mote.x + this.px * mote.depth - size / 2;
      const dy = mote.y + this.py * mote.depth * 0.6 - size / 2;
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.sprite, dx, dy, size, size);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
}
