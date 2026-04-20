// [START] Phase 6.4 — Embedding HTTP client.
// Thin wrapper over the sidecar /ovo/embed endpoint. Keeps cosine similarity
// logic co-located with the encoder so call sites don't need to import math.

import { useSidecarStore } from "../store/sidecar";

export const DEFAULT_EMBEDDING_MODEL =
  "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";

export interface EmbedResponse {
  model: string;
  dim: number;
  embeddings: number[][];
}

export class EmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

/**
 * Encode a batch of texts through the sidecar. Returns null when the sidecar
 * port is not yet known (startup race) or when the endpoint returns 501 —
 * both are legitimate "fall back to FTS" signals rather than hard errors.
 */
export async function embedTexts(
  texts: string[],
  opts: { model?: string; normalize?: boolean } = {},
): Promise<EmbedResponse | null> {
  if (texts.length === 0) {
    return { model: opts.model ?? DEFAULT_EMBEDDING_MODEL, dim: 0, embeddings: [] };
  }
  const ports = useSidecarStore.getState().status.ports;
  const port = ports?.native;
  if (!port) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ovo/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts,
        model: opts.model ?? DEFAULT_EMBEDDING_MODEL,
        normalize: opts.normalize ?? true,
      }),
    });
    if (res.status === 501) return null; // sentence-transformers not installed
    if (!res.ok) {
      throw new EmbeddingUnavailableError(
        `embed failed: HTTP ${res.status}`,
      );
    }
    return (await res.json()) as EmbedResponse;
  } catch (e) {
    if (e instanceof EmbeddingUnavailableError) throw e;
    // Network / connection refused — treat as unavailable (null) so callers
    // degrade to FTS-only without surfacing a red toast.
    return null;
  }
}

/** Cosine similarity between two equal-length vectors. Returns 0 on mismatch. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    aNorm += x * x;
    bNorm += y * y;
  }
  const denom = Math.sqrt(aNorm) * Math.sqrt(bNorm);
  if (denom === 0) return 0;
  return dot / denom;
}
// [END] Phase 6.4
