import { create } from 'zustand';
import { api } from '@/api/client';
import type { MusicTrack } from '@/api/types';
import { audioEngine } from '@/lib/audioEngine';

export type PlayMode = 'list' | 'single' | 'shuffle';

interface MusicState {
  tracks: MusicTrack[];
  index: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  mode: PlayMode;
  progress: number;
  duration: number;
  loaded: boolean;
  panelOpen: boolean;
  load: (all?: boolean) => Promise<void>;
  playAt: (index: number) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  cycleMode: () => void;
  setMode: (mode: PlayMode) => void;
  setProgress: (progress: number) => void;
  setDuration: (duration: number) => void;
  setTracks: (tracks: MusicTrack[]) => void;
  setPanelOpen: (open: boolean) => void;
}

function readVolume(): number {
  try {
    const raw = Number(localStorage.getItem('xsz.volume'));
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.7;
  } catch {
    return 0.7;
  }
}

export const useMusic = create<MusicState>((set, get) => ({
  tracks: [],
  index: 0,
  playing: false,
  volume: readVolume(),
  muted: false,
  mode: 'list',
  progress: 0,
  duration: 0,
  loaded: false,
  panelOpen: false,

  load: async (all = false) => {
    try {
      const { tracks } = await api.music.list(all);
      set({ tracks, loaded: true, index: Math.min(get().index, Math.max(0, tracks.length - 1)) });
    } catch {
      set({ loaded: true });
    }
  },

  playAt: (index) => {
    const { tracks } = get();
    if (!tracks.length) return;
    const next = ((index % tracks.length) + tracks.length) % tracks.length;
    audioEngine.resume();
    set({ index: next, playing: true, progress: 0, duration: tracks[next].duration || 0 });
  },

  toggle: () => {
    const { tracks, playing, index } = get();
    if (!tracks.length) return;
    if (!playing) audioEngine.resume();
    set({ playing: !playing, index: Math.min(index, tracks.length - 1) });
  },

  next: (auto = false) => {
    const { tracks, index, mode } = get();
    if (!tracks.length) return;
    if (auto && mode === 'single') {
      set({ progress: 0 });
      const el = audioEngine.element;
      if (el) {
        el.currentTime = 0;
        el.play().catch(() => undefined);
      }
      return;
    }
    if (mode === 'shuffle' && tracks.length > 1) {
      let pick = index;
      while (pick === index) pick = Math.floor(Math.random() * tracks.length);
      set({ index: pick, progress: 0, playing: true });
      return;
    }
    const nextIndex = (index + 1) % tracks.length;
    set({ index: nextIndex, progress: 0, playing: true });
  },

  prev: () => {
    const { tracks, index } = get();
    if (!tracks.length) return;
    set({ index: (index - 1 + tracks.length) % tracks.length, progress: 0, playing: true });
  },

  seek: (seconds) => {
    const el = audioEngine.element;
    if (!el) return;
    el.currentTime = seconds;
    set({ progress: seconds });
  },

  setVolume: (volume) => {
    try {
      localStorage.setItem('xsz.volume', String(volume));
    } catch {
      /* 忽略 */
    }
    set({ volume, muted: false });
  },

  toggleMute: () => set({ muted: !get().muted }),

  cycleMode: () => {
    const order: PlayMode[] = ['list', 'single', 'shuffle'];
    const current = get().mode;
    set({ mode: order[(order.indexOf(current) + 1) % order.length] });
  },

  setMode: (mode) => set({ mode }),

  setProgress: (progress) => set({ progress }),
  setDuration: (duration) => set({ duration }),
  setTracks: (tracks) => set({ tracks }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
}));