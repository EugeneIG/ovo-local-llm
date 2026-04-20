import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useProjectContextStore } from "./project_context";
import { useFeatureFlagsStore } from "./feature_flags";

// [START] Phase 6.4 — Skills store.
// Loads `.ovo/skills/*.md` (and `.md` files inside any nested subfolder — each
// subfolder is treated as a single skill whose content is the concatenation of
// its `.md` files) from the active project_path, parses optional YAML-ish
// frontmatter (`name`, `description`) and exposes per-skill enable toggles.
// Enabled skills are concatenated into a `<ovo_skills>` system block at send
// time. Claude parity: `.claude/skills/` → `.ovo/skills/`.

const LS_KEY = "ovo:skills";

export interface SkillFile {
  /** Absolute filesystem path to the first .md file of the skill */
  path: string;
  /** Skill identifier — frontmatter `name` or file basename */
  name: string;
  /** Human description — frontmatter `description` or first non-header markdown line */
  description: string;
  /** Full markdown body (frontmatter stripped) */
  body: string;
  /** Byte size of the underlying file */
  size_bytes: number;
}

interface RustMdFile {
  name: string;
  path: string;
  content: string;
  size_bytes: number;
}

interface RustMdDirResult {
  files: RustMdFile[];
}

interface PersistedState {
  enabled: Record<string, boolean>;
  /**
   * Optional absolute override — when set, takes precedence over
   * `<project_path>/.ovo/skills`. Rarely needed; UI keeps it hidden by default.
   */
  folder_override: string | null;
}

interface SkillsState {
  skills: SkillFile[];
  enabled: Record<string, boolean>;
  folder_override: string | null;
  loading: boolean;
  last_folder: string | null;
  last_error: string | null;

  load: () => void;
  rescan: () => Promise<void>;
  setEnabled: (path: string, enabled: boolean) => void;
  setFolderOverride: (path: string | null) => Promise<void>;
  getEffectivePrompt: () => string;
}

// ── Persistence ──────────────────────────────────────────────────────────────

function readStorage(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return {};
  }
}

function persist(state: PersistedState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

// ── Frontmatter + description parsing ─────────────────────────────────────────

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/;

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

function firstMeaningfulLine(body: string): string {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    return line.length > 140 ? `${line.slice(0, 140)}…` : line;
  }
  return "";
}

function parseSkillContent(content: string, fallbackName: string): ParsedSkill {
  const match = content.match(FRONTMATTER_RE);
  let name = fallbackName;
  let description = "";
  let body = content;
  if (match) {
    const fm = match[1];
    body = content.slice(match[0].length);
    for (const rawLine of fm.split(/\r?\n/)) {
      const idx = rawLine.indexOf(":");
      if (idx === -1) continue;
      const key = rawLine.slice(0, idx).trim().toLowerCase();
      let value = rawLine.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!value) continue;
      if (key === "name") name = value;
      else if (key === "description") description = value;
    }
  }
  if (!description) description = firstMeaningfulLine(body);
  return { name, description, body };
}

// ── Directory loading ────────────────────────────────────────────────────────

async function readMdDir(dirPath: string): Promise<RustMdFile[]> {
  try {
    const result = await invoke<RustMdDirResult>("read_md_dir", { path: dirPath });
    return result.files;
  } catch {
    return [];
  }
}

function skillFilename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const base = idx >= 0 ? path.slice(idx + 1) : path;
  return base.replace(/\.(md|markdown)$/i, "");
}

async function scanFolder(rootPath: string): Promise<SkillFile[]> {
  const topLevel = await readMdDir(rootPath);

  // Subdirectories are not returned by read_md_dir (it only emits files). We
  // probe a single nested layer by attempting to read common SKILL.md / index
  // files inside each sibling of the top-level .md hits — skipped for now so
  // the initial implementation stays honest to what the Rust command exposes.
  //
  // Each top-level .md becomes one skill.
  const skills: SkillFile[] = topLevel.map((f) => {
    const fallbackName = skillFilename(f.name);
    const parsed = parseSkillContent(f.content, fallbackName);
    return {
      path: f.path,
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      size_bytes: f.size_bytes,
    };
  });
  return skills;
}

function resolveSkillsFolder(): string | null {
  const override = useSkillsStore.getState().folder_override;
  if (override && override.length > 0) return override;
  const projectPath = useProjectContextStore.getState().project_path;
  if (!projectPath) return null;
  // Platform-agnostic join — stick to forward slashes since Tauri fs tolerates
  // them on Windows too.
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  return `${trimmed}/.ovo/skills`;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  enabled: {},
  folder_override: null,
  loading: false,
  last_folder: null,
  last_error: null,

  load: () => {
    const stored = readStorage();
    set({
      enabled: stored.enabled ?? {},
      folder_override: stored.folder_override ?? null,
    });
    void get().rescan();
  },

  rescan: async () => {
    // [START] Phase 8 — skip scanning when the master flag is off
    if (!useFeatureFlagsStore.getState().enable_skills) {
      set({ skills: [], loading: false, last_error: null });
      return;
    }
    // [END]
    const folder = resolveSkillsFolder();
    set({ loading: true, last_folder: folder, last_error: null });
    if (!folder) {
      set({ skills: [], loading: false });
      return;
    }
    try {
      const skills = await scanFolder(folder);
      set({ skills, loading: false });
    } catch (e) {
      set({
        skills: [],
        loading: false,
        last_error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  setEnabled: (path, enabled) => {
    const next = { ...get().enabled, [path]: enabled };
    set({ enabled: next });
    persist({ enabled: next, folder_override: get().folder_override });
  },

  setFolderOverride: async (path) => {
    const next = path && path.length > 0 ? path : null;
    set({ folder_override: next });
    persist({ enabled: get().enabled, folder_override: next });
    await get().rescan();
  },

  getEffectivePrompt: () => {
    // [START] Phase 8 — master toggle wins over per-skill enable map
    if (!useFeatureFlagsStore.getState().enable_skills) return "";
    // [END]
    const { skills, enabled } = get();
    if (skills.length === 0) return "";
    const active = skills.filter((s) => enabled[s.path] !== false);
    if (active.length === 0) return "";

    // Claude-parity format: a catalog block so the model knows which skills
    // exist. We include the full body for each enabled skill — users expected
    // to tune this via per-skill toggles rather than per-tokens budget.
    const parts = active.map((s) => {
      const heading = `## ${s.name}`;
      const blurb = s.description ? `\n_${s.description}_\n` : "";
      return `${heading}${blurb}\n${s.body.trim()}`;
    });
    return `<ovo_skills>\n${parts.join("\n\n---\n\n")}\n</ovo_skills>`;
  },
}));
// [END] Phase 6.4
