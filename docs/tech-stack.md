# Tech Stack

- Core: Rust + Tauri v2, React, TypeScript
- Backend runtime:
  - `portable-pty` for native PTY instances
  - `tokio` runtime primitives
  - `tauri-plugin-store` and `tauri-plugin-opener`
- Frontend UI:
  - React + Vite
  - Tailwind CSS
  - Xterm.js + `@xterm/addon-fit`
  - `react-grid-layout` (+ `react-resizable`) for pane manager
- State:
  - Zustand
- Build tooling:
  - pnpm workspace
  - Cargo
