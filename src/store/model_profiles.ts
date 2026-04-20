import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useProjectContextStore } from "./project_context";

// [START] Phase 8 — Persona store, md-backed.
// Personas live as `<project_path>/.ovo/personas/<id>.md` with YAML-ish
// frontmatter (id / name / emoji / user_honorific / sampling / model_ref /
// system_prompt_extra) and the body as the persona prompt text. On first
// launch the 5 built-in personas are auto-seeded so the user always has a
// starting catalog; after that, everything is in-place editable from disk.
// Active id is persisted in localStorage so chat.ts can resolve the active
// profile synchronously on every send.
//
// Back-compat: older builds stored user profiles in `ovo:model_profiles`
// localStorage key. We migrate those to md files on first rescan then clear
// the LS entry — a one-shot bump, no UI churn.

export interface ProfileSampling {
  temperature?: number;
  top_p?: number;
  repetition_penalty?: number;
  max_tokens?: number | null;
}

export interface ModelProfile {
  id: string;
  name: string;
  emoji?: string;
  persona?: string;
  user_honorific?: string;
  model_ref?: string | null;
  sampling?: ProfileSampling;
  system_prompt_extra?: string;
  /** Absolute path on disk; undefined for in-memory fallback only */
  path?: string;
  /** Whether this id matches a seedable built-in template */
  builtin?: boolean;
}

const LS_ACTIVE = "ovo:model_profile_active";
const LS_LEGACY_PROFILES = "ovo:model_profiles";
const LS_SEEDED = "ovo:personas_seeded";

// Ids that can be "reset to default" — regardless of whether the md file was edited
// [START] Phase 8 — built-in persona catalog (code removed, IDE has its own).
// Code editing now lives in the dedicated Code pane with its own agent +
// model + sampling — keeping a duplicate "코드" persona in the main chat
// selector just adds confusion. Research / Speed / Creative stay because
// they genuinely reshape the *chat* behaviour (temperature, tone). Default
// is the no-op fallthrough that passes the raw model through untouched.
// Emojis are kept in the .md frontmatter / user-edited profiles but the
// selector UI now hides them per request so the menu reads as plain text.
export const BUILTIN_IDS = new Set(["default", "research", "speed", "creative"]);

// [START] Phase R — i18n helper for built-in profile display.
// Built-in templates store a Korean `name` as their canonical identifier
// (matches the md frontmatter written to disk), but the selector dropdown
// should render the localized label in the user's current language.
// Pass the t() function from react-i18next.
export function displayProfileName(
  p: Pick<ModelProfile, "id" | "name" | "builtin">,
  t: (key: string) => string,
): string {
  if (p.builtin && BUILTIN_IDS.has(p.id)) {
    const key = `chat.profile.builtin_names.${p.id}`;
    const localized = t(key);
    if (localized && localized !== key) return localized;
  }
  return p.name;
}
// [END]

const BUILTIN_TEMPLATES: ModelProfile[] = [
  {
    id: "default",
    name: "Free chat",
    emoji: "💬",
    builtin: true,
  },
  {
    id: "research",
    name: "Research",
    emoji: "🔬",
    persona:
      "You are a research assistant that prioritizes accuracy and evidence. Cite sources when possible and explicitly mark uncertain claims.",
    sampling: { temperature: 0.3, top_p: 0.9, repetition_penalty: 1.1 },
    builtin: true,
  },
  {
    id: "speed",
    name: "Speed",
    emoji: "⚡",
    persona: "Be brief and to the point. Skip unnecessary introductions and conclusions.",
    sampling: { temperature: 0.7, top_p: 0.95, repetition_penalty: 1.05, max_tokens: 512 },
    builtin: true,
  },
  {
    id: "creative",
    name: "Creative",
    emoji: "✍️",
    persona: "You are a creative writer. Use vivid descriptions, diverse vocabulary, and unexpected narrative turns.",
    sampling: { temperature: 1.0, top_p: 0.95, repetition_penalty: 1.1 },
    builtin: true,
  },
];
// [END]

interface RustMdFile {
  name: string;
  path: string;
  content: string;
  size_bytes: number;
}

interface RustMdDirResult {
  files: RustMdFile[];
}

interface ModelProfilesState {
  profiles: ModelProfile[];
  activeId: string;
  loading: boolean;
  last_folder: string | null;
  last_error: string | null;

  load: () => void;
  rescan: () => Promise<void>;
  setActive: (id: string) => void;
  upsert: (p: ModelProfile) => Promise<void>;
  remove: (id: string) => Promise<void>;
  resetToBuiltin: (id: string) => Promise<void>;
  getActive: () => ModelProfile | null;
}

// ── Active-id persistence (chat.ts needs sync access) ────────────────────────

function readActive(): string {
  try {
    return localStorage.getItem(LS_ACTIVE) || "default";
  } catch {
    return "default";
  }
}

function writeActive(id: string): void {
  try {
    localStorage.setItem(LS_ACTIVE, id);
  } catch {
    /* ignore */
  }
}

// ── Frontmatter parsing (flat scalars only — multi-line prompt goes in body) ─

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/;

function parseScalar(raw: string): string | number | null {
  let v = raw.trim();
  if (!v || v.toLowerCase() === "null" || v === "~") return null;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

interface ParsedPersona {
  fm: Record<string, string | number | null>;
  body: string;
}

function parsePersonaContent(content: string): ParsedPersona {
  const match = content.match(FRONTMATTER_RE);
  const fm: Record<string, string | number | null> = {};
  let body = content;
  if (match) {
    body = content.slice(match[0].length);
    for (const rawLine of match[1].split(/\r?\n/)) {
      const idx = rawLine.indexOf(":");
      if (idx === -1) continue;
      const key = rawLine.slice(0, idx).trim().toLowerCase();
      if (!key) continue;
      fm[key] = parseScalar(rawLine.slice(idx + 1));
    }
  }
  return { fm, body: body.trim() };
}

function mdToProfile(file: RustMdFile): ModelProfile | null {
  const { fm, body } = parsePersonaContent(file.content);
  const fallbackId = file.name.replace(/\.(md|markdown)$/i, "");
  const id = typeof fm.id === "string" && fm.id.length > 0 ? fm.id : fallbackId;
  const name = typeof fm.name === "string" && fm.name.length > 0 ? fm.name : id;
  if (!id || !name) return null;

  const sampling: ProfileSampling = {};
  if (typeof fm.temperature === "number") sampling.temperature = fm.temperature;
  if (typeof fm.top_p === "number") sampling.top_p = fm.top_p;
  if (typeof fm.repetition_penalty === "number")
    sampling.repetition_penalty = fm.repetition_penalty;
  if (fm.max_tokens === null) sampling.max_tokens = null;
  else if (typeof fm.max_tokens === "number") sampling.max_tokens = fm.max_tokens;

  return {
    id,
    name,
    emoji: typeof fm.emoji === "string" ? fm.emoji : undefined,
    persona: body.length > 0 ? body : undefined,
    user_honorific: typeof fm.user_honorific === "string" ? fm.user_honorific : undefined,
    model_ref:
      typeof fm.model_ref === "string"
        ? fm.model_ref
        : fm.model_ref === null
          ? null
          : undefined,
    sampling: Object.keys(sampling).length > 0 ? sampling : undefined,
    system_prompt_extra:
      typeof fm.system_prompt_extra === "string" ? fm.system_prompt_extra : undefined,
    path: file.path,
    builtin: BUILTIN_IDS.has(id),
  };
}

// ── Serialization ────────────────────────────────────────────────────────────

function serializeFrontmatterValue(v: string | number | null | undefined): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (s === "") return '""';
  // Quote when the value could collide with YAML-ish parsing
  if (/[:#\n"']/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

function serializePersona(p: ModelProfile): string {
  const fields: Array<[string, string | number | null | undefined]> = [
    ["id", p.id],
    ["name", p.name],
    ["emoji", p.emoji ?? ""],
    ["user_honorific", p.user_honorific ?? ""],
    ["temperature", p.sampling?.temperature ?? null],
    ["top_p", p.sampling?.top_p ?? null],
    ["repetition_penalty", p.sampling?.repetition_penalty ?? null],
    ["max_tokens", p.sampling?.max_tokens ?? null],
    ["model_ref", p.model_ref ?? null],
    ["system_prompt_extra", p.system_prompt_extra ?? ""],
  ];
  const lines = ["---"];
  for (const [k, v] of fields) {
    lines.push(`${k}: ${serializeFrontmatterValue(v)}`);
  }
  lines.push("---");
  lines.push("");
  lines.push((p.persona ?? "").trim());
  lines.push("");
  return lines.join("\n");
}

// ── Filesystem layout ────────────────────────────────────────────────────────

function resolvePersonasFolder(): string | null {
  const projectPath = useProjectContextStore.getState().project_path;
  if (!projectPath) return null;
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  return `${trimmed}/.ovo/personas`;
}

function personaPath(id: string): string | null {
  const folder = resolvePersonasFolder();
  if (!folder) return null;
  return `${folder}/${id}.md`;
}

async function readPersonasDir(folder: string): Promise<RustMdFile[]> {
  try {
    const result = await invoke<RustMdDirResult>("read_md_dir", { path: folder });
    return result.files;
  } catch {
    return [];
  }
}

async function writePersonaFile(path: string, content: string): Promise<void> {
  await invoke("write_md_file", { path, content });
}

async function deletePersonaFile(path: string): Promise<void> {
  await invoke("delete_md_file", { path });
}

// ── Built-in seeding (one-shot per project) ──────────────────────────────────

async function seedBuiltinsIfNeeded(): Promise<boolean> {
  const folder = resolvePersonasFolder();
  if (!folder) return false;
  const marker = `${LS_SEEDED}:${folder}`;
  try {
    if (localStorage.getItem(marker) === "1") return false;
  } catch {
    /* ignore */
  }
  // Only seed when the directory is empty — never clobber user edits
  const existing = await readPersonasDir(folder);
  if (existing.length > 0) {
    try {
      localStorage.setItem(marker, "1");
    } catch {
      /* ignore */
    }
    return false;
  }
  for (const tpl of BUILTIN_TEMPLATES) {
    const p = `${folder}/${tpl.id}.md`;
    try {
      await writePersonaFile(p, serializePersona(tpl));
    } catch (e) {
      console.warn("personas: seed failed", tpl.id, e);
    }
  }
  try {
    localStorage.setItem(marker, "1");
  } catch {
    /* ignore */
  }
  return true;
}

// ── Legacy localStorage migration ────────────────────────────────────────────

async function migrateLegacyProfiles(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LS_LEGACY_PROFILES);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(LS_LEGACY_PROFILES);
      return;
    }
    const folder = resolvePersonasFolder();
    if (!folder) return;
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const id = typeof e.id === "string" ? e.id : "";
      const name = typeof e.name === "string" ? e.name : "";
      if (!id || !name || BUILTIN_IDS.has(id)) continue;
      const profile: ModelProfile = {
        id,
        name,
        emoji: typeof e.emoji === "string" ? e.emoji : undefined,
        persona: typeof e.persona === "string" ? e.persona : undefined,
        user_honorific:
          typeof e.user_honorific === "string" ? e.user_honorific : undefined,
        model_ref: typeof e.model_ref === "string" ? e.model_ref : null,
        sampling:
          e.sampling && typeof e.sampling === "object"
            ? (e.sampling as ProfileSampling)
            : undefined,
        system_prompt_extra:
          typeof e.system_prompt_extra === "string" ? e.system_prompt_extra : undefined,
      };
      try {
        await writePersonaFile(`${folder}/${id}.md`, serializePersona(profile));
      } catch (err) {
        console.warn("personas: legacy migration failed", id, err);
      }
    }
  } finally {
    try {
      localStorage.removeItem(LS_LEGACY_PROFILES);
    } catch {
      /* ignore */
    }
  }
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useModelProfilesStore = create<ModelProfilesState>((set, get) => ({
  profiles: BUILTIN_TEMPLATES,
  activeId: "default",
  loading: false,
  last_folder: null,
  last_error: null,

  load: () => {
    const active = readActive();
    set({ activeId: active });
    void get().rescan();
  },

  rescan: async () => {
    const folder = resolvePersonasFolder();
    set({ loading: true, last_folder: folder, last_error: null });
    if (!folder) {
      set({ profiles: BUILTIN_TEMPLATES, loading: false });
      return;
    }
    try {
      await migrateLegacyProfiles();
      const seeded = await seedBuiltinsIfNeeded();
      void seeded;
      const files = await readPersonasDir(folder);
      const fromDisk = files
        .map(mdToProfile)
        .filter((p): p is ModelProfile => p !== null);
      // If disk scan failed entirely, fall back to in-memory built-ins so the
      // selector is never empty
      const profiles = fromDisk.length > 0 ? fromDisk : BUILTIN_TEMPLATES;
      const active = get().activeId;
      set({
        profiles,
        loading: false,
        activeId: profiles.some((p) => p.id === active) ? active : "default",
      });
    } catch (e) {
      set({
        loading: false,
        last_error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  setActive: (id) => {
    const profiles = get().profiles;
    if (!profiles.some((p) => p.id === id)) return;
    writeActive(id);
    set({ activeId: id });
  },

  upsert: async (p) => {
    if (!p.id || !p.name) return;
    const folder = resolvePersonasFolder();
    if (!folder) {
      set({ last_error: "project path not set" });
      return;
    }
    const path = p.path ?? `${folder}/${p.id}.md`;
    try {
      await writePersonaFile(path, serializePersona(p));
      await get().rescan();
    } catch (e) {
      set({ last_error: e instanceof Error ? e.message : String(e) });
    }
  },

  remove: async (id) => {
    const profiles = get().profiles;
    const target = profiles.find((p) => p.id === id);
    if (!target?.path) return;
    try {
      await deletePersonaFile(target.path);
      const fallback = get().activeId === id ? "default" : get().activeId;
      if (fallback !== get().activeId) {
        writeActive(fallback);
        set({ activeId: fallback });
      }
      await get().rescan();
    } catch (e) {
      set({ last_error: e instanceof Error ? e.message : String(e) });
    }
  },

  resetToBuiltin: async (id) => {
    const template = BUILTIN_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    const path = personaPath(id);
    if (!path) return;
    try {
      await writePersonaFile(path, serializePersona(template));
      await get().rescan();
    } catch (e) {
      set({ last_error: e instanceof Error ? e.message : String(e) });
    }
  },

  getActive: () => {
    const { profiles, activeId } = get();
    return profiles.find((p) => p.id === activeId) ?? null;
  },
}));
// [END] Phase 8
