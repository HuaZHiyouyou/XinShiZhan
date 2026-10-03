import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { GlobalAudio } from '@/components/music/GlobalAudio';
import { MusicDock } from '@/components/music/MusicDock';
import { AuthGate } from '@/components/common/AuthGate';
import { ConfirmHost } from '@/components/common/ConfirmHost';
import { NotificationLetter } from '@/components/common/NotificationLetter';
import { NotificationPopup } from '@/components/common/NotificationPopup';
import { Toaster } from '@/components/common/Toaster';
import { Backdrop } from '@/components/fx/Backdrop';
import { FxWatchdog } from '@/components/fx/FxWatchdog';
import { RouteProgress, RouteTransition } from '@/components/layout/RouteTransition';
import { SideRail } from '@/components/layout/SideRail';
import { TopBar } from '@/components/layout/TopBar';
import { CommentDrawer } from '@/components/post/CommentDrawer';
import { useMusic } from '@/store/music';
import { useAuth } from '@/store/auth';
import { startNotificationSync, useNotifications } from '@/store/notifications';
import { useSite } from '@/store/site';

export function AppShell() {
  const loadTracks = useMusic((s) => s.load);
  const announcement = useSite((s) => s.config.announcement);
  const user = useAuth((s) => s.user);
  const clearNotifications = useNotifications((s) => s.reset);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  /* 登录期间让站内信自己动起来：定时拉取 + 回到前台立刻补一次 */
  useEffect(() => {
    if (!user) {
      clearNotifications();
      return undefined;
    }
    return startNotificationSync();
  }, [user?.id, clearNotifications]);

  return (
    <div className="app-shell">
      <RouteProgress />
      <Backdrop />
      <FxWatchdog />
      <TopBar />
      <div className="app-body">
        <SideRail />
        <main className="app-main">
          {announcement.trim() && (
            <div className="site-announcement" role="status">
              <Megaphone size={14} />
              <span>{announcement}</span>
            </div>
          )}
          <RouteTransition>
            <Outlet />
          </RouteTransition>
        </main>
      </div>

      <GlobalAudio />
      <MusicDock />
      <CommentDrawer />

      <Toaster />
      <ConfirmHost />
      <NotificationLetter />
      <NotificationPopup />
      <AuthGate />
    </div>
  );
}