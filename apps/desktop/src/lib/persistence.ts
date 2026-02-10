import { Store } from "@tauri-apps/plugin-store";
import type { Blueprint, PersistedPayload, Snapshot, SnapshotState } from "../types";

const STORE_PATH = "super-vibing.json";
const VERSION = 1;

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_PATH, {
      autoSave: 250,
      defaults: {
        version: VERSION,
        snapshots: [],
        blueprints: [],
      },
    });
  }

  return storePromise;
}

export async function loadPersistedPayload(): Promise<PersistedPayload> {
  const store = await getStore();
  const version = (await store.get<number>("version")) ?? VERSION;
  const session = await store.get<SnapshotState>("session");
  const snapshots = (await store.get<Snapshot[]>("snapshots")) ?? [];
  const blueprints = (await store.get<Blueprint[]>("blueprints")) ?? [];

  return {
    version,
    session,
    snapshots,
    blueprints,
  };
}

export async function saveSessionState(state: SnapshotState): Promise<void> {
  const store = await getStore();
  await store.set("version", VERSION);
  await store.set("session", state);
  await store.save();
}

export async function saveSnapshots(snapshots: Snapshot[]): Promise<void> {
  const store = await getStore();
  await store.set("version", VERSION);
  await store.set("snapshots", snapshots);
  await store.save();
}

export async function saveBlueprints(blueprints: Blueprint[]): Promise<void> {
  const store = await getStore();
  await store.set("version", VERSION);
  await store.set("blueprints", blueprints);
  await store.save();
}
