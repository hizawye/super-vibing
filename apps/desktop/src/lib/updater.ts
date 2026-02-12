import { isTauri } from "@tauri-apps/api/core";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { restartApp } from "./tauri";

export interface PendingAppUpdate {
  handle: Update;
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
}

export function updatesSupported(): boolean {
  return isTauri();
}

export async function checkForPendingUpdate(): Promise<PendingAppUpdate | null> {
  if (!updatesSupported()) {
    return null;
  }

  const update = await check();
  if (!update) {
    return null;
  }

  return {
    handle: update,
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date,
    body: update.body,
  };
}

export async function installPendingUpdate(
  pending: PendingAppUpdate,
  onEvent?: (event: DownloadEvent) => void,
): Promise<void> {
  await pending.handle.downloadAndInstall(onEvent);
}

export async function closePendingUpdate(pending: PendingAppUpdate | null): Promise<void> {
  if (!pending) {
    return;
  }

  try {
    await pending.handle.close();
  } catch {
    // best effort resource cleanup
  }
}

export async function restartToApplyUpdate(): Promise<void> {
  if (!updatesSupported()) {
    return;
  }

  await restartApp();
}
