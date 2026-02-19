import type { AppSection } from "../types";

const SECTION_PATHS: Record<AppSection, string> = {
  terminal: "/terminal",
  git: "/git",
  worktrees: "/worktrees",
  kanban: "/kanban",
  agents: "/agents",
  prompts: "/prompts",
  settings: "/settings",
};

const PATH_SECTIONS = new Map<string, AppSection>(
  Object.entries(SECTION_PATHS).map(([section, path]) => [path, section as AppSection]),
);

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/";
}

export function sectionToPath(section: AppSection): string {
  return SECTION_PATHS[section] ?? SECTION_PATHS.terminal;
}

export function pathToSection(pathname: string): AppSection | null {
  const normalized = normalizePathname(pathname);
  return PATH_SECTIONS.get(normalized) ?? null;
}

export function normalizeSectionPath(pathname: string): string {
  const section = pathToSection(pathname);
  return section ? sectionToPath(section) : SECTION_PATHS.terminal;
}
