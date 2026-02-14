import type { ITheme } from "xterm";
import type { ThemeId } from "../types";

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  description: string;
  swatches: [string, string, string, string];
  terminal: ITheme;
}

export const THEME_IDS: ThemeId[] = ["apple-dark", "apple-light"];

export const DEFAULT_THEME_ID: ThemeId = "apple-dark";

export const THEME_DEFINITIONS: Record<ThemeId, ThemeDefinition> = {
  "apple-dark": {
    id: "apple-dark",
    label: "Dark",
    description: "Compact dark palette with clean contrast.",
    swatches: ["#0f172a", "#111827", "#3b82f6", "#e2e8f0"],
    terminal: {
      background: "#090b10",
      foreground: "#f1f4fb",
      cursor: "#f7f8fc",
      selectionBackground: "#3f7dd5",
      black: "#161a22",
      red: "#f06a6a",
      green: "#7cd67e",
      yellow: "#e2ca6a",
      blue: "#79aef8",
      magenta: "#cc90f2",
      cyan: "#71c9e2",
      white: "#edf1fa",
      brightBlack: "#4f5668",
      brightRed: "#ff8a8a",
      brightGreen: "#95e79b",
      brightYellow: "#f4dc84",
      brightBlue: "#97c5ff",
      brightMagenta: "#dda9ff",
      brightCyan: "#95def3",
      brightWhite: "#ffffff",
    },
  },
  "apple-light": {
    id: "apple-light",
    label: "Light",
    description: "Clean light palette with crisp text hierarchy.",
    swatches: ["#f8fafc", "#ffffff", "#2563eb", "#1f2937"],
    terminal: {
      background: "#ffffff",
      foreground: "#1d2430",
      cursor: "#1c212a",
      selectionBackground: "#c9def9",
      black: "#2a2f3a",
      red: "#c73737",
      green: "#1f7a43",
      yellow: "#916e17",
      blue: "#1a66cf",
      magenta: "#8d4ac7",
      cyan: "#007896",
      white: "#f4f7fd",
      brightBlack: "#596174",
      brightRed: "#dc5656",
      brightGreen: "#349a5a",
      brightYellow: "#a7842d",
      brightBlue: "#2f7be5",
      brightMagenta: "#a063da",
      brightCyan: "#1c8fad",
      brightWhite: "#ffffff",
    },
  },
};

export function isThemeId(value: string): value is ThemeId {
  return THEME_IDS.includes(value as ThemeId);
}

export function resolveTerminalTheme(themeId: ThemeId, highContrastAssist: boolean): ITheme {
  const base = THEME_DEFINITIONS[themeId].terminal;
  if (!highContrastAssist) {
    return base;
  }

  return {
    ...base,
    cursor: "#ffffff",
    selectionBackground: "#4a8cff",
    brightWhite: "#ffffff",
  };
}
