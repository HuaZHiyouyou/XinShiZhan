import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/layout/RequireAuth';
import { AdminAudit } from '@/pages/admin/AdminAudit';
import { AdminDashboard } from '@/pages/admin/AdminDashboard';
import { AdminLayout } from '@/pages/admin/AdminLayout';
import { AdminMusic } from '@/pages/admin/AdminMusic';
import { AdminNotify } from '@/pages/admin/AdminNotify';
import { AdminPosts } from '@/pages/admin/AdminPosts';
import { AdminReports } from '@/pages/admin/AdminReports';
import { AdminReview } from '@/pages/admin/AdminReview';
import { AdminRules } from '@/pages/admin/AdminRules';
import { AdminSite } from '@/pages/admin/AdminSite';
import { AdminUsers } from '@/pages/admin/AdminUsers';
import { Home } from '@/pages/Home';
import { Mine } from '@/pages/Mine';
import { Music } from '@/pages/Music';
import { NotFound } from '@/pages/NotFound';
import { Notifications } from '@/pages/Notifications';
import { Overview } from '@/pages/Overview';
import { PostDetail } from '@/pages/PostDetail';
import { Profile } from '@/pages/Profile';
import { Ranking } from '@/pages/Ranking';
import { Settings } from '@/pages/Settings';
import { useAuth } from '@/store/auth';
import { useSite } from '@/store/site';

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const loadSite = useSite((s) => s.load);

  useEffect(() => {
    bootstrap();
    /* 站点配置必须在这里拉一次：注册/访客登录/身份验证/找回渠道的开关全靠它，
       之前漏了这一步，后台开了开关前台也看不到入口。 */
    loadSite();
  }, [bootstrap, loadSite]);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="post/:id" element={<PostDetail />} />
          <Route path="ranking" element={<Ranking />} />
          <Route path="music" element={<Music />} />
          <Route path="overview" element={<Overview />} />
          <Route
            path="mine"
            element={
              <RequireAuth title="登录后才能查看我的心事">
                <Mine />
              </RequireAuth>
            }
          />
          <Route
            path="profile"
            element={
              <RequireAuth title="登录后才能编辑个人信息">
                <Profile />
              </RequireAuth>
            }
          />
          {/* 常规偏好（主题/弹幕/留言）属于设备级设置，无需登录即可调整 */}
          <Route path="settings" element={<Settings />} />
          <Route
            path="notifications"
            element={
              <RequireAuth title="登录后才能查看站内信">
                <Notifications />
              </RequireAuth>
            }
          />
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="review" element={<AdminReview />} />
            <Route path="posts" element={<AdminPosts />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="notify" element={<AdminNotify />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="rules" element={<AdminRules />} />
            <Route path="site" element={<AdminSite />} />
            <Route path="music" element={<AdminMusic />} />
            <Route path="audit" element={<AdminAudit />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}