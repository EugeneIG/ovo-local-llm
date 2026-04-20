// [START] Phase 8.4 — VS Code Material Icon Theme-ish file / folder icons.
// Maps by filename first (exact match for config files: package.json, etc.),
// then by extension, then by special-case folder name. Falls back to the
// generic lucide File / Folder icon when we don't have a brand for the
// file type. Keep the map flat so adding a new icon is one line.
import type { ReactNode } from "react";
import { File, Folder, FolderOpen } from "lucide-react";
import {
  SiReact,
  SiTypescript,
  SiJavascript,
  SiMarkdown,
  SiRust,
  SiPython,
  SiHtml5,
  SiCss,
  SiTailwindcss,
  SiPostcss,
  SiVite,
  SiJson,
  SiToml,
  SiYaml,
  SiDocker,
  SiGit,
  SiNpm,
  SiNodedotjs,
  SiGraphql,
  SiGo,
  SiRuby,
  SiPhp,
  SiSass,
  SiSvg,
  SiEslint,
  SiPrettier,
  SiStoryblok,
} from "react-icons/si";
import {
  VscJson,
  VscSettingsGear,
  VscFileMedia,
  VscDatabase,
  VscTerminalBash,
  VscFilePdf,
  VscFileZip,
} from "react-icons/vsc";

// ── Named-file map (highest priority) ────────────────────────────────────
const NAMED_FILES: Record<string, { icon: ReactNode; color?: string }> = {
  "package.json": { icon: <SiNpm />, color: "#CB3837" },
  "package-lock.json": { icon: <SiNpm />, color: "#CB3837" },
  "tsconfig.json": { icon: <SiTypescript />, color: "#3178C6" },
  "tsconfig.build.json": { icon: <SiTypescript />, color: "#3178C6" },
  "vite.config.ts": { icon: <SiVite />, color: "#B546FF" },
  "vite.config.js": { icon: <SiVite />, color: "#B546FF" },
  "tailwind.config.ts": { icon: <SiTailwindcss />, color: "#38BDF8" },
  "tailwind.config.js": { icon: <SiTailwindcss />, color: "#38BDF8" },
  "postcss.config.js": { icon: <SiPostcss />, color: "#DD3A0A" },
  "postcss.config.cjs": { icon: <SiPostcss />, color: "#DD3A0A" },
  ".eslintrc.json": { icon: <SiEslint />, color: "#4B32C3" },
  ".eslintrc.js": { icon: <SiEslint />, color: "#4B32C3" },
  ".prettierrc": { icon: <SiPrettier />, color: "#F7B93E" },
  "Dockerfile": { icon: <SiDocker />, color: "#2496ED" },
  "docker-compose.yml": { icon: <SiDocker />, color: "#2496ED" },
  ".gitignore": { icon: <SiGit />, color: "#F05032" },
  ".gitattributes": { icon: <SiGit />, color: "#F05032" },
  "Cargo.toml": { icon: <SiRust />, color: "#DEA584" },
  "Cargo.lock": { icon: <SiRust />, color: "#DEA584" },
  "pyproject.toml": { icon: <SiPython />, color: "#3776AB" },
  "uv.lock": { icon: <SiPython />, color: "#3776AB" },
  "README.md": { icon: <SiMarkdown />, color: "#42A5F5" },
  "README.ko.md": { icon: <SiMarkdown />, color: "#42A5F5" },
  "CLAUDE.md": { icon: <SiMarkdown />, color: "#D97706" },
  "AGENTS.md": { icon: <SiMarkdown />, color: "#D97706" },
  "GEMINI.md": { icon: <SiMarkdown />, color: "#D97706" },
  "IDE.md": { icon: <SiMarkdown />, color: "#D97706" },
  "Info.plist": { icon: <VscSettingsGear />, color: "#84CC16" },
  "tauri.conf.json": { icon: <VscSettingsGear />, color: "#38BDF8" },
};

// ── Extension map (fallback when no named match) ─────────────────────────
const EXT_MAP: Record<string, { icon: ReactNode; color?: string }> = {
  tsx: { icon: <SiReact />, color: "#61DAFB" },
  jsx: { icon: <SiReact />, color: "#61DAFB" },
  ts: { icon: <SiTypescript />, color: "#3178C6" },
  mts: { icon: <SiTypescript />, color: "#3178C6" },
  cts: { icon: <SiTypescript />, color: "#3178C6" },
  "d.ts": { icon: <SiTypescript />, color: "#3178C6" },
  js: { icon: <SiJavascript />, color: "#F7DF1E" },
  mjs: { icon: <SiJavascript />, color: "#F7DF1E" },
  cjs: { icon: <SiNodedotjs />, color: "#8CC84B" },
  md: { icon: <SiMarkdown />, color: "#42A5F5" },
  markdown: { icon: <SiMarkdown />, color: "#42A5F5" },
  mdx: { icon: <SiMarkdown />, color: "#F59E0B" },
  rs: { icon: <SiRust />, color: "#DEA584" },
  py: { icon: <SiPython />, color: "#3776AB" },
  ipynb: { icon: <SiPython />, color: "#F37626" },
  html: { icon: <SiHtml5 />, color: "#E34F26" },
  htm: { icon: <SiHtml5 />, color: "#E34F26" },
  css: { icon: <SiCss />, color: "#2965F1" },
  scss: { icon: <SiSass />, color: "#CC6699" },
  sass: { icon: <SiSass />, color: "#CC6699" },
  json: { icon: <SiJson />, color: "#FAC54B" },
  json5: { icon: <VscJson />, color: "#FAC54B" },
  jsonc: { icon: <VscJson />, color: "#FAC54B" },
  toml: { icon: <SiToml />, color: "#9C4221" },
  yaml: { icon: <SiYaml />, color: "#CB171E" },
  yml: { icon: <SiYaml />, color: "#CB171E" },
  go: { icon: <SiGo />, color: "#00ADD8" },
  rb: { icon: <SiRuby />, color: "#CC342D" },
  php: { icon: <SiPhp />, color: "#777BB4" },
  graphql: { icon: <SiGraphql />, color: "#E535AB" },
  gql: { icon: <SiGraphql />, color: "#E535AB" },
  svg: { icon: <SiSvg />, color: "#FFB13B" },
  png: { icon: <VscFileMedia />, color: "#C084FC" },
  jpg: { icon: <VscFileMedia />, color: "#C084FC" },
  jpeg: { icon: <VscFileMedia />, color: "#C084FC" },
  gif: { icon: <VscFileMedia />, color: "#C084FC" },
  webp: { icon: <VscFileMedia />, color: "#C084FC" },
  ico: { icon: <VscFileMedia />, color: "#C084FC" },
  pdf: { icon: <VscFilePdf />, color: "#DC2626" },
  zip: { icon: <VscFileZip />, color: "#EAB308" },
  tar: { icon: <VscFileZip />, color: "#EAB308" },
  gz: { icon: <VscFileZip />, color: "#EAB308" },
  sh: { icon: <VscTerminalBash />, color: "#4CAF50" },
  bash: { icon: <VscTerminalBash />, color: "#4CAF50" },
  zsh: { icon: <VscTerminalBash />, color: "#4CAF50" },
  fish: { icon: <VscTerminalBash />, color: "#4CAF50" },
  sql: { icon: <VscDatabase />, color: "#00758F" },
  db: { icon: <VscDatabase />, color: "#00758F" },
  sqlite: { icon: <VscDatabase />, color: "#00758F" },
  stories: { icon: <SiStoryblok />, color: "#09B3AF" },
  env: { icon: <VscSettingsGear />, color: "#ECD53F" },
};

// ── Folder name map (highest priority for folders) ───────────────────────
const FOLDER_NAMES: Record<string, string> = {
  node_modules: "#8CC84B",
  "src-tauri": "#F59E0B",
  src: "#3B82F6",
  components: "#10B981",
  pages: "#F59E0B",
  routes: "#F59E0B",
  hooks: "#A855F7",
  store: "#F97316",
  stores: "#F97316",
  lib: "#6366F1",
  utils: "#6366F1",
  types: "#8B5CF6",
  styles: "#EC4899",
  public: "#0EA5E9",
  assets: "#F97316",
  images: "#C084FC",
  fonts: "#64748B",
  tests: "#EF4444",
  test: "#EF4444",
  __tests__: "#EF4444",
  specs: "#EF4444",
  docs: "#0EA5E9",
  dist: "#64748B",
  build: "#64748B",
  out: "#64748B",
  target: "#DEA584",
  ".git": "#F05032",
  ".github": "#8B5CF6",
  ".vscode": "#2965F1",
  sidecar: "#3776AB",
  api: "#10B981",
  db: "#00758F",
  migrations: "#34D399",
  icons: "#FBBF24",
  locales: "#EC4899",
  i18n: "#EC4899",
  config: "#94A3B8",
};

export function getFileIcon(name: string, size = 14): { node: ReactNode; color: string } {
  const named = NAMED_FILES[name];
  if (named) {
    return {
      node: <span style={{ color: named.color, fontSize: size }}>{named.icon}</span>,
      color: named.color ?? "currentColor",
    };
  }
  const lower = name.toLowerCase();
  // Double extension match (d.ts, stories.tsx, etc.)
  const parts = lower.split(".");
  if (parts.length >= 3) {
    const double = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    const doubleMatch = EXT_MAP[double];
    if (doubleMatch) {
      return {
        node: <span style={{ color: doubleMatch.color, fontSize: size }}>{doubleMatch.icon}</span>,
        color: doubleMatch.color ?? "currentColor",
      };
    }
  }
  const ext = parts.length >= 2 ? parts[parts.length - 1] : "";
  const byExt = EXT_MAP[ext];
  if (byExt) {
    return {
      node: <span style={{ color: byExt.color, fontSize: size }}>{byExt.icon}</span>,
      color: byExt.color ?? "currentColor",
    };
  }
  return {
    node: <File style={{ color: "#94A3B8", width: size, height: size }} />,
    color: "#94A3B8",
  };
}

export function getFolderIcon(
  name: string,
  open: boolean,
  size = 14,
): { node: ReactNode; color: string } {
  const color = FOLDER_NAMES[name] ?? "#EAB308";
  const Icon = open ? FolderOpen : Folder;
  return {
    node: <Icon style={{ color, width: size, height: size }} />,
    color,
  };
}
// [END]
