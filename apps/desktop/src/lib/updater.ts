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

export function formatUpdaterError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    const normalized = message.toLowerCase();

    if (
      normalized.includes("network")
      || normalized.includes("fetch")
      || normalized.includes("dns")
      || normalized.includes("timed out")
      || normalized.includes("timeout")
    ) {
      return `Unable to reach the update endpoint. ${message}`;
    }

    if (
      normalized.includes("signature")
      || normalized.includes("pubkey")
      || normalized.includes("public key")
      || normalized.includes("minisign")
    ) {
      return `Update signature verification failed. ${message}`;
    }

    if (normalized.includes("json") || normalized.includes("parse")) {
      return `Release metadata is invalid. ${message}`;
    }

    if (message.length > 0) {
      return message;
    }
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  return fallback;
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
