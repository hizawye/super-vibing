import { describe, expect, it } from "vitest";
import { normalizeSectionPath, pathToSection, sectionToPath } from "./section-routes";

describe("section routes", () => {
  it("maps sections to canonical paths", () => {
    expect(sectionToPath("terminal")).toBe("/terminal");
    expect(sectionToPath("git")).toBe("/git");
    expect(sectionToPath("worktrees")).toBe("/worktrees");
    expect(sectionToPath("kanban")).toBe("/kanban");
    expect(sectionToPath("settings")).toBe("/settings");
  });

  it("maps paths to sections with trailing slash normalization", () => {
    expect(pathToSection("/terminal")).toBe("terminal");
    expect(pathToSection("/git/")).toBe("git");
    expect(pathToSection("/worktrees/")).toBe("worktrees");
    expect(pathToSection("/kanban")).toBe("kanban");
  });

  it("normalizes unknown paths to terminal", () => {
    expect(pathToSection("/unknown")).toBeNull();
    expect(normalizeSectionPath("/unknown")).toBe("/terminal");
  });
});
