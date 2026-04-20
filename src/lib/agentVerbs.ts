// [START] Phase 8 — Agent status verbs + tool-label mapping.
// Claude-Code-style "Cogitating…", "Baking…", "Meandering…" — a friendlier
// set of in-progress gerunds we cycle through so the user doesn't stare at
// a single "Thinking…" label forever. Each think block picks one verb once
// (via sessionless random) and sticks with it until it closes.

const VERBS: ReadonlyArray<string> = [
  "Thinking",
  "Cogitating",
  "Baking",
  "Meandering",
  "Pondering",
  "Musing",
  "Brewing",
  "Percolating",
  "Ruminating",
  "Contemplating",
  "Deliberating",
  "Noodling",
  "Dreaming",
  "Wandering",
  "Exploring",
  "Churning",
  "Mulling",
  "Puzzling",
  "Hatching",
  "Stirring",
];

// [START] pickVerb — stable across renders for a given key so the gerund
// doesn't flicker while a `<think>` block is still streaming. Pass the
// stream-local index (message id + segment index) as the key.
export function pickVerb(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return VERBS[hash % VERBS.length];
}
// [END]

// [START] toolLabel — map the internal tool name to a short Claude-Code-
// style verb. Falls back to the raw name for tools we haven't mapped yet.
// Kept here (not inside MessageRenderer) so the same label lookup works
// for the top-of-turn progress header we'll add later.
const TOOL_LABELS: Readonly<Record<string, string>> = {
  // Code-agent built-ins (see codeAgentTools.ts)
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  create_file: "Create",
  delete_file: "Delete",
  list_dir: "LS",
  run_command: "Bash",
  search_files: "Grep",
  rename_file: "Rename",

  // OVO built-ins (shared with main chat)
  web_search: "Web",
  memory_search: "Memory",
  memory_add: "Memory+",
  memory_list: "Memory",
  memory_delete: "Memory−",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}
// [END]

// [START] summarizeToolCall — one-line summary used in the collapsed
// timeline step. Reads the most informative argument (path / query / cmd)
// and surfaces it next to the label. Falls back to a truncated JSON blob
// for tools we haven't taught a summariser yet.
export function summarizeToolCall(name: string, args: Record<string, unknown>): string {
  const arg = (k: string) => {
    const v = args[k];
    return typeof v === "string" ? v : undefined;
  };

  switch (name) {
    case "read_file": {
      const p = arg("path");
      const startRaw = args.start_line;
      const endRaw = args.end_line;
      const start = typeof startRaw === "number" ? startRaw : undefined;
      const end = typeof endRaw === "number" ? endRaw : undefined;
      if (p && (start || end)) {
        const range = `${start ?? 1}-${end ?? "end"}`;
        return `${p}  (lines ${range})`;
      }
      return p ? `${p}` : "(no path)";
    }
    case "write_file":
    case "create_file":
    case "delete_file":
    case "rename_file":
    case "list_dir": {
      const p = arg("path") ?? arg("from") ?? "";
      return p;
    }
    case "edit_file": {
      const p = arg("path") ?? "";
      const old = arg("old_string") ?? "";
      const nw = arg("new_string") ?? "";
      // "path  +N −M" — net byte delta gives a quick signal of how big
      // the edit is without dumping the entire diff into the timeline.
      const delta = nw.length - old.length;
      const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
      return `${p}  ${sign}${Math.abs(delta)}b`;
    }
    case "run_command": {
      const cmd = arg("command") ?? "";
      return cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd;
    }
    case "search_files": {
      const q = arg("pattern") ?? arg("query") ?? "";
      const where = arg("path");
      const inPart = where ? ` in ${where}` : "";
      return q ? `"${q}"${inPart}` : "";
    }
    case "web_search":
    case "memory_search": {
      const q = arg("query") ?? "";
      return q ? `"${q}"` : "";
    }
    default: {
      const compact = JSON.stringify(args);
      return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
    }
  }
}
// [END]
// [END] Phase 8
