import type { Store } from "@tauri-apps/plugin-store";
import type { Blueprint, PersistedPayload, SessionState, Snapshot } from "../types";

const STORE_PATH = "super-vibing.json";
const VERSION = 2;
const E2E_RUNTIME = import.meta.env.VITE_E2E === "1";
const STORE_DEFAULTS: Record<string, unknown> = {
  version: VERSION,
  snapshots: [],
  blueprints: [],
};

let storePromise: Promise<Store> | null = null;
let inMemoryPayload: PersistedPayload = createDefaultPayload();

function createDefaultPayload(): PersistedPayload {
  return {
    version: VERSION,
    session: undefined,
    snapshots: [],
    blueprints: [],
  };
}

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = import("@tauri-apps/plugin-store").then(({ Store }) => Store.load(STORE_PATH, {
      autoSave: 250,
      defaults: STORE_DEFAULTS,
    }));
  }

  return storePromise;
}

function loadInMemoryPayload(): PersistedPayload {
  return cloneValue(inMemoryPayload);
}

function saveInMemoryPayload(payload: PersistedPayload): void {
  inMemoryPayload = cloneValue(payload);
}

export async function loadPersistedPayload(): Promise<PersistedPayload> {
  if (E2E_RUNTIME) {
    return loadInMemoryPayload();
  }

  const store = await getStore();
  const version = (await store.get<number>("version")) ?? VERSION;
  const session = await store.get<SessionState>("session");
  const snapshots = (await store.get<Snapshot[]>("snapshots")) ?? [];
  const blueprints = (await store.get<Blueprint[]>("blueprints")) ?? [];

  return {
    version,
    session,
    snapshots,
    blueprints,
  };
}

export async function saveSessionState(state: SessionState): Promise<void> {
  if (E2E_RUNTIME) {
    saveInMemoryPayload({
      ...inMemoryPayload,
      version: VERSION,
      session: cloneValue(state),
    });
    return;
  }

  const store = await getStore();
  await store.set("version", VERSION);
  await store.set("session", state);
  await store.save();
}

export async function saveSnapshots(snapshots: Snapshot[]): Promise<void> {
  if (E2E_RUNTIME) {
    saveInMemoryPayload({
      ...inMemoryPayload,
      version: VERSION,
      snapshots: cloneValue(snapshots),
    });
    return;
  }

  const store = await getStore();
  await store.set("version", VERSION);
  await store.set("snapshots", snapshots);
  await store.save();
}

export async function saveBlueprints(blueprints: Blueprint[]): Promise<void> {
  if (E2E_RUNTIME) {
    saveInMemoryPayload({
      ...inMemoryPayload,
      version: VERSION,
      blueprints: cloneValue(blueprints),
    });
    return;
  }

  const store = await getStore();
  await store.set("version", VERSION);
  await store.set("blueprints", blueprints);
  await store.save();
}

export async function resetPersistedPayload(): Promise<void> {
  if (E2E_RUNTIME) {
    inMemoryPayload = createDefaultPayload();
    return;
  }

  const store = await getStore();
  await store.reset();
  await store.save();
}
