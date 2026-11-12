import { Component, type ReactNode } from "react";

/**
 * 顶层错误边界：任何组件渲染抛错时不再白屏，
 * 显示错误信息与「重新加载」，失败必须看得见。
 */
export default class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-error">
          <div className="app-error-title">页面渲染出错</div>
          <div className="app-error-detail">{String(this.state.error.message || this.state.error)}</div>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
