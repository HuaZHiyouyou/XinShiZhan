import { createRoot } from 'react-dom/client';
import App from '@/App';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import '@/styles/base.css';
import '@/styles/background.css';
import '@/styles/layout.css';
import '@/styles/post.css';
import '@/styles/danmaku.css';
import '@/styles/pages.css';
import '@/styles/admin.css';
import '@/styles/motion.css';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');

/* 包一层错误边界：任何渲染期异常都给出可读提示，而不是让用户面对一片黑屏 */
createRoot(container).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);