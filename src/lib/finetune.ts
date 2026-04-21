// [START] Fine-tuning API wrappers for sidecar endpoints.
import type { SidecarPorts } from "../types/sidecar";
import { DEFAULT_PORTS } from "./api";

function nativeBase(ports: SidecarPorts): string {
  return `http://127.0.0.1:${ports.native}`;
}

async function jsonOrThrow<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
  return resp.json() as Promise<T>;
}

// ── Types ───────────────────────────────────────────────────

export interface FTDataset {
  dataset_id: string;
  name: string;
  created_at: string;
  doc_count: number;
  qa_count: number;
}

export interface TrainingRun {
  run_id: string;
  adapter_name: string;
  base_model: string;
  dataset_name: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  progress: number;
  current_epoch: number;
  total_epochs: number;
  train_loss: number;
  valid_loss: number;
  elapsed_seconds: number;
  error: string | null;
}

export interface FTAdapter {
  adapter_id: string;
  name: string;
  base_model: string;
  dataset_name: string;
  size_bytes: number;
  created_at: string;
  merged: boolean;
}

// ── Dataset CRUD ────────────────────────────────────────────

export async function listDatasets(
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<FTDataset[]> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/ft/datasets`);
  return jsonOrThrow<FTDataset[]>(resp);
}

export async function createDataset(
  name: string,
  documents: { filename: string; full_text: string }[],
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ dataset_id: string; name: string; doc_count: number; qa_count: number }> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/ft/datasets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, documents }),
  });
  return jsonOrThrow(resp);
}

export async function deleteDataset(
  datasetId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ deleted: boolean }> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/ft/datasets/${datasetId}`, {
    method: "DELETE",
  });
  return jsonOrThrow(resp);
}

// ── Training ────────────────────────────────────────────────

export interface TrainRequest {
  adapter_name: string;
  base_model: string;
  dataset_id: string;
  epochs?: number;
  learning_rate?: number;
  lora_rank?: number;
  lora_layers?: number;
  batch_size?: number;
}

export async function startTraining(
  req: TrainRequest,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ run_id: string; adapter_name: string; status: string }> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/ft/train`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return jsonOrThrow(resp);
}

export async function getRunProgress(
  runId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<TrainingRun> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/ft/runs/${runId}`);
  return jsonOrThrow<TrainingRun>(resp);
}

export async function listRuns(
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<TrainingRun[]> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/ft/runs`);
  return jsonOrThrow<TrainingRun[]>(resp);
}

export async function cancelRun(
  runId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ cancelled: boolean }> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/ft/runs/${runId}/cancel`, {
    method: "POST",
  });
  return jsonOrThrow(resp);
}

// ── Adapter CRUD ────────────────────────────────────────────

export async function listAdapters(
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<FTAdapter[]> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/ft/adapters`);
  return jsonOrThrow<FTAdapter[]>(resp);
}

export async function deleteAdapter(
  adapterId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ deleted: boolean }> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/ft/adapters/${adapterId}`, {
    method: "DELETE",
  });
  return jsonOrThrow(resp);
}

export async function mergeAdapter(
  adapterId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ merged: boolean; model_path: string }> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/ft/adapters/${adapterId}/merge`, {
    method: "POST",
  });
  return jsonOrThrow(resp);
}
// [END]
