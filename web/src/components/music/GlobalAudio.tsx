import { useEffect, useRef } from 'react';
import { audioEngine } from '@/lib/audioEngine';
import { useMusic } from '@/store/music';
import { useUi } from '@/store/ui';

/** 唯一的音频载体，挂在应用根部，切换路由不中断播放 */
export function GlobalAudio() {
  const ref = useRef<HTMLAudioElement>(null);
  const tracks = useMusic((s) => s.tracks);
  const index = useMusic((s) => s.index);
  const playing = useMusic((s) => s.playing);
  const volume = useMusic((s) => s.volume);
  const muted = useMusic((s) => s.muted);
  const setProgress = useMusic((s) => s.setProgress);
  const setDuration = useMusic((s) => s.setDuration);
  const next = useMusic((s) => s.next);
  const notify = useUi((s) => s.notify);

  const track = tracks[index];

  useEffect(() => {
    audioEngine.attach(ref.current);
    return () => audioEngine.attach(null);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!track) {
      el.removeAttribute('src');
      el.load();
      delete el.dataset.trackId;
      return;
    }
    if (el.dataset.trackId === String(track.id)) return;
    el.dataset.trackId = String(track.id);
    el.src = track.url;
    setProgress(0);
    setDuration(track.duration || 0);
  }, [track, setProgress, setDuration]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    if (playing) {
      audioEngine.resume();
      el.play().catch((error: DOMException) => {
        if (error?.name === 'NotAllowedError') {
          notify('浏览器阻止了自动播放，请再点一次播放', 'warning');
        }
      });
    } else {
      el.pause();
    }
  }, [playing, track, notify]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = muted ? 0 : volume;
    el.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onTime = () => setProgress(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    };
    const onEnded = () => next(true);
    const onError = () => {
      if (el.dataset.trackId) notify('这首曲目暂时无法播放，已跳过', 'warning');
      next(true);
    };

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
  }, [setProgress, setDuration, next, notify]);

  return <audio ref={ref} preload="metadata" />;
}