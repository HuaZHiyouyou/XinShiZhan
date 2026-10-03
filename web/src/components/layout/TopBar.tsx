import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutDashboard, LogOut, Moon, Search, Sun, UserRound, Waves } from 'lucide-react';
import { Avatar } from '@/components/common/Avatar';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { useAuth } from '@/store/auth';
import { useSite } from '@/store/site';
import { useTheme } from '@/store/theme';
import { useUi } from '@/store/ui';

export function TopBar() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const openAuth = useUi((s) => s.openAuth);
  const notify = useUi((s) => s.notify);
  const siteConfig = useSite((s) => s.config);

  const [keyword, setKeyword] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  /* 悬浮顶栏：停在页面最顶部时完全透明，下滑一段距离后浮出玻璃底色 */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    navigate(keyword.trim() ? `/?q=${encodeURIComponent(keyword.trim())}` : '/');
  };

  const isStaff = Boolean(user && ['superadmin', 'admin', 'reviewer'].includes(user.role));

  return (
    <header className="topbar" data-scrolled={scrolled}>
      <div className="topbar-inner">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <Waves size={17} />
          </span>
          <span className="brand-text">
            <span className="brand-name">心事站</span>
            <span className="brand-sub">说不出口的，交给流动的弹幕</span>
          </span>
        </Link>

        <form className="topbar-search" onSubmit={submitSearch}>
          <Search size={15} />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索心事内容"
            aria-label="搜索心事内容"
          />
        </form>

        <div className="topbar-actions">
          <button
            type="button"
            className="btn-icon"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <NotificationBell />

          {user ? (
            <div className="dropdown-wrap" ref={menuRef}>
              <button
                type="button"
                className="user-chip"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="账号菜单"
              >
                <Avatar name={user.anonName} color={user.anonColor} src={user.avatarUrl} size="sm" />
                <span className="user-chip-name">{user.anonName}</span>
              </button>

              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    className="dropdown"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.16 }}
                  >
                    <div className="menu-identity">
                      <Avatar name={user.anonName} color={user.anonColor} src={user.avatarUrl} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{user.anonName}</div>
                        <div className="faint" style={{ fontSize: 11 }}>
                          {user.role === 'superadmin'
                            ? '超级管理员'
                            : user.role === 'admin'
                              ? '管理员'
                              : user.role === 'reviewer'
                                ? '审核员'
                                : user.role === 'guest'
                                  ? '访客'
                                  : '普通用户'}
                          {user.violationCount > 0 ? ` · 违规 ${user.violationCount} 次` : ''}
                        </div>
                      </div>
                    </div>
                    {user.ban && (
                      <div className="ban-note">
                        账号处于封禁状态：{user.ban.reason}
                        {user.ban.until ? `（至 ${user.ban.until.slice(0, 10)}）` : '（永久）'}
                      </div>
                    )}
                    <Link className="menu-item" to="/mine" onClick={() => setMenuOpen(false)}>
                      <UserRound size={15} />
                      我的心事
                    </Link>
                    {isStaff && (
                      <Link className="menu-item" to="/admin" onClick={() => setMenuOpen(false)}>
                        <LayoutDashboard size={15} />
                        后台面板
                      </Link>
                    )}
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                        notify('已退出登录', 'info');
                        navigate('/');
                      }}
                    >
                      <LogOut size={15} />
                      退出登录
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => openAuth('login')}>
                登录
              </button>
              {siteConfig.allowRegister && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => openAuth('register')}>
                  注册
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}