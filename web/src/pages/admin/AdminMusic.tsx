import { useCallback, useEffect, useState } from 'react';
import { Music4, Play, Save, Trash2, Upload } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import type { MusicTrack } from '@/api/types';
import { Empty, SkeletonList } from '@/components/common/Empty';
import { formatDuration } from '@/lib/format';
import { useMusic } from '@/store/music';
import { useUi } from '@/store/ui';

export function AdminMusic() {
  const notify = useUi((s) => s.notify);
  const reloadPlayer = useMusic((s) => s.load);
  const playAt = useMusic((s) => s.playAt);
  const playerTracks = useMusic((s) => s.tracks);

  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<number, { title: string; artist: string; sortOrder: number }>>({});
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { tracks: data } = await api.music.list(true);
      setTracks(data);
      setDrafts(
        Object.fromEntries(
          data.map((t) => [t.id, { title: t.title, artist: t.artist, sortOrder: t.sortOrder }])
        )
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '加载失败', 'danger');
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (track: MusicTrack) => {
    const draft = drafts[track.id];
    if (!draft) return;
    try {
      await api.music.update(track.id, draft);
      notify('已保存', 'success');
      await load();
      await reloadPlayer();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '保存失败', 'danger');
    }
  };

  const toggleEnabled = async (track: MusicTrack) => {
    try {
      await api.music.update(track.id, { enabled: !track.enabled });
      notify(track.enabled ? '已停用' : '已启用', 'success');
      await load();
      await reloadPlayer();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '操作失败', 'danger');
    }
  };

  const remove = async (track: MusicTrack) => {
    try {
      await api.music.remove(track.id);
      notify('已删除', 'success');
      await load();
      await reloadPlayer();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '删除失败', 'danger');
    }
  };

  const upload = async () => {
    if (!file) {
      notify('先选择音频文件', 'warning');
      return;
    }
    setUploading(true);
    try {
      await api.music.upload(file, title.trim(), artist.trim(), 0);
      notify('已加入音乐库', 'success');
      setTitle('');
      setArtist('');
      setFile(null);
      await load();
      await reloadPlayer();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : '上传失败', 'danger');
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <SkeletonList rows={5} body={1} />;

  return (
    <div className="stack">
      <section className="card card-pad">
        <div className="section-title" style={{ marginBottom: 'var(--sp-3)' }}>
          <Upload size={14} />
          添加曲目
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field-label">曲名</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="不填则用文件名" />
          </label>
          <label className="field">
            <span className="field-label">作者</span>
            <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="不填则为匿名投稿" />
          </label>
          <label className="field">
            <span className="field-label">音频文件</span>
            <input
              className="input"
              type="file"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={upload} disabled={uploading || !file}>
            {uploading ? '上传中…' : '上传并启用'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <Music4 size={15} />
            全部曲目
            <span className="card-sub">共 {tracks.length} 首，内置曲目只能停用</span>
          </div>
        </div>

        {tracks.length === 0 ? (
          <Empty title="音乐库还是空的" desc="上传第一首曲子，它会出现在全站播放器里" />
        ) : (
          <div className="admin-table">
            {tracks.map((track) => {
              const draft = drafts[track.id] || { title: track.title, artist: track.artist, sortOrder: track.sortOrder };
              const inPlayer = playerTracks.some((t) => t.id === track.id);
              const playerIndex = playerTracks.findIndex((t) => t.id === track.id);
              return (
                <article key={track.id} className="admin-row">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                      <span className="mono faint">#{track.id}</span>
                      <span className="tag">{track.source === 'builtin' ? '内置' : '投稿'}</span>
                      <span className="tag">{formatDuration(track.duration)}</span>
                      {!track.enabled && <span className="tag tag-danger">已停用</span>}
                      {inPlayer && <span className="tag tag-teal">已在播放列表</span>}
                    </div>

                    <div className="admin-inline-form">
                      <input
                        className="input"
                        value={draft.title}
                        onChange={(e) =>
                          setDrafts({ ...drafts, [track.id]: { ...draft, title: e.target.value } })
                        }
                        placeholder="曲名"
                      />
                      <input
                        className="input"
                        value={draft.artist}
                        onChange={(e) =>
                          setDrafts({ ...drafts, [track.id]: { ...draft, artist: e.target.value } })
                        }
                        placeholder="作者"
                      />
                      <input
                        className="input input-narrow"
                        type="number"
                        value={draft.sortOrder}
                        onChange={(e) =>
                          setDrafts({ ...drafts, [track.id]: { ...draft, sortOrder: Number(e.target.value) } })
                        }
                        placeholder="排序"
                      />
                    </div>
                  </div>

                  <div className="admin-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => inPlayer && playAt(playerIndex)}
                      disabled={!inPlayer}
                    >
                      <Play size={13} />
                      试听
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => save(track)}>
                      <Save size={13} />
                      保存
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => toggleEnabled(track)}>
                      {track.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => remove(track)}
                      disabled={track.source === 'builtin'}
                      title={track.source === 'builtin' ? '内置曲目不可删除' : '删除曲目'}
                    >
                      <Trash2 size={13} />
                      删除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}