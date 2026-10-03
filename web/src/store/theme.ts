import { create } from 'zustand';

type Theme = 'dark' | 'light';

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem('xsz.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* 忽略 */
  }
  return 'dark';
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const initial = readTheme();
apply(initial);

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initial,
  setTheme: (theme) => {
    try {
      localStorage.setItem('xsz.theme', theme);
    } catch {
      /* 忽略 */
    }
    apply(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));