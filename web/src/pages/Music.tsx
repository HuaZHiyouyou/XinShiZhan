import { useEffect, useRef, useState } from 'react';
import { ListMusic, Music4, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Upload, Volume2 } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { colorHex } from '@/lib/constants';
import { formatDuration } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useMusic } from '@/store/music';
import { useUi } from '@/store/ui';

const MODE_META = {
  list: { icon: Repeat, label: '列表循环' },
  single: { icon: Repeat1, label: '单曲循环' },
  shuffle: { icon: Shuffle, label: '随机播放' },
} as const;

export function Music() {
  const user = useAuth((s) => s.user);
  const notify = useUi((s) => s.notify);
  const tracks = useMusic((s) => s.tracks);
  const index = useMusic((s) => s.index);
  const playing = useMusic((s) => s.playing);
  const progress = useMusic((s) => s.progress);
  const duration = useMusic((s) => s.duration);
  const mode = useMusic((s) => s.mode);
  const playAt = useMusic((s) => s.playAt);
  const toggle = useMusic((s) => s.toggle);
  const next = useMusic((s) => s.next);
  const prev = useMusic((s) => s.prev);
  const seek = useMusic((s) => s.seek);
  const cycleMode = useMusic((s) => s.cycleMode);
  const load = useMusic((s) => s.load);

  const [showUpload, setShowUpload] = useState(false);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
  }, [load]);

  const track = tracks[index];
  const ModeIcon = MODE_META[mode].icon;
  const total = duration || track?.duration || 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      notify('先选择一个音频文件', 'warning');
      return;
    }
    setUploading(true);
    try {
      await api.music.upload(file, title.trim(), artist.trim(), 0);
      notify('投稿成功，已加入播放列表', 'success');
      setTitle('');
      setArtist('');
      setFile(null);
      setShowUpload(false);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '上传失败', 'danger');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="music-layout">
      <div className="page-head">
        <h1 className="page-title">音乐库</h1>
        <p className="page-desc">陪伴心事的声音，可以一边看广场一边听</p>
      </div>

      <section className="card now-playing">
        <div
          className="now-cover"
          style={{ color: colorHex('azure'), background: `${colorHex('azure')}1a` }}
        >
          <Music4 size={40} />
        </div>

        <div className="grow now-info">
          <div className="now-title">{track ? track.title : '还没有曲目'}</div>
          <div className="now-artist">{track ? track.artist : '等待第一份投稿'}</div>

          <div className="now-progress">
            <span className="mono now-time">{formatDuration(progress)}</span>
            <input
              className="range grow"
              type="range"
              min={0}
              max={total || 1}
              step={0.5}
              value={Math.min(progress, total || 1)}
              style={{ '--range-fill': `${total > 0 ? Math.min(100, (progress / total) * 100) : 0}%` } as React.CSSProperties}
              onChange={(e) => seek(Number(e.target.value))}
              disabled={!track}
              aria-label="播放进度"
            />
            <span className="mono now-time">{formatDuration(total)}</span>
          </div>

          <div className="now-controls">
            <button type="button" className="btn-icon" onClick={cycleMode} title={MODE_META[mode].label} aria-label={MODE_META[mode].label}>
              <ModeIcon size={17} />
            </button>
            <button type="button" className="btn-icon" onClick={prev} aria-label="上一首">
              <SkipBack size={19} />
            </button>
            <button type="button" className="player-play player-play-lg" onClick={toggle} disabled={!track} aria-label={playing ? '暂停' : '播放'}>
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button type="button" className="btn-icon" onClick={() => next(false)} aria-label="下一首">
              <SkipForward size={19} />
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowUpload((v) => !v)}
              disabled={!user}
              title={user ? '投稿一首曲子' : '登录后可投稿'}
            >
              <Upload size={13} />
              投稿
            </button>
          </div>
        </div>
      </section>

      {showUpload && user && (
        <form className="card card-pad upload-card" onSubmit={submit}>
          <div className="section-title" style={{ marginBottom: 'var(--sp-3)' }}>
            <Upload size={14} />
            投稿曲目
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">曲名</span>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="不填则使用文件名"
              />
            </label>
            <label className="field">
              <span className="field-label">作者</span>
              <input
                className="input"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="不填则为匿名投稿"
              />
            </label>
          </div>
          <div className="row-between">
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                hidden
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                <Music4 size={13} />
                {file ? file.name : '选择音频文件'}
              </button>
              <span className="hint">支持 mp3 / m4a / wav / ogg</span>
            </div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={uploading || !file}>
              {uploading ? '上传中…' : '提交投稿'}
            </button>
          </div>
        </form>
      )}

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <ListMusic size={15} />
            全部曲目
            <span className="card-sub">共 {tracks.length} 首</span>
          </div>
          <span className="faint" style={{ fontSize: 11 }}>
            <Volume2 size={12} /> 音量可在底部播放条调整
          </span>
        </div>
        <div className="track-list">
          {tracks.map((item, i) => {
            const active = i === index;
            return (
              <button
                key={item.id}
                type="button"
                className="track-item"
                data-active={active}
                onClick={() => (active ? toggle() : playAt(i))}
              >
                <span className="track-index mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                  <span className="track-title">{item.title}</span>
                  <span className="track-artist">
                    {item.artist}
                    {item.source === 'builtin' ? ' · 内置' : ' · 投稿'}
                  </span>
                </span>
                <span className="mono faint" style={{ fontSize: 11 }}>
                  {formatDuration(item.duration)}
                </span>
                <span className="track-state" style={active ? { color: colorHex('azure') } : undefined}>
                  {active && playing ? <Pause size={15} /> : <Play size={15} />}
                </span>
              </button>
            );
          })}
          {tracks.length === 0 && <div className="empty">还没有曲目，登录后可以投稿</div>}
        </div>
      </section>
    </div>
  );
}