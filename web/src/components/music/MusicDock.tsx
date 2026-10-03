import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ListMusic,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { audioEngine } from '@/lib/audioEngine';
import { colorHex } from '@/lib/constants';
import { formatDuration } from '@/lib/format';
import { useMusic } from '@/store/music';

const MODE_META = {
  list: { icon: Repeat, label: '列表循环' },
  single: { icon: Repeat1, label: '单曲循环' },
  shuffle: { icon: Shuffle, label: '随机播放' },
} as const;

function Spectrum({ active }: { active: boolean }) {
  const [bars, setBars] = useState<number[]>(() => new Array(18).fill(0.06));
  const frame = useRef(0);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      frame.current += 1;
      const next = audioEngine.spectrum(18);
      const hasSignal = next.some((v) => v > 0.02);
      setBars(
        active && hasSignal
          ? next
          : active
            ? new Array(18).fill(0).map((_, i) => 0.08 + Math.abs(Math.sin(frame.current / 14 + i / 2.4)) * 0.26)
            : new Array(18).fill(0.05)
      );
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, setBars]);

  return (
    <div className="spectrum" aria-hidden="true">
      {bars.map((value, i) => (
        <span key={i} style={{ height: `${Math.max(6, value * 100)}%` }} />
      ))}
    </div>
  );
}

export function MusicDock() {
  const tracks = useMusic((s) => s.tracks);
  const index = useMusic((s) => s.index);
  const playing = useMusic((s) => s.playing);
  const volume = useMusic((s) => s.volume);
  const muted = useMusic((s) => s.muted);
  const mode = useMusic((s) => s.mode);
  const progress = useMusic((s) => s.progress);
  const duration = useMusic((s) => s.duration);
  const open = useMusic((s) => s.panelOpen);
  const toggle = useMusic((s) => s.toggle);
  const next = useMusic((s) => s.next);
  const prev = useMusic((s) => s.prev);
  const seek = useMusic((s) => s.seek);
  const playAt = useMusic((s) => s.playAt);
  const setVolume = useMusic((s) => s.setVolume);
  const toggleMute = useMusic((s) => s.toggleMute);
  const cycleMode = useMusic((s) => s.cycleMode);
  const setPanelOpen = useMusic((s) => s.setPanelOpen);

  const track = tracks[index];
  const total = duration || track?.duration || 0;
  const progressPct = total > 0 ? Math.min(100, (progress / total) * 100) : 0;
  const volumePct = (muted ? 0 : volume) * 100;
  const ModeIcon = MODE_META[mode].icon;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  if (!tracks.length) return null;

  return (
    <div className="music-dock">
      <AnimatePresence>
        {open && (
          <motion.aside
            className="music-dock-panel"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="dock-head">
              <div className="card-title" style={{ fontSize: 14 }}>
                <Music2 size={15} />
                音乐播放器
              </div>
              <Link className="btn btn-sm btn-ghost" to="/music" onClick={() => setPanelOpen(false)}>
                音乐库
              </Link>
            </div>

            <div className="dock-now">
              <span
                className="dock-cover"
                style={track ? { color: colorHex('azure'), background: `${colorHex('azure')}1f` } : undefined}
              >
                <ListMusic size={17} />
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="dock-title">{track ? track.title : '暂无曲目'}</div>
                <div className="dock-artist">{track ? track.artist : '等待投稿'}</div>
              </div>
              <Spectrum active={playing} />
            </div>

            <div className="dock-progress">
              <span className="mono dock-time">{formatDuration(progress)}</span>
              <input
                className="range grow"
                type="range"
                min={0}
                max={total || 0}
                step={0.5}
                value={Math.min(progress, total || 0)}
                style={{ '--range-fill': `${progressPct}%` } as React.CSSProperties}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="播放进度"
              />
              <span className="mono dock-time">{formatDuration(total)}</span>
            </div>

            <div className="dock-controls">
              <button
                type="button"
                className="btn-icon"
                onClick={cycleMode}
                title={MODE_META[mode].label}
                aria-label={MODE_META[mode].label}
              >
                <ModeIcon size={16} />
              </button>
              <button type="button" className="btn-icon" onClick={prev} aria-label="上一首">
                <SkipBack size={18} />
              </button>
              <button type="button" className="player-play" onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
                {playing ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <button type="button" className="btn-icon" onClick={() => next(false)} aria-label="下一首">
                <SkipForward size={18} />
              </button>
            </div>

            <div className="dock-foot">
              <button
                type="button"
                className="btn-icon"
                onClick={toggleMute}
                aria-label={muted ? '取消静音' : '静音'}
              >
                <VolumeIcon size={16} />
              </button>
              <input
                className="range grow"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                style={{ '--range-fill': `${volumePct}%` } as React.CSSProperties}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="音量"
              />
            </div>

            <div className="dock-list-head">
              <span>播放列表</span>
              <span className="mono">{tracks.length} 首</span>
            </div>

            <div className="dock-playlist">
              {tracks.map((item, i) => {
                const active = i === index;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="playlist-item"
                    data-active={active}
                    onClick={() => (active ? toggle() : playAt(i))}
                  >
                    <span className="playlist-index mono">{String(i + 1).padStart(2, '0')}</span>
                    <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                      <span className="playlist-title">{item.title}</span>
                      <span className="playlist-artist">{item.artist}</span>
                    </span>
                    <span className="playlist-state" style={active ? { color: colorHex('azure') } : undefined}>
                      {active && playing ? <Pause size={14} /> : <Play size={14} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <button
        type="button"
        className="music-dock-toggle"
        data-open={open}
        onClick={() => setPanelOpen(!open)}
        aria-label={open ? '收起音乐播放器' : '展开音乐播放器'}
        aria-expanded={open}
        title="音乐播放器"
      >
        <Music2 size={19} />
        {playing && <span className="music-dock-dot" />}
      </button>
    </div>
  );
}