// [START] Phase 8 — Voice I/O helpers.
// Recording is delegated to the sidecar Python process (sounddevice/CoreAudio)
// to avoid Tauri WebView's secure-context restriction on navigator.mediaDevices.
// TTS calls /ovo/audio/tts (macOS `say`) and plays the returned AIFF blob.

import { DEFAULT_PORTS } from "./api";
import type { SidecarPorts } from "../types/sidecar";

function nativeBase(ports: SidecarPorts = DEFAULT_PORTS): string {
  return `http://127.0.0.1:${ports.native}`;
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg);
  }
}

// --- Microphone recording (sidecar-side via sounddevice/CoreAudio) ---

export async function startRecording(
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<void> {
  const res = await fetch(`${nativeBase(ports)}/ovo/audio/record/start`, {
    method: "POST",
  });
  await throwIfNotOk(res);
}

export async function stopRecordingAndTranscribe(
  ports: SidecarPorts = DEFAULT_PORTS,
): Promise<string> {
  const res = await fetch(`${nativeBase(ports)}/ovo/audio/record/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  await throwIfNotOk(res);
  const data = (await res.json()) as { text: string };
  return data.text.trim();
}

export function cancelRecording(ports: SidecarPorts = DEFAULT_PORTS): void {
  fetch(`${nativeBase(ports)}/ovo/audio/record/cancel`, { method: "POST" }).catch(
    () => {},
  );
}

// --- TTS playback ---
let _ttsAudio: HTMLAudioElement | null = null;

export async function speakText(
  text: string,
  ports: SidecarPorts = DEFAULT_PORTS,
  voice?: string,
): Promise<void> {
  cancelTts();
  const res = await fetch(`${nativeBase(ports)}/ovo/audio/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Omit `voice` → sidecar auto-picks from text script (Hangul→Yuna, etc.)
    body: JSON.stringify(voice ? { text, voice } : { text }),
  });
  await throwIfNotOk(res);
  const data = (await res.json()) as { audio: string; format: string };
  const audio = new Audio(`data:audio/${data.format};base64,${data.audio}`);
  _ttsAudio = audio;
  await audio.play();
}

export function cancelTts(): void {
  if (_ttsAudio) {
    _ttsAudio.pause();
    _ttsAudio = null;
  }
}
// [END]
