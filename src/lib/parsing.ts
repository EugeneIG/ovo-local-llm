// [START] Parsing + Knowledge Base API wrappers for sidecar endpoints.
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

export interface KordocStatus {
  node_installed: boolean;
  kordoc_installed: boolean;
  node_version: string;
  node_path: string | null;
  kordoc_path: string | null;
  ready: boolean;
}

export interface ParsedSection {
  title: string;
  level: number;
  page: number | null;
}

export interface ParsedTable {
  page: number | null;
  rows: number;
  cols: number;
}

export interface ParseResult {
  doc_id: string;
  filename: string;
  mime: string;
  pages: number;
  tokens_estimate: number;
  full_text: string;
  sections: ParsedSection[];
  tables: ParsedTable[];
  warnings: string[];
}

export interface KnowledgeBase {
  kb_id: string;
  name: string;
  created_at: string;
  doc_count: number;
  chunk_count: number;
  embedder_model: string;
}

export interface KBDocument {
  doc_id: string;
  filename: string;
  mime: string;
  pages: number;
  tokens_estimate: number;
  parsed_at: string;
}

export interface KBDetail extends KnowledgeBase {
  documents: KBDocument[];
}

export interface IngestProgress {
  task_id: string;
  status: "pending" | "running" | "done" | "done_with_errors";
  progress: number;
  parsed: number;
  total: number;
  current_file: string;
  error: string | null;
}

export interface SearchResult {
  chunk_id: string;
  text: string;
  source: string;
  section: string;
}

export interface SearchResponse {
  kb_id: string;
  query: string;
  results: SearchResult[];
}

// ── Kordoc install ──────────────────────────────────────────

export async function getParseStatus(
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<KordocStatus> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/parse/status`);
  return jsonOrThrow<KordocStatus>(resp);
}

export async function installKordoc(
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ success: boolean; ready: boolean; events: Record<string, string>[] }> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/parse/install`, {
    method: "POST",
  });
  return jsonOrThrow(resp);
}

// ── Parse (one-shot) ────────────────────────────────────────

export async function parseFile(
  file: File,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<ParseResult> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${nativeBase(ports)}/ovo/parse`, {
    method: "POST",
    body: form,
  });
  return jsonOrThrow<ParseResult>(resp);
}

// ── Knowledge Base CRUD ─────────────────────────────────────

export async function createKB(
  name: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ kb_id: string; name: string; created_at: string }> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/kb`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return jsonOrThrow(resp);
}

export async function listKBs(
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<KnowledgeBase[]> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/kb`);
  return jsonOrThrow<KnowledgeBase[]>(resp);
}

export async function getKB(
  kbId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<KBDetail> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/kb/${kbId}`);
  return jsonOrThrow<KBDetail>(resp);
}

export async function deleteKB(
  kbId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ deleted: boolean }> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/kb/${kbId}`, {
    method: "DELETE",
  });
  return jsonOrThrow(resp);
}

// ── Ingest ──────────────────────────────────────────────────

export async function ingestFiles(
  kbId: string,
  paths: string[],
  recursive = true,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ task_id: string; total: number; status: string }> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/kb/${kbId}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths, recursive }),
  });
  return jsonOrThrow(resp);
}

export async function getIngestProgress(
  kbId: string,
  taskId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<IngestProgress> {
  const resp = await fetch(
    `${nativeBase(ports)}/ovo/kb/${kbId}/ingest/${taskId}`,
  );
  return jsonOrThrow<IngestProgress>(resp);
}

// ── Documents ───────────────────────────────────────────────

export async function listKBDocs(
  kbId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<KBDocument[]> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/kb/${kbId}/docs`);
  return jsonOrThrow<KBDocument[]>(resp);
}

export async function deleteKBDoc(
  kbId: string,
  docId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ deleted: boolean }> {
  const resp = await fetch(
    `${nativeBase(ports)}/ovo/kb/${kbId}/doc/${docId}`,
    { method: "DELETE" },
  );
  return jsonOrThrow(resp);
}

export async function getDocText(
  kbId: string,
  docId: string,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<{ doc_id: string; full_text: string }> {
  const resp = await fetch(
    `${nativeBase(ports)}/ovo/kb/${kbId}/doc/${docId}/text`,
  );
  return jsonOrThrow(resp);
}

// ── RAG Search ──────────────────────────────────────────────

export async function searchKB(
  kbId: string,
  query: string,
  topK = 5,
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<SearchResponse> {
  const resp = await fetch(`${nativeBase(ports)}/ovo/kb/${kbId}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: topK }),
  });
  return jsonOrThrow<SearchResponse>(resp);
}
// [END]
