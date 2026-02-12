import { beforeEach, describe, expect, it, vi } from "vitest";

describe("persistence reset", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("resets and saves the persisted store", async () => {
    const reset = vi.fn(async () => {});
    const save = vi.fn(async () => {});
    const load = vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      reset,
      save,
    }));

    vi.doMock("@tauri-apps/plugin-store", () => ({
      Store: {
        load,
      },
    }));

    const persistence = await import("./persistence");
    await persistence.resetPersistedPayload();

    expect(load).toHaveBeenCalledWith(
      "super-vibing.json",
      expect.objectContaining({
        autoSave: 250,
      }),
    );
    expect(reset).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
