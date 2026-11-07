import { Component } from "react";

/**
 * Catches render errors in a route subtree so one broken page does not
 * blank the entire Capacitor WebView (no bottom nav, no recovery UI).
 */
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[RouteErrorBoundary]", error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
    if (typeof this.props.onRetry === "function") {
      this.props.onRetry();
    } else if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.error) {
      return (
        <main className="auth-screen">
          <div className="auth-card">
            <h2 className="section-title">Something went wrong</h2>
            <p className="caption" style={{ margin: "8px 0 16px" }}>
              {this.state.error?.message || "This screen failed to load."}
            </p>
            <div className="stack">
              <button type="button" className="btn-primary" onClick={this.handleRetry}>
                Reload screen
              </button>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
