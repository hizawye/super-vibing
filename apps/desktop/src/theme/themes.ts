import type { ITheme } from "xterm";
import type { ThemeId } from "../types";

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  description: string;
  swatches: [string, string, string, string];
  terminal: ITheme;
}

export const THEME_IDS: ThemeId[] = [
  "apple-dark",
  "apple-light",
  "graphite",
  "midnight",
  "solarized",
  "nord",
];

export const DEFAULT_THEME_ID: ThemeId = "apple-dark";

export const THEME_DEFINITIONS: Record<ThemeId, ThemeDefinition> = {
  "apple-dark": {
    id: "apple-dark",
    label: "Apple Dark",
    description: "Balanced graphite surfaces with cool blue accents.",
    swatches: ["#101216", "#1a1e25", "#86b6ff", "#f1f4fb"],
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
    label: "Apple Light",
    description: "Soft paper-like light surfaces and precise contrast.",
    swatches: ["#f4f6fb", "#ffffff", "#1675e0", "#22252d"],
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
  graphite: {
    id: "graphite",
    label: "Graphite",
    description: "Neutral monochrome with restrained highlights.",
    swatches: ["#111315", "#1b1f23", "#8fa3b8", "#e9ecef"],
    terminal: {
      background: "#0f1216",
      foreground: "#e9ecef",
      cursor: "#f0f2f5",
      selectionBackground: "#4b5662",
      black: "#1a1f26",
      red: "#dd7272",
      green: "#86c893",
      yellow: "#c5b170",
      blue: "#90a7c2",
      magenta: "#b8a1cb",
      cyan: "#81bfc4",
      white: "#e8ebef",
      brightBlack: "#5b626d",
      brightRed: "#e58b8b",
      brightGreen: "#9fd5a7",
      brightYellow: "#d2be86",
      brightBlue: "#a2bbd8",
      brightMagenta: "#c7b4db",
      brightCyan: "#98d0d4",
      brightWhite: "#ffffff",
    },
  },
  midnight: {
    id: "midnight",
    label: "Midnight",
    description: "Deep blue-black framing for focused coding sessions.",
    swatches: ["#05070f", "#0d1424", "#4e88ff", "#dce7ff"],
    terminal: {
      background: "#060915",
      foreground: "#dce7ff",
      cursor: "#f4f8ff",
      selectionBackground: "#2554a2",
      black: "#10182a",
      red: "#ef6f82",
      green: "#72d89b",
      yellow: "#dac06f",
      blue: "#6d95ff",
      magenta: "#b28cff",
      cyan: "#62d7d7",
      white: "#dae3fb",
      brightBlack: "#3d527b",
      brightRed: "#ff8da0",
      brightGreen: "#8ceaaf",
      brightYellow: "#efd98f",
      brightBlue: "#8cb0ff",
      brightMagenta: "#c7abff",
      brightCyan: "#83ebeb",
      brightWhite: "#ffffff",
    },
  },
  solarized: {
    id: "solarized",
    label: "Solarized",
    description: "Warm balanced contrast inspired by classic Solarized.",
    swatches: ["#002b36", "#073642", "#268bd2", "#93a1a1"],
    terminal: {
      background: "#002b36",
      foreground: "#93a1a1",
      cursor: "#fdf6e3",
      selectionBackground: "#205a6d",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#93a1a1",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  nord: {
    id: "nord",
    label: "Nord",
    description: "Cool arctic palette with gentle contrast separation.",
    swatches: ["#2e3440", "#3b4252", "#88c0d0", "#e5e9f0"],
    terminal: {
      background: "#2b313d",
      foreground: "#d8dee9",
      cursor: "#eceff4",
      selectionBackground: "#4f5e79",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#d08770",
      brightGreen: "#b6d29d",
      brightYellow: "#f4d9a4",
      brightBlue: "#8fb3d9",
      brightMagenta: "#c89fc0",
      brightCyan: "#9fd5e3",
      brightWhite: "#eceff4",
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
