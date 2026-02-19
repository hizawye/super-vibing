import type { Store } from "@tauri-apps/plugin-store";
import type { Blueprint, PersistedPayload, SessionState, Snapshot } from "../types";

const STORE_PATH = "super-vibing.json";
const VERSION = 2;
const IS_E2E = import.meta.env.VITE_E2E === "1";
const E2E_STORAGE_KEY = "super-vibing:e2e-payload";

let storePromise: Promise<Store> | null = null;

function createDefaultPayload(): PersistedPayload {
  return {
    version: VERSION,
    snapshots: [],
    blueprints: [],
  };
}

function readE2ePayload(): PersistedPayload {
  if (typeof window === "undefined") {
    return createDefaultPayload();
  }

  try {
    const raw = window.localStorage.getItem(E2E_STORAGE_KEY);
    if (!raw) {
      return createDefaultPayload();
    }

    const parsed = JSON.parse(raw) as Partial<PersistedPayload>;
    const session = parsed.session && typeof parsed.session === "object"
      ? parsed.session
      : undefined;

    return {
      version: typeof parsed.version === "number" ? parsed.version : VERSION,
      session,
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      blueprints: Array.isArray(parsed.blueprints) ? parsed.blueprints : [],
    };
  } catch {
    return createDefaultPayload();
  }
}

function writeE2ePayload(payload: PersistedPayload): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(E2E_STORAGE_KEY, JSON.stringify(payload));
}

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = (async () => {
      const { Store } = await import("@tauri-apps/plugin-store");
      return Store.load(STORE_PATH, {
        autoSave: 250,
        defaults: {
          version: VERSION,
          snapshots: [],
          blueprints: [],
        },
      });
    })();
  }

  return storePromise;
}

export async function loadPersistedPayload(): Promise<PersistedPayload> {
  if (IS_E2E) {
    return readE2ePayload();
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
  if (IS_E2E) {
    const payload = readE2ePayload();
    writeE2ePayload({
      ...payload,
      version: VERSION,
      session: state,
    });
    return;
  }

  const store = await getStore();
  await store.set("version", VERSION);
  await store.set("session", state);
  await store.save();
}

export async function saveSnapshots(snapshots: Snapshot[]): Promise<void> {
  if (IS_E2E) {
    const payload = readE2ePayload();
    writeE2ePayload({
      ...payload,
      version: VERSION,
      snapshots,
    });
    return;
  }

  const store = await getStore();
  await store.set("version", VERSION);
  await store.set("snapshots", snapshots);
  await store.save();
}

export async function saveBlueprints(blueprints: Blueprint[]): Promise<void> {
  if (IS_E2E) {
    const payload = readE2ePayload();
    writeE2ePayload({
      ...payload,
      version: VERSION,
      blueprints,
    });
    return;
  }

  const store = await getStore();
  await store.set("version", VERSION);
  await store.set("blueprints", blueprints);
  await store.save();
}

export async function resetPersistedPayload(): Promise<void> {
  if (IS_E2E) {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(E2E_STORAGE_KEY);
    }
    return;
  }

  const store = await getStore();
  await store.reset();
  await store.save();
}
