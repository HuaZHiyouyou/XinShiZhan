/** 全局唯一的音频引擎：跨路由保持播放不中断，并提供频谱数据 */
class AudioEngine {
  private el: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array | null = null;
  private levels: number[] = [];

  attach(el: HTMLAudioElement | null) {
    this.el = el;
  }

  get element() {
    return this.el;
  }

  /** 懒创建 AnalyserNode；音源需带 CORS 头，否则频谱恒为 0，此时回退为静默柱状 */
  ensureAnalyser(): AnalyserNode | null {
    const el = this.el;
    if (!el) return null;
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
        const source = this.ctx.createMediaElementSource(el);
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);
        analyser.connect(this.ctx.destination);
        this.analyser = analyser;
        this.data = new Uint8Array(analyser.frequencyBinCount);
      }
      return this.analyser;
    } catch {
      return null;
    }
  }

  /** 归一化频谱（0-1）：对数分频，避免低频能量把整排柱子挤成一根 */
  spectrum(bars: number): number[] {
    const analyser = this.ensureAnalyser();
    if (!analyser || !this.data) return new Array(bars).fill(0);
    analyser.getByteFrequencyData(this.data);

    const bins = this.data.length;
    const first = 1;
    const last = Math.max(first + bars, Math.floor(bins * 0.86));
    const ratio = Math.pow(last / first, 1 / bars);

    if (this.levels.length !== bars) this.levels = new Array(bars).fill(0);

    const raws: number[] = [];
    let edge = first;
    let maxRaw = 0;
    for (let i = 0; i < bars; i += 1) {
      const from = Math.floor(edge);
      edge *= ratio;
      const to = Math.max(from + 1, Math.floor(edge));
      let sum = 0;
      let count = 0;
      for (let b = from; b < to && b < bins; b += 1) {
        sum += this.data[b];
        count += 1;
      }
      const raw = count ? sum / count / 255 : 0;
      if (raw > maxRaw) maxRaw = raw;
      raws.push(raw);
    }

    // 以当前最响的频段为基准做相对归一，安静曲目也能看出起伏
    const denom = Math.max(0.16, maxRaw);
    const out: number[] = [];
    for (let i = 0; i < bars; i += 1) {
      const shaped = Math.min(1, Math.pow(raws[i] / denom, 0.72));
      const prev = this.levels[i];
      this.levels[i] = shaped > prev ? prev + (shaped - prev) * 0.55 : prev + (shaped - prev) * 0.16;
      out.push(this.levels[i]);
    }
    return out;
  }

  /** 必须在用户手势里调用：建立音频图并恢复上下文，否则 MediaElementSource 会把声音送进挂起的上下文而静音 */
  resume() {
    this.ensureAnalyser();
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => undefined);
  }
}

export const audioEngine = new AudioEngine();