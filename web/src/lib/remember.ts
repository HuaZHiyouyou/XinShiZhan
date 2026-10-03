/**
 * 「记住账号 / 记住密码」的本地存储。
 *
 * 安全说明（请如实告知使用者）：
 * - 记住账号只是把用户名存在本机，风险很低；
 * - 记住密码必然要把口令留在浏览器里。**任何纯前端方案都做不到真正的加密**——
 *   页面自己能解开的密文，本机上能跑脚本的人也能解开。
 *   所以这里只做一层混淆，作用是「避免别人随手打开开发者工具就看到明文」，
 *   真正的防护是三条使用约定：默认不勾选、界面明确提示、公共设备不要开启。
 * - 勾选「记住密码」会自动连带勾选「记住账号」；两个都不勾时直接清空存储。
 */

const KEY = 'xsz.remember.v1';
const MASK = 'xsz-remember-v1';

export interface RememberedLogin {
  username: string;
  password: string;
  rememberAccount: boolean;
  rememberPassword: boolean;
}

export const EMPTY_REMEMBERED: RememberedLogin = {
  username: '',
  password: '',
  rememberAccount: false,
  rememberPassword: false,
};

function obfuscate(text: string): string {
  try {
    const bytes = new TextEncoder().encode(text);
    const mixed = bytes.map((byte, index) => byte ^ MASK.charCodeAt(index % MASK.length));
    let binary = '';
    mixed.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  } catch {
    return '';
  }
}

function deobfuscate(text: string): string {
  try {
    const binary = atob(text);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const mixed = bytes.map((byte, index) => byte ^ MASK.charCodeAt(index % MASK.length));
    return new TextDecoder().decode(mixed);
  } catch {
    return '';
  }
}

export function loadRemembered(): RememberedLogin {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_REMEMBERED };
    const parsed = JSON.parse(raw) as { a?: boolean; w?: boolean; u?: string; p?: string };
    const rememberPassword = Boolean(parsed.w);
    return {
      rememberAccount: Boolean(parsed.a) || rememberPassword,
      rememberPassword,
      username: parsed.u ? deobfuscate(parsed.u) : '',
      /* 只勾了「记住账号」时不保留口令，杜绝「界面上说没记、实际还在」 */
      password: rememberPassword && parsed.p ? deobfuscate(parsed.p) : '',
    };
  } catch {
    /* 隐私模式或存储被禁用时静默降级 */
    return { ...EMPTY_REMEMBERED };
  }
}

export function saveRemembered(next: RememberedLogin): void {
  try {
    if (!next.rememberAccount && !next.rememberPassword) {
      window.localStorage.removeItem(KEY);
      return;
    }
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        a: next.rememberAccount,
        w: next.rememberPassword,
        u: obfuscate(next.username),
        p: next.rememberPassword ? obfuscate(next.password) : '',
      })
    );
  } catch {
    /* 写不进去也不影响登录本身 */
  }
}

/** 主动清除（例如用户把两个开关都关掉时） */
export function clearRemembered(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}
