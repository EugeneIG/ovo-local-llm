import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SidecarStatus } from "../types/sidecar";

export interface AppInfo {
  name: string;
  version: string;
}

export const SIDECAR_STATUS_EVENT = "sidecar://status";
export const SIDECAR_BOOTSTRAP_LOG_EVENT = "sidecar://bootstrap/log";

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}

export async function getSidecarStatus(): Promise<SidecarStatus> {
  return invoke<SidecarStatus>("sidecar_status");
}

export async function restartSidecar(): Promise<void> {
  await invoke<void>("sidecar_restart");
}

export async function reinstallSidecarRuntime(): Promise<void> {
  await invoke<void>("sidecar_reinstall_runtime");
}

export function onSidecarStatus(
  handler: (status: SidecarStatus) => void,
): Promise<UnlistenFn> {
  return listen<SidecarStatus>(SIDECAR_STATUS_EVENT, (event) => handler(event.payload));
}

export function onSidecarBootstrapLog(
  handler: (line: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(SIDECAR_BOOTSTRAP_LOG_EVENT, (event) => handler(event.payload));
}
