import React from "react";
import ReactDOM from "react-dom/client";
import "xterm/css/xterm.css";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./styles.css";
import App from "./App";
import { StartupErrorBoundary } from "./components/StartupErrorBoundary";
import { useWorkspaceStore } from "./store/workspace";

declare global {
  interface Window {
    __superVibingStartupListenersRegistered?: boolean;
  }
}

function logStartupError(label: string, error: unknown): void {
  console.error(`[startup] ${label}`, error);
}

if (typeof window !== "undefined" && !window.__superVibingStartupListenersRegistered) {
  window.__superVibingStartupListenersRegistered = true;
  window.addEventListener("error", (event) => {
    logStartupError("window-error", event.error ?? event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    logStartupError("unhandled-rejection", event.reason);
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <StartupErrorBoundary
      onRetry={() => {
        useWorkspaceStore.getState().clearStartupError();
        void useWorkspaceStore.getState().bootstrap();
      }}
      onResetLocalData={async () => {
        await useWorkspaceStore.getState().resetLocalStateAndRebootstrap();
      }}
    >
      <App />
    </StartupErrorBoundary>
  </React.StrictMode>,
);
