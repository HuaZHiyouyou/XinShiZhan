import { useNavigate } from 'react-router-dom';
import { Ghost, LogOut, Moon, Music2, Palette, Repeat, Repeat1, Shuffle, Sun, UserRound, Volume2, VolumeX } from 'lucide-react';
import type { PlayMode } from '@/store/music';
import { ApiError } from '@/api/client';
import { useAuth } from '@/store/auth';
import { useFx } from '@/store/fx';
import { useMusic } from '@/store/music';
import { useSite } from '@/store/site';
import { useTheme } from '@/store/theme';
import { useUi } from '@/store/ui';

const MODES: { value: PlayMode; label: string; icon: typeof Repeat }[] = [
  { value: 'list', label: '列表循环', icon: Repeat },
  { value: 'single', label: '单曲循环', icon: Repeat1 },
  { value: 'shuffle', label: '随机播放', icon: Shuffle },
];

export function Settings() {
  const navigate = useNavigate();

  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  const fxQuality = useFx((s) => s.quality);
  const setFxQuality = useFx((s) => s.setQuality);
  const fxReduced = useFx((s) => s.reducedMotion);
  const fxWatchdog = useFx((s) => s.watchdog);
  const setFxWatchdog = useFx((s) => s.setWatchdog);

  const commentLayout = useUi((s) => s.commentLayout);
  const setCommentLayout = useUi((s) => s.setCommentLayout);
  const notify = useUi((s) => s.notify);
  const openAuth = useUi((s) => s.openAuth);

  const volume = useMusic((s) => s.volume);
  const muted = useMusic((s) => s.muted);
  const mode = useMusic((s) => s.mode);
  const setVolume = useMusic((s) => s.setVolume);
  const toggleMute = useMusic((s) => s.toggleMute);
  const setMode = useMusic((s) => s.setMode);

  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const guestLogin = useAuth((s) => s.guestLogin);
  const siteConfig = useSite((s) => s.config);

  const volumePct = Math.round((muted ? 0 : volume) * 100);

  const enterAsGuest = async () => {
    try {
      await guestLogin();
      notify('已以访客身份进入，本次访问已被记录', 'success');
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '访客进入失败，请稍后再试', 'warning');
    }
  };

  /* 系统「减弱动效」开启时实际只会跑静谧档，这里让控件如实反映生效结果 */
  const activeFx = fxReduced ? 'calm' : fxQuality;
  const fxDesc = fxReduced
    ? '系统开启了「减弱动效」，背景已自动切到静谧档，只保留静态底色'
    : '华丽档有流动的极光与星尘，均衡档更省电，静谧档只留静态底色';

  return (
    <div className="settings-layout">
      <div className="page-head">
        <h1 className="page-title">设置</h1>
        <p className="page-desc">外观、留言方式与播放偏好都保存在这台设备上，随时可以改回来</p>
      </div>

      <section className="card card-pad">
        <div className="section-title">
          <Palette size={14} />
          外观
        </div>
        <div className="setting-list">
          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-name">主题</div>
              <div className="setting-desc">深色更适合夜里翻看心事，浅色在白天更清晰</div>
            </div>
            <div className="segmented">
              <button type="button" data-active={theme === 'dark'} onClick={() => setTheme('dark')}>
                <Moon size={13} />
                深色
              </button>
              <button type="button" data-active={theme === 'light'} onClick={() => setTheme('light')}>
                <Sun size={13} />
                浅色
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-name">背景画质</div>
              <div className="setting-desc">{fxDesc}</div>
            </div>
            <div className="segmented">
              <button
                type="button"
                data-active={activeFx === 'lush'}
                onClick={() => setFxQuality('lush')}
                disabled={fxReduced}
              >
                华丽
              </button>
              <button
                type="button"
                data-active={activeFx === 'balanced'}
                onClick={() => setFxQuality('balanced')}
                disabled={fxReduced}
              >
                均衡
              </button>
              <button
                type="button"
                data-active={activeFx === 'calm'}
                onClick={() => setFxQuality('calm')}
                disabled={fxReduced}
              >
                静谧
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-name">帧率检测提醒</div>
              <div className="setting-desc">
                开启后实测背景动效帧率，只有连续 6 秒低于 30fps 才会问你要不要降档；30 帧及以上一律不打扰。关掉后完全不采样，画质只由你手动决定。
              </div>
            </div>
            <input
              type="checkbox"
              className="switch"
              checked={fxWatchdog}
              onChange={(e) => setFxWatchdog(e.target.checked)}
              disabled={activeFx === 'calm'}
              aria-label="帧率检测提醒"
              title={
                activeFx === 'calm'
                  ? '静谧档已是最省的一档，无需检测'
                  : fxWatchdog
                    ? '已开启：低于 30fps 才提醒'
                    : '已关闭：不再检测帧率'
              }
            />
          </div>
        </div>
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <UserRound size={14} />
          留言与互动
        </div>
        <div className="setting-list">
          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-name">留言展示方式</div>
              <div className="setting-desc">侧栏并列会在右侧固定一列，就地展开则在心事下方直接铺开</div>
            </div>
            <div className="segmented">
              <button
                type="button"
                data-active={commentLayout === 'drawer'}
                onClick={() => setCommentLayout('drawer')}
              >
                侧栏并列
              </button>
              <button
                type="button"
                data-active={commentLayout === 'inline'}
                onClick={() => setCommentLayout('inline')}
              >
                就地展开
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <Music2 size={14} />
          音乐
        </div>
        <div className="setting-list">
          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-name">播放音量</div>
              <div className="setting-desc">拖动滑块调整音量，静音时滑块会归零</div>
            </div>
            <div className="setting-control">
              <button
                type="button"
                className="btn-icon"
                onClick={toggleMute}
                aria-label={muted ? '取消静音' : '静音'}
              >
                {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                className="range setting-range"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                style={{ '--range-fill': `${volumePct}%` } as React.CSSProperties}
                aria-label="播放音量"
              />
              <span className="setting-value mono">{volumePct}%</span>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-name">播放模式</div>
              <div className="setting-desc">决定一首放完之后，下一首从哪里开始</div>
            </div>
            <div className="segmented">
              {MODES.map((item) => (
                <button key={item.value} type="button" data-active={mode === item.value} onClick={() => setMode(item.value)}>
                  <item.icon size={13} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card card-pad">
        <div className="section-title">
          <LogOut size={14} />
          账号
        </div>
        {user ? (
          <div className="setting-list">
            <div className="setting-row">
              <div className="setting-text">
                <div className="setting-name">当前身份</div>
                <div className="setting-desc">
                  你以「{user.anonName}」的身份留在站内（UID {user.uid ?? '—'}）
                  {user.role === 'superadmin'
                    ? '，拥有超级管理员权限，站点级开关由你掌控'
                    : user.role === 'admin'
                      ? '，拥有管理员权限'
                      : user.role === 'reviewer'
                        ? '，可以处理复核队列'
                        : user.role === 'guest'
                          ? '，当前为访客身份，注册正式账号后即可发布心事'
                          : ''}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  logout();
                  notify('已退出登录', 'info');
                  navigate('/');
                }}
              >
                <LogOut size={13} />
                退出登录
              </button>
            </div>

            <div className="setting-row">
              <div className="setting-text">
                <div className="setting-name">昵称与账号安全</div>
                <div className="setting-desc">
                  修改站内昵称、登录账号与密码都在「个人信息」里，改账号或密码需要先验证当前密码
                </div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => navigate('/profile')}>
                <UserRound size={13} />
                去修改
              </button>
            </div>
          </div>
        ) : (
          <div className="setting-list">
            <div className="setting-row">
              <div className="setting-text">
                <div className="setting-name">尚未登录</div>
                <div className="setting-desc">登录后可以发布心事、发送弹幕并保留自己的偏好</div>
              </div>
              <div className="row" style={{ gap: 'var(--sp-2)' }}>
                <button type="button" className="btn btn-sm" onClick={() => openAuth('login')}>
                  登录
                </button>
                {siteConfig.allowRegister && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => openAuth('register')}>
                    注册
                  </button>
                )}
                {siteConfig.allowGuestLogin && (
                  <button type="button" className="btn btn-sm" onClick={enterAsGuest}>
                    <Ghost size={13} />
                    访客进入
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}