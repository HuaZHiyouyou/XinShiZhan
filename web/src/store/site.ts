import { create } from 'zustand';
import { api } from '@/api/client';
import type { SiteConfig } from '@/api/types';

const FALLBACK: SiteConfig = {
  allowRegister: true,
  allowGuestLogin: false,
  announcement: '',
  secureChannel: true,
  minPasswordLength: 6,
  /* 身份验证预留项：默认全部关闭，避免在后端配置未到达前误开入口 */
  verification: {
    emailEnabled: false,
    emailRequired: false,
    phoneEnabled: false,
    phoneRequired: false,
    realNameEnabled: false,
    realNameRequired: false,
  },
  /* 找回密码渠道：开关与联系方式都由超级管理员在后台控制 */
  recovery: {
    emailEnabled: false,
    serviceEnabled: true,
    masterEnabled: true,
    securityEnabled: false,
    serviceAccount: '',
    serviceHint: '',
    masterContact: '',
    masterHint: '',
  },
};

interface SiteState {
  config: SiteConfig;
  loaded: boolean;
  /** 拉取最新站点配置；打开登录弹窗、后台保存配置后都会调用，保证开关立即生效 */
  load: () => Promise<void>;
}

function mergeConfig(raw: Partial<SiteConfig> | null | undefined): SiteConfig {
  return {
    ...FALLBACK,
    ...raw,
    verification: { ...FALLBACK.verification, ...(raw?.verification || {}) },
    recovery: { ...FALLBACK.recovery, ...(raw?.recovery || {}) },
  };
}

/** 站点公开配置：注册/访客登录开关、身份验证与找回渠道，由管理员在后台控制 */
export const useSite = create<SiteState>((set) => ({
  config: FALLBACK,
  loaded: false,
  load: async () => {
    try {
      const { config } = await api.siteConfig();
      set({ config: mergeConfig(config), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
