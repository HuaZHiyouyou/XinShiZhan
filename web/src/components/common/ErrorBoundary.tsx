import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 顶层错误边界。
 *
 * 默认行为下，渲染期抛错会让 React 卸载整棵树，用户只能看到一片黑屏、
 * 完全不知道发生了什么。这里把崩溃接住，给出可读的说明与「重新加载」，
 * 并把真实错误留在控制台便于排查。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[xsz] 页面渲染出错：', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <AlertTriangle size={28} />
          <h1 className="crash-title">页面出了点问题</h1>
          <p className="crash-desc">
            这一屏没能正常渲染，你的数据不受影响。重新加载通常就能恢复；如果反复出现，
            请把下面的报错信息反馈给我们。
          </p>
          <pre className="crash-detail">{String(error?.message || error)}</pre>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              <RotateCcw size={14} /> 重新加载
            </button>
            <button type="button" className="btn" onClick={() => window.location.assign('/')}>
              回到首页
            </button>
          </div>
        </div>
      </div>
    );
  }
}
