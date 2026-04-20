import i18n from "../i18n";

// [START] Phase 6.4 — Slash command infrastructure.
// Triggered when the chat input starts with '/' on the first line AND the
// cursor has not left that prefix. Commands can either run an imperative
// handler (clear chat, switch profile…) or insert template text for the user
// to continue editing.
//
// Edge-case rules (oppa explicit requirement):
//   - Ignore '/' inside a code fence (```).
//   - Ignore '/' inside quoted inline code (`...`) on the same line.
//   - Ignore '/' in the middle of a word (must be leading char of input or
//     follow a newline).
// The detection helper below encodes these.

export type SlashCommandKind = "action" | "template";

export interface SlashCommandContext {
  // Filled in by the caller — lets handlers touch stores without circular
  // imports. Extended as more commands land.
  clearChat?: () => Promise<void> | void;
  cycleProfile?: () => void;
  openPane?: (pane: "wiki" | "models" | "settings" | "image" | "code" | "chat") => void;
  compact?: () => Promise<void> | void;
  addMemoryNote?: (text: string) => Promise<void> | void;
}

export interface SlashCommand {
  id: string;            // matched against user typed token (after '/')
  aliases?: string[];    // alternate match strings
  name: string;          // user-visible label
  description: string;   // one-line help (plain text, pre-resolved from i18n)
  descriptionKey?: string; // optional i18n key; when set, resolveSlashDescription returns t(descriptionKey)
  emoji?: string;        // optional visual hint
  kind: SlashCommandKind;
  /** action handler — returns text to replace the slash prefix with,
   *  or null/empty to just clear the prompt. */
  run?: (ctx: SlashCommandContext, args: string) => string | null | void;
  /** template kind — returned string replaces the input so the user
   *  can keep editing. */
  template?: (args: string) => string;
  /** Phase roadmap placeholder — when true the command is registered but
   *  the action is deferred (shows a toast). Used to surface upcoming
   *  Phase 6.4 commands without stub implementations. */
  placeholder?: boolean;
}

// [START] Edge-case guard — decide whether the current input should surface
// the slash menu. We only show the popup when the entire input so far is a
// single slash-led token (with optional args), no backtick inline code, no
// open code fence. Keeps the menu out of inline code like `a/b` and block
// snippets like ```/bin/bash```.
export function shouldShowSlashMenu(value: string): {
  show: boolean;
  token: string;
  args: string;
} {
  // Fast fail — must start with '/' as first printable char (allow leading ws)
  const trimmedLead = value.trimStart();
  if (!trimmedLead.startsWith("/")) return { show: false, token: "", args: "" };

  // Disqualify if any newline already present — slash commands are single-line
  if (value.includes("\n")) return { show: false, token: "", args: "" };

  // Disqualify if any unmatched backtick on the current text — user is in an
  // inline code block and '/' is incidental to that.
  const backticks = (value.match(/`/g) ?? []).length;
  if (backticks % 2 === 1) return { show: false, token: "", args: "" };

  // Split leading '/' + token + optional args
  const afterSlash = trimmedLead.slice(1);
  const spaceIdx = afterSlash.indexOf(" ");
  if (spaceIdx === -1) {
    return { show: true, token: afterSlash, args: "" };
  }
  return {
    show: true,
    token: afterSlash.slice(0, spaceIdx),
    args: afterSlash.slice(spaceIdx + 1),
  };
}
// [END]

// [START] resolveSlashDescription — the built-in commands carry a
// `descriptionKey` i18n pointer; the pre-resolved `description` field is kept
// for back-compat (e.g. snippet-sourced commands that inject raw text). This
// helper is the single entrypoint callers should use to render descriptions.
export function resolveSlashDescription(cmd: SlashCommand): string {
  if (cmd.descriptionKey) return i18n.t(cmd.descriptionKey);
  return cmd.description;
}
// [END]

// [START] buildTranslatedDescription — build-site helper that snapshots the
// current i18n value into the plain `description` field. We call this at
// registry access time so consumers that rely on the plain field (e.g.
// legacy code paths) still see the localized string.
function withDescription(cmd: Omit<SlashCommand, "description"> & { descriptionKey: string }): SlashCommand {
  return {
    ...cmd,
    description: i18n.t(cmd.descriptionKey),
  };
}
// [END]

// [START] Built-in command registry.
// Descriptions are i18n-keyed; `description` is resolved lazily via getter so
// locale switches at runtime take effect without rebuilding the registry.
const BUILTIN_SLASH_COMMANDS: ReadonlyArray<Omit<SlashCommand, "description"> & { descriptionKey: string }> = [
  {
    id: "clear",
    name: "/clear",
    emoji: "🧹",
    descriptionKey: "slash.clear.description",
    kind: "action",
    run: (ctx) => {
      if (ctx.clearChat) void ctx.clearChat();
      return null;
    },
  },
  {
    id: "profile",
    aliases: ["프로필"],
    name: "/profile",
    emoji: "👤",
    descriptionKey: "slash.profile.description",
    kind: "action",
    run: (ctx) => {
      ctx.cycleProfile?.();
      return null;
    },
  },
  {
    id: "wiki",
    name: "/wiki",
    emoji: "📚",
    descriptionKey: "slash.wiki.description",
    kind: "action",
    run: (ctx) => {
      ctx.openPane?.("wiki");
      return null;
    },
  },
  {
    id: "models",
    name: "/models",
    emoji: "📦",
    descriptionKey: "slash.models.description",
    kind: "action",
    run: (ctx) => {
      ctx.openPane?.("models");
      return null;
    },
  },
  {
    id: "settings",
    name: "/settings",
    emoji: "⚙️",
    descriptionKey: "slash.settings.description",
    kind: "action",
    run: (ctx) => {
      ctx.openPane?.("settings");
      return null;
    },
  },
  // [START] Phase 6.4 roadmap placeholders — the slash UI ships now so
  // commands like /compact /memory /skills /translate feel wired even
  // though the full behaviour lands in follow-up commits.
  {
    id: "compact",
    name: "/compact",
    emoji: "🗜",
    descriptionKey: "slash.compact.description",
    kind: "action",
    run: (ctx) => {
      if (ctx.compact) void ctx.compact();
      return null;
    },
  },
  {
    id: "memory",
    name: "/memory",
    emoji: "🧠",
    descriptionKey: "slash.memory.description",
    kind: "action",
    run: (ctx, args) => {
      const text = args.trim();
      if (!text) return null;
      if (ctx.addMemoryNote) void ctx.addMemoryNote(text);
      return null;
    },
  },
  {
    id: "skills",
    name: "/skills",
    emoji: "✨",
    descriptionKey: "slash.skills.description",
    kind: "action",
    run: (ctx) => {
      ctx.openPane?.("settings");
      return null;
    },
  },
  {
    id: "translate",
    name: "/translate",
    emoji: "🌐",
    descriptionKey: "slash.translate.description",
    kind: "template",
    template: (args) => {
      const prefix = i18n.t("slash.translate.template_prefix");
      return args ? `${prefix}${args}` : prefix;
    },
  },
  // [END]
];

export const SLASH_COMMANDS: ReadonlyArray<SlashCommand> = BUILTIN_SLASH_COMMANDS.map(withDescription);
// [END]

// [START] Filter + sort by how well the token prefixes the command id/name
// (fuzzy prefix match, not full fuzzy). Empty token returns the whole list.
export function filterSlashCommands(token: string): SlashCommand[] {
  const needle = token.trim().toLowerCase();
  if (!needle) return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter((c) => {
    if (c.id.startsWith(needle)) return true;
    if (c.aliases?.some((a) => a.toLowerCase().startsWith(needle))) return true;
    return false;
  });
}
// [END]
