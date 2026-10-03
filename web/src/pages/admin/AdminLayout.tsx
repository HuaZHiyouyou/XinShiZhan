import { NavLink, Outlet } from 'react-router-dom';
import { AlertTriangle, BarChart3, FileText, Lock, Music4, ScrollText, Send, Settings2, ShieldCheck, Users } from 'lucide-react';
import { Empty } from '@/components/common/Empty';
import { useAuth } from '@/store/auth';

/**
 * 审批台是「所有待审/待处理业务」的统一入口：
 * 内容审批、头像审批、举报处理、找回申请都在它的标签页里，不再各占一个菜单。
 */
const TABS = [
  { to: '/admin', label: '数据看板', icon: BarChart3, end: true },
  { to: '/admin/review', label: '审批台', icon: ShieldCheck },
  { to: '/admin/posts', label: '内容管理', icon: FileText },
  { to: '/admin/users', label: '用户与封禁', icon: Users },
  { to: '/admin/notify', label: '站内回复', icon: Send },
  { to: '/admin/rules', label: '审核规则', icon: Settings2 },
  { to: '/admin/site', label: '站点与安全', icon: Lock },
  { to: '/admin/music', label: '音乐库', icon: Music4 },
  { to: '/admin/audit', label: '操作日志', icon: ScrollText },
];

const ROLE_DESC: Record<string, string> = {
  superadmin: '超级管理员（站点所有者，可改站点级开关与角色）',
  admin: '管理员（审核内容、处理举报与封禁普通账号）',
  reviewer: '审核员（审批与内容处理）',
};

export function AdminLayout() {
  const user = useAuth((s) => s.user);

  if (!user) {
    return <Empty title="需要登录后才能进入后台" desc="请使用管理员或审核员账号登录" />;
  }

  if (!['superadmin', 'admin', 'reviewer'].includes(user.role)) {
    return (
      <Empty
        icon={<AlertTriangle size={26} />}
        title="没有后台访问权限"
        desc="当前账号是普通住客，后台仅对超级管理员、管理员与审核员开放"
      />
    );
  }

  /* 站点与安全、审核规则两类配置属于站点级开关，普通管理员进去只能看不能改 */
  const tabs = user.role === 'reviewer' ? TABS.filter((tab) => tab.to !== '/admin/rules' && tab.to !== '/admin/site') : TABS;

  return (
    <div className="admin-layout">
      <div className="page-head">
        <h1 className="page-title">后台面板</h1>
        <p className="page-desc">当前身份：{ROLE_DESC[user.role] || '审核员'}</p>
      </div>

      <nav className="admin-tabs">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className="admin-tab">
            <tab.icon size={14} />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="admin-body">
        <Outlet />
      </div>
    </div>
  );
}