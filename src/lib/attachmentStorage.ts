// [START] Phase A — Attachment Preprocessor: file persistence via tauri-plugin-fs.
// Saves uploaded File blobs to the app data dir so attachments survive reloads.
// All paths are relative to the app data dir root (e.g. "attachments/{uuid}.jpg").

import {
  mkdir,
  remove,
  readFile,
  readDir,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface StoredAttachmentMeta {
  id: string;
  filename: string; // original filename
  mime: string;
  size: number;
  relativePath: string; // e.g. "attachments/{uuid}.jpg"
}

const ATTACHMENT_DIR = "attachments";
const BASE_DIR = BaseDirectory.AppData;

/** Ensure the attachments subdirectory exists. */
async function ensureDir(): Promise<void> {
  await mkdir(ATTACHMENT_DIR, { baseDir: BASE_DIR, recursive: true });
}

/** Derive file extension from MIME or original filename (fallback). */
function extFromMime(mime: string, filename: string): string {
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/svg+xml": "svg",
  };
  if (extMap[mime]) return extMap[mime];
  const dot = filename.lastIndexOf(".");
  return dot !== -1 ? filename.slice(dot + 1) : "bin";
}

/**
 * Save a File blob to disk under the app data dir.
 * Returns metadata that can be persisted to the DB instead of the blob.
 */
export async function saveAttachment(file: File): Promise<StoredAttachmentMeta> {
  await ensureDir();

  const uuid = crypto.randomUUID();
  const ext = extFromMime(file.type, file.name);
  const relativePath = `${ATTACHMENT_DIR}/${uuid}.${ext}`;

  // Read File as ArrayBuffer then write as Uint8Array
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // writeFile requires an absolute-ish path under the base dir;
  // tauri-plugin-fs writeFile API accepts path + baseDir option.
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(relativePath, bytes, { baseDir: BASE_DIR });

  return {
    id: uuid,
    filename: file.name,
    mime: file.type,
    size: file.size,
    relativePath,
  };
}

/**
 * Read the stored file back as a base64 data URL for sidecar consumption.
 */
export async function readAttachmentAsDataUrl(
  meta: StoredAttachmentMeta,
): Promise<string> {
  const bytes = await readFile(meta.relativePath, { baseDir: BASE_DIR });
  // Convert Uint8Array → base64
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const b64 = btoa(binary);
  const mime = meta.mime || "application/octet-stream";
  return `data:${mime};base64,${b64}`;
}

/**
 * Tauri asset URL for <img src>. Resolves the stored file as a convertFileSrc
 * URL so it survives reload (the file is on disk, not in memory).
 */
export function attachmentSrcUrl(meta: StoredAttachmentMeta): string {
  // convertFileSrc expects a full filesystem path; we build it using the
  // well-known AppData path pattern. At runtime the Tauri asset protocol
  // will serve it from the actual app-data dir.
  // We build a tauri://localhost/path URI via convertFileSrc with a
  // synthesized absolute path. Since we only have the relative path, we
  // use a workaround: return the data URL approach lazily or use the
  // Tauri-specific asset:// scheme which plugin-fs assets use.
  // The safest cross-platform approach: store a data URL as the src, computed
  // at render time. For <img> in chat history, we embed a small cache via
  // the object URL or convertFileSrc with the actual absolute path resolved
  // at boot. Instead, expose a reactive hook pattern: return a special
  // tauri:// URI using the plugin's asset serving.
  //
  // tauri-plugin-fs v2 serves files via the asset protocol when listed in
  // capabilities scope. The URL format is:
  //   https://asset.localhost/<absolute-path>  (on macOS/Linux)
  // We construct it via convertFileSrc with a placeholder; the real usage
  // should call resolveAttachmentSrcUrl() which is async.
  //
  // Provide a synchronous best-effort URL; callers that need reliability use
  // readAttachmentAsDataUrl() instead.
  return convertFileSrc(meta.relativePath, "stream");
}

/**
 * Resolve a Tauri asset:// URL for the stored attachment.
 * Uses @tauri-apps/api/path to get the real AppData path then convertFileSrc.
 */
export async function resolveAttachmentSrcUrl(
  meta: StoredAttachmentMeta,
): Promise<string> {
  const { appDataDir } = await import("@tauri-apps/api/path");
  const base = await appDataDir();
  const fullPath = await join(base, meta.relativePath);
  return convertFileSrc(fullPath);
}

/**
 * Remove a stored file from disk. Silent on missing files.
 */
export async function deleteAttachment(relativePath: string): Promise<void> {
  try {
    await remove(relativePath, { baseDir: BASE_DIR });
  } catch {
    // File already gone or never written — ignore.
  }
}

/**
 * Scan the attachments directory on disk; delete any files whose relativePath
 * is not in the provided set of DB-referenced paths.
 * Returns the number of orphaned files deleted.
 */
export async function garbageCollectAttachments(
  referencedPaths: Set<string>,
): Promise<number> {
  try {
    await ensureDir();
    const entries = await readDir(ATTACHMENT_DIR, { baseDir: BASE_DIR });
    let deleted = 0;
    for (const entry of entries) {
      if (!entry.isFile) continue;
      const relPath = `${ATTACHMENT_DIR}/${entry.name}`;
      if (!referencedPaths.has(relPath)) {
        await deleteAttachment(relPath);
        deleted++;
      }
    }
    return deleted;
  } catch {
    // Dir may not exist yet on first run — not an error.
    return 0;
  }
}
// [END]
