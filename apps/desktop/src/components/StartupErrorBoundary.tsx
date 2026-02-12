import type { ReactNode } from "react";
import { Component } from "react";
import { StartupCrashScreen } from "./StartupCrashScreen";

interface StartupErrorBoundaryProps {
  children: ReactNode;
  onRetry?: () => void;
  onResetLocalData?: () => Promise<void> | void;
}

interface StartupErrorBoundaryState {
  error: Error | null;
}

export class StartupErrorBoundary extends Component<StartupErrorBoundaryProps, StartupErrorBoundaryState> {
  constructor(props: StartupErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): StartupErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error("[startup] render failure", error, info);
  }

  private retryRender = (): void => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  private resetLocalData = (): void => {
    void Promise.resolve(this.props.onResetLocalData?.())
      .then(() => {
        this.setState({ error: null });
      })
      .catch((error) => {
        this.setState({
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  };

  render() {
    if (this.state.error) {
      const details = this.state.error.stack ?? this.state.error.message;
      return (
        <main className="app-shell app-loading">
          <StartupCrashScreen
            title="Render failed"
            message="SuperVibing crashed while rendering the UI."
            details={details}
            onRetry={this.retryRender}
            onResetLocalData={this.props.onResetLocalData ? this.resetLocalData : undefined}
          />
        </main>
      );
    }

    return this.props.children;
  }
}
