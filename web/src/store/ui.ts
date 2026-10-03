import { create } from 'zustand';

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'warning' | 'danger';
  message: string;
}

interface ConfirmRequest {
  title: string;
  message: string;
  confirmText: string;
  tone: 'default' | 'danger';
  onConfirm: () => void | Promise<void>;
}

type AuthGate = 'login' | 'register' | 'recover' | null;

interface UiState {
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  authGate: AuthGate;
  commentLayout: 'drawer' | 'inline';
  commentTarget: number | null;
  notify: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
  askConfirm: (request: ConfirmRequest) => void;
  closeConfirm: () => void;
  openAuth: (gate: Exclude<AuthGate, null>) => void;
  closeAuth: () => void;
  setCommentLayout: (layout: 'drawer' | 'inline') => void;
  openComments: (postId: number) => void;
  closeComments: () => void;
}

let toastSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  confirm: null,
  authGate: null,
  commentLayout: (() => {
    try {
      const saved = localStorage.getItem('xsz.commentLayout');
      return saved === 'inline' ? 'inline' : 'drawer';
    } catch {
      return 'drawer';
    }
  })(),
  commentTarget: null,

  notify: (message, tone = 'info') => {
    toastSeq += 1;
    const id = toastSeq;
    set({ toasts: [...get().toasts, { id, tone, message }] });
    window.setTimeout(() => get().dismiss(id), 3600);
  },

  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  askConfirm: (request) => set({ confirm: request }),

  closeConfirm: () => set({ confirm: null }),

  openAuth: (gate) => set({ authGate: gate }),

  closeAuth: () => set({ authGate: null }),

  setCommentLayout: (layout) => {
    try {
      localStorage.setItem('xsz.commentLayout', layout);
    } catch {
      /* 忽略存储失败 */
    }
    set({ commentLayout: layout });
  },

  openComments: (postId) => set({ commentTarget: postId }),

  closeComments: () => set({ commentTarget: null }),
}));