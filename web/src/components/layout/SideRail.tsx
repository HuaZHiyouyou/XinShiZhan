import { NavLink } from 'react-router-dom';
import { Flame, Gauge, Inbox, LayoutDashboard, Library, PenLine, Radio, Settings, UserRound } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';

const NAV = [
  { to: '/', label: '心事广场', icon: Radio, end: true },
  { to: '/ranking', label: '热度榜', icon: Flame, end: false },
  { to: '/music', label: '音乐库', icon: Library, end: false },
  { to: '/overview', label: '站内概览', icon: Gauge, end: false },
];

const PERSONAL = [
  { to: '/mine', label: '我的心事', icon: PenLine },
  { to: '/profile', label: '个人信息', icon: UserRound },
  { to: '/notifications', label: '站内信', icon: Inbox },
  { to: '/settings', label: '设置', icon: Settings },
];

export function SideRail() {
  const user = useAuth((s) => s.user);
  const openAuth = useUi((s) => s.openAuth);

  return (
    <aside className="side-rail">
      <nav className="rail-group">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="rail-item">
            <item.icon size={16} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* 个人入口属于基础导航，未登录也常驻左侧；设置页为设备级常规项，免登录直达，其余点击时引导登录 */}
      <div className="rail-label">我的</div>
      <nav className="rail-group">
        {PERSONAL.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="rail-item"
            onClick={(event) => {
              if (!user && item.to !== '/settings') {
                event.preventDefault();
                openAuth('login');
              }
            }}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
            {user && item.to === '/notifications' && user.unreadNotifications > 0 && (
              <span className="rail-badge">{user.unreadNotifications}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {user && ['superadmin', 'admin', 'reviewer'].includes(user.role) && (
        <>
          <div className="rail-label">管理</div>
          <nav className="rail-group">
            <NavLink to="/admin" className="rail-item">
              <LayoutDashboard size={16} />
              <span>后台面板</span>
            </NavLink>
          </nav>
        </>
      )}
    </aside>
  );
}