// [START] Phase 8.3 — Code agent tool definitions + dispatch
import { invoke } from "@tauri-apps/api/core";
import { useCodeAgentStore } from "../store/code_agent";
import type { BrowserPreference } from "../store/code_settings";

// [START] Phase 5 — map a browser preference to the macOS application name
// used by `open -a "<App>" <url>`. Returns null for "default" so the caller
// falls through to `shell.open`, which uses the system default handler.
function browserAppForPreference(
  pref: BrowserPreference,
  customApp: string,
): string | null {
  switch (pref) {
    case "safari":
      return "Safari";
    case "chrome":
      return "Google Chrome";
    case "firefox":
      return "Firefox";
    case "arc":
      return "Arc";
    case "edge":
      return "Microsoft Edge";
    case "custom":
      return customApp.trim().length > 0 ? customApp.trim() : null;
    case "default":
    default:
      return null;
  }
}
// [END]

export interface CodeAgentTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export const CODE_AGENT_TOOLS: CodeAgentTool[] = [
  {
    name: "read_file",
    description:
      "Read the contents of a file in the project. For large files, pass start_line/end_line to avoid ingesting the whole thing — saves tokens and keeps the context focused.",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
      start_line: {
        type: "integer",
        description: "1-based inclusive start line. Omit to start from the beginning.",
      },
      end_line: {
        type: "integer",
        description: "1-based inclusive end line. Omit to read through the end of the file.",
      },
    },
  },
  {
    name: "write_file",
    description:
      "Write content to a file (creates or overwrites the WHOLE file). Prefer edit_file for small changes — this tool replaces the entire file.",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
      content: { type: "string", description: "Full file content to write", required: true },
    },
  },
  {
    name: "todo_write",
    description:
      "Publish or update the agent's task checklist for the current turn. Call at the START of any multi-step task with the full plan (pending items), then re-call to mark steps in_progress / completed. The user sees this as a progress panel. Each call REPLACES the list — always send the complete set.",
    parameters: {
      items: {
        type: "array",
        description:
          'Array of {"content": string, "status": "pending" | "in_progress" | "completed"} objects in the order they should execute.',
        required: true,
      },
    },
  },
  {
    name: "edit_file",
    description:
      "Patch a file in place by replacing an exact old_string with new_string. PREFERRED for any change smaller than the whole file — cheaper tokens and safer than write_file. old_string must match exactly (whitespace + newlines included) and appear once, unless replace_all is true.",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
      old_string: {
        type: "string",
        description: "Exact snippet to replace. Copy from a prior read_file result including surrounding context so the match is unique.",
        required: true,
      },
      new_string: {
        type: "string",
        description: "Replacement text. Must differ from old_string.",
        required: true,
      },
      replace_all: {
        type: "boolean",
        description: "Replace every match instead of just one. Default false.",
      },
    },
  },
  {
    name: "create_file",
    description: "Create a new empty file",
    parameters: {
      path: { type: "string", description: "Relative file path", required: true },
    },
  },
  {
    name: "delete_file",
    description: "Delete a file or directory",
    parameters: {
      path: { type: "string", description: "Relative path", required: true },
    },
  },
  {
    name: "list_dir",
    description: "List files in a directory",
    parameters: {
      path: { type: "string", description: "Relative directory path (empty for root)" },
    },
  },
  {
    name: "run_command",
    description: "Execute a shell command in the project directory",
    parameters: {
      command: { type: "string", description: "Shell command to run", required: true },
    },
  },
  {
    name: "search_files",
    description: "Search for text in project files (grep-like)",
    parameters: {
      pattern: { type: "string", description: "Search pattern", required: true },
      case_sensitive: { type: "boolean", description: "Case sensitive search" },
    },
  },
  {
    name: "rename_file",
    description: "Rename or move a file",
    parameters: {
      from: { type: "string", description: "Current relative path", required: true },
      to: { type: "string", description: "New relative path", required: true },
    },
  },
];

// Side effect descriptor — tells the caller what to refresh after dispatch
export interface ToolSideEffect {
  refreshTree?: boolean;
  openFile?: string;
  refreshGit?: boolean;
  // [START] Phase 8 C3 — todo list snapshot from the agent.
  // Populated by todo_write. Caller (_sendLoop) forwards to the store so
  // AgentChat can render the plan checklist at the top.
  updateTodos?: Array<{ content: string; status: string }>;
  // [END]
  // [START] Phase 8.4 — opt-in post-write verification.
  // When a TS/TSX file is written or edited, the dispatcher can ask the
  // caller to kick off a tsc check in the background and fold any errors
  // back into the model's next turn.
  verifyTsFile?: string;
  // [END]
}

// [START] Phase 8.4 — post-write tsc verifier.
// Runs `npx tsc --noEmit --pretty false` in the project root, filters the
// output to diagnostics that mention the just-touched file, and returns up
// to the first 20 errors so the model can self-correct instead of blindly
// calling `npm run build` and getting 800 lines of noise. Silent-skips when
// there's no tsconfig.json or tsc itself is missing — we don't want to turn
// a Rust/Python project into a JS project's problem.
export interface TscCheckResult {
  ran: boolean;
  skipped_reason?: string;
  errors: string[];
  errors_truncated_from?: number;
}

export async function runTscCheck(
  projectRoot: string,
  relativeFilePath: string,
): Promise<TscCheckResult> {
  // Sanity: only check JS/TS surface.
  if (!/\.(ts|tsx|mts|cts)$/.test(relativeFilePath)) {
    return { ran: false, skipped_reason: "not_ts_file", errors: [] };
  }
  // Probe for tsconfig.json — skip silently if missing.
  try {
    await invoke<{ content: string; size_bytes: number }>("code_fs_read_file", {
      projectRoot,
      path: "tsconfig.json",
    });
  } catch {
    return { ran: false, skipped_reason: "no_tsconfig", errors: [] };
  }

  type ExecResult = { exit_code: number; stdout: string; stderr: string };
  const execPromise = invoke<ExecResult>("code_fs_exec", {
    projectRoot,
    command: "npx --no-install tsc --noEmit --pretty false --incremental false",
  });
  const timeoutPromise = new Promise<ExecResult>((resolve) =>
    setTimeout(
      () =>
        resolve({
          exit_code: -1,
          stdout: "",
          stderr: "[tsc check timed out after 30s — skipped]",
        }),
      30_000,
    ),
  );
  let result: ExecResult;
  try {
    result = await Promise.race([execPromise, timeoutPromise]);
  } catch (e) {
    return {
      ran: false,
      skipped_reason: `tsc invocation failed: ${e instanceof Error ? e.message : String(e)}`,
      errors: [],
    };
  }
  if (result.exit_code === -1) {
    return { ran: false, skipped_reason: "tsc_timeout", errors: [] };
  }

  // Parse diagnostic lines: `path/to/file.ts(12,34): error TS1234: message`
  const lines = (result.stdout + "\n" + result.stderr).split("\n");
  const fileLeaf = relativeFilePath.split("/").pop() ?? relativeFilePath;
  const matching: string[] = [];
  for (const line of lines) {
    if (!/\b(error|warning)\b\s*TS\d+/.test(line)) continue;
    if (line.includes(relativeFilePath) || line.includes(fileLeaf)) {
      matching.push(line.trim());
    }
  }
  const MAX_ERRORS = 20;
  if (matching.length > MAX_ERRORS) {
    return {
      ran: true,
      errors: matching.slice(0, MAX_ERRORS),
      errors_truncated_from: matching.length,
    };
  }
  return { ran: true, errors: matching };
}
// [END]

export async function dispatchCodeAgentTool(
  name: string,
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<{ result: unknown; sideEffect: ToolSideEffect }> {
  const se: ToolSideEffect = {};

  switch (name) {
    case "read_file": {
      const rawPath = String(args.path ?? "");
      // [START] Phase 5 — absolute-path attachment rescue.
      // Files the user explicitly attached via the + menu / drag-and-drop
      // live on the agent store as a whitelist of absolute paths. When
      // the model asks to read one of those (typically because we told it
      // about the attachment in `<attached_files>`), we route through the
      // external reader so the project-scope guard doesn't reject it. Any
      // other absolute path still fails — prevents the model from peeking
      // into arbitrary filesystem corners without the user opting in.
      const isAbsolute = rawPath.startsWith("/");
      const attachments = useCodeAgentStore.getState().attachments;
      const isWhitelisted = isAbsolute && attachments.includes(rawPath);
      const result = isWhitelisted
        ? await invoke<{ content: string; size_bytes: number }>(
            "code_fs_read_external_file",
            { path: rawPath },
          )
        : await invoke<{ content: string; size_bytes: number }>(
            "code_fs_read_file",
            { projectRoot, path: rawPath },
          );
      // [END]
      // [START] Phase 8 B2 — optional line-range slice.
      // Range validation is deliberately lenient: out-of-range indices
      // clamp to the actual file length so the model doesn't have to
      // probe line counts before every read.
      const startLine = Number(args.start_line ?? 0);
      const endLine = Number(args.end_line ?? 0);
      if ((startLine > 0 || endLine > 0) && result.content.length > 0) {
        const lines = result.content.split("\n");
        const s = Math.max(0, Math.floor(startLine) - 1);
        const e =
          endLine > 0 ? Math.min(lines.length, Math.floor(endLine)) : lines.length;
        const sliced = lines.slice(s, e).join("\n");
        return {
          result: {
            content: sliced,
            size: sliced.length,
            lines: `${s + 1}-${e}`,
            total_lines: lines.length,
          },
          sideEffect: se,
        };
      }
      // [END]
      return {
        result: {
          content: result.content,
          size: result.size_bytes,
          total_lines: result.content.split("\n").length,
        },
        sideEffect: se,
      };
    }

    case "write_file": {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      // [START] Phase 8 — empty-content defense. Several models call
      // write_file a second time after a successful write, drop the
      // `content` argument in the retry, and nuke the freshly-written
      // file. We reject zero-length writes so the original content
      // survives; the caller sees a structured error and the timeline
      // surfaces the real problem instead of a silent blank file.
      if (content.length === 0) {
        return {
          result: {
            error: `write_file refused: empty content for ${path}. ` +
              `If you really want to blank the file, call delete_file then create_file.`,
          },
          sideEffect: se,
        };
      }
      // [END]
      await invoke("code_fs_write_file", { projectRoot, path, content });
      se.refreshTree = true;
      se.openFile = path;
      se.verifyTsFile = path;
      return { result: { written: true, path, bytes: content.length }, sideEffect: se };
    }

    // [START] Phase 8 C3 — todo_write.
    // Pure state-update tool: no filesystem I/O. The dispatcher forwards
    // the parsed list through `sideEffect.updateTodos`, and _sendLoop
    // pipes it into the store so AgentChat can render the plan.
    case "todo_write": {
      const raw = Array.isArray(args.items) ? args.items : [];
      const items: Array<{ content: string; status: string }> = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const rec = entry as Record<string, unknown>;
        const content = typeof rec.content === "string" ? rec.content : "";
        const status = typeof rec.status === "string" ? rec.status : "pending";
        if (content.trim().length > 0) items.push({ content, status });
      }
      se.updateTodos = items;
      return {
        result: { ok: true, count: items.length },
        sideEffect: se,
      };
    }
    // [END]

    // [START] Phase 8 — edit_file (C1 of the roadmap).
    // Precise old_string → new_string patch. Preferred over write_file for
    // any change smaller than the whole file — saves the model from re-
    // emitting thousands of lines just to flip a single value, and makes
    // partial edits atomic against whatever else was in the file. On the
    // wire this reads almost identically to Claude Code's Edit tool.
    //
    // Semantics:
    //   - old_string MUST be present exactly once (or replace_all=true)
    //   - empty old_string refuses — would match everywhere
    //   - new_string === old_string refuses — obviously a no-op
    //   - Missing match → structured error, file left alone
    //   - Match count reported back so the model can verify
    case "edit_file": {
      const path = String(args.path ?? "");
      const oldStr = String(args.old_string ?? "");
      const newStr = String(args.new_string ?? "");
      const replaceAll = Boolean(args.replace_all ?? false);

      if (!path) {
        return { result: { error: "edit_file: `path` is required" }, sideEffect: se };
      }
      if (oldStr.length === 0) {
        return {
          result: { error: "edit_file: `old_string` cannot be empty" },
          sideEffect: se,
        };
      }
      if (oldStr === newStr) {
        return {
          result: { error: "edit_file: `old_string` equals `new_string` (no-op)" },
          sideEffect: se,
        };
      }

      const current = await invoke<{ content: string; size_bytes: number }>(
        "code_fs_read_file",
        { projectRoot, path },
      );
      const src = current.content;
      // Count matches without creating giant intermediate arrays. `split`
      // is clear enough for text up to a few MB which is all this tool
      // targets — larger files should probably be refactored, not edited.
      const matches = src.split(oldStr).length - 1;

      if (matches === 0) {
        return {
          result: {
            error: `edit_file: old_string not found in ${path}. ` +
              `Re-read the file and copy the exact snippet, whitespace included.`,
          },
          sideEffect: se,
        };
      }
      if (matches > 1 && !replaceAll) {
        return {
          result: {
            error:
              `edit_file: old_string appears ${matches} times in ${path}. ` +
              `Either include more surrounding context so it becomes unique, ` +
              `or set replace_all=true.`,
          },
          sideEffect: se,
        };
      }

      const updated = replaceAll
        ? src.split(oldStr).join(newStr)
        : src.replace(oldStr, newStr);

      await invoke("code_fs_write_file", { projectRoot, path, content: updated });
      se.refreshTree = true;
      se.openFile = path;
      se.verifyTsFile = path;

      return {
        result: {
          edited: true,
          path,
          replacements: replaceAll ? matches : 1,
          bytes_before: src.length,
          bytes_after: updated.length,
        },
        sideEffect: se,
      };
    }
    // [END]

    case "create_file": {
      const path = String(args.path ?? "");
      try {
        await invoke("code_fs_create_file", { projectRoot, path });
      } catch {
        // File might already exist — write content if provided
        if (args.content) {
          await invoke("code_fs_write_file", {
            projectRoot,
            path,
            content: String(args.content),
          });
        }
      }
      se.refreshTree = true;
      se.openFile = path;
      if (args.content) se.verifyTsFile = path;
      return { result: { created: true, path }, sideEffect: se };
    }

    case "delete_file": {
      await invoke("code_fs_delete", {
        projectRoot,
        path: String(args.path ?? ""),
        force: true,
      });
      se.refreshTree = true;
      return { result: { deleted: true, path: args.path }, sideEffect: se };
    }

    case "list_dir": {
      const tree = await invoke<unknown[]>("code_fs_list_tree", { projectRoot });
      return { result: tree, sideEffect: se };
    }

    case "run_command": {
      const result = await invoke<{ exit_code: number; stdout: string; stderr: string }>(
        "code_fs_exec",
        { projectRoot, command: String(args.command ?? "") },
      );
      se.refreshTree = true;
      se.refreshGit = true;

      // [START] Phase 5 — auto-open localhost URLs in the system browser.
      // When `npm run dev`, `python -m http.server`, etc. print a localhost
      // URL, we open it in the user's default browser so they don't have
      // to copy-paste out of the terminal. Only matches localhost / 127.0.0.1
      // — opening arbitrary internet URLs from model stdout would be a
      // security footgun. First match wins (most dev servers print once).
      const combined = `${result.stdout}\n${result.stderr}`;
      const localhostMatch = combined.match(
        /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s\u3000-\u9fff)\]"']*)?/i,
      );
      if (localhostMatch) {
        try {
          const normalized = localhostMatch[0].replace(/0\.0\.0\.0/, "localhost");
          const { useCodeSettingsStore } = await import("../store/code_settings");
          const cs = useCodeSettingsStore.getState();
          const appName = browserAppForPreference(cs.browserPreference, cs.browserCustomApp);
          // [START] Phase 5 — shell-safety guards.
          // Both appName (user setting) and URL (from stdout — attacker
          // influenced) must not be trusted. We run them through a strict
          // allowlist before they reach `open -a ...`. If validation fails
          // we fall back to the sandboxed shell.open API which routes via
          // the system default browser without touching a shell.
          const appOk = appName !== null && /^[\w .&-]{1,64}$/.test(appName);
          const urlOk = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[\w.~:/?#[\]@!$&'()*+,;=%-]*)?$/.test(normalized);
          if (appOk && urlOk) {
            // Invoke `open` directly via a dedicated sidecar-free Tauri
            // command so argv is passed verbatim (no shell interpolation).
            // Falls back to shell if anything looks off.
            try {
              await invoke("browser_open_with_app", { app: appName, url: normalized });
            } catch {
              const { open: openInShell } = await import("@tauri-apps/plugin-shell");
              await openInShell(normalized);
            }
          } else {
            const { open: openInShell } = await import("@tauri-apps/plugin-shell");
            await openInShell(normalized);
          }
          // [END]
          return {
            result: { ...result, opened_url: normalized, opened_in: appName ?? "system default" },
            sideEffect: se,
          };
        } catch (e) {
          console.warn("[code_agent] auto-open failed", e);
        }
      }
      // [END]

      return { result, sideEffect: se };
    }

    case "search_files": {
      const result = await invoke<unknown[]>("code_fs_search", {
        projectRoot,
        pattern: String(args.pattern ?? ""),
        caseSensitive: Boolean(args.case_sensitive ?? false),
      });
      return { result, sideEffect: se };
    }

    case "rename_file": {
      await invoke("code_fs_rename", {
        projectRoot,
        from: String(args.from ?? ""),
        to: String(args.to ?? ""),
      });
      se.refreshTree = true;
      return { result: { renamed: true, from: args.from, to: args.to }, sideEffect: se };
    }

    default:
      throw new Error(`Unknown agent tool: ${name}`);
  }
}

/// Build system prompt describing available tools for the agent.
// [START] Phase 8.4 — Claude-Code-level system prompt.
// The earlier prompt was terse ("here are the tools, use JSON"). Every
// real OSS model we tested (DeepSeek-V2-Lite, Qwen2.5/3-Coder) then
// repeated the same failure modes: unescaped backticks in TSX, skipping
// planning, overwriting whole files for one-line changes, claiming "done"
// before the build passed, looping on the same broken tool call. This
// prompt explicitly addresses each failure pattern with rules + worked
// examples. Structure mirrors Claude Code's own prompt: grounding →
// workflow → tool-call format (with escape discipline) → completion bar.
export function buildAgentToolsPrompt(): string {
  const toolDescs = CODE_AGENT_TOOLS.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([k, v]) => `  - ${k}: ${v.type}${v.required ? " (required)" : ""} — ${v.description}`)
      .join("\n");
    return `### ${t.name}\n${t.description}\n${params}`;
  }).join("\n\n");

  return `You are a coding agent running inside a local IDE. You operate on a real project on the user's filesystem. Behave like a senior engineer pairing with the user — plan before you type, verify before you claim done, fail loud when something is off.

================================================================
GROUNDING — read first, answer second
================================================================
For any question about "this project", "the codebase", or a specific file:
1. Call list_dir with path="." to learn the layout.
2. Call read_file on the landmark files (README.md, CLAUDE.md, package.json, tsconfig.json, the main entry point) BEFORE summarising.
3. If the user names a file, read it first. Never claim a file is empty or a feature missing without a read_file result that proves it.

Do NOT rely on pre-training memory for project-specific details — the project has moved on since your weights were frozen.

================================================================
PATH + DEPENDENCY DISCIPLINE — obey what the user said
================================================================
- When the user names a path (e.g. "src/components/Button.tsx"), write the file AT THAT EXACT PATH. Never relocate "because the directory doesn't exist yet" — use create_file or write_file and trust the filesystem tool to create parents. Relocating silently betrays the user's intent.
- Every \`import\` statement you add MUST have a matching entry in package.json / pyproject.toml / Cargo.toml before you declare the task done. Adding \`import React from 'react'\` without a \`react\` dependency is a bug.
- If you have to generate a tsconfig.json, make its \`include\` array match where your files actually live. \`include: ["src/**/*"]\` + file at \`./Button.tsx\` is a broken setup that will silently pass a meaningless build.
- Before declaring "build passed", read the command output: an exit code of 0 is not the same as "every file compiled" — tsc happily reports success when there's nothing to compile.
- EVERY tool result ships a real object or an \`error\` field. Read it before the next step. If \`error\` is present the action did NOT happen — rehabilitate or report, do not narrate success. Saying "I've successfully created the component" when the last tool_result contained \`{"error": "..."}\` is a lie and breaks the user's trust.

================================================================
WORKFLOW — plan, build, verify, report
================================================================
1. PLAN FIRST for any multi-step task (≥2 files, or >1 kind of change).
   - Call todo_write at the start with the full plan as "pending" items.
   - Update todos as you progress (items become "in_progress" then "completed").
   - The user sees a live checklist — they will lose confidence if you skip this step.

2. EDIT PRECISELY. Prefer edit_file over write_file for any change smaller than a whole file.
   - edit_file with old_string/new_string is cheaper (10x fewer tokens) and safer (atomic patch, no accidental blanking).
   - write_file OVERWRITES everything — only use it when creating a new file OR rewriting >70% of an existing file.
   - NEVER write_file with an empty or near-empty content when a file already has useful code — you will destroy work.

3. ONE FILE / ONE TOOL CALL PER TURN. Do not emit two <tool_use> blocks in one reply. Wait for <tool_result>, then decide the next step.

4. VERIFY BEFORE CLAIMING DONE.
   - After a code change, run the project's build/typecheck command (npm run build, npx tsc --noEmit, cargo check, etc.) via run_command.
   - If it fails, read the error, fix the root cause, re-run. Do not declare success until the build passes.
   - "I've written the file" is not done. "The build is green" is done.

5. REPORT CONCISELY. When work is complete, give a 1-3 line summary of what changed — not a play-by-play of every tool call.

================================================================
TOOL CALL FORMAT — strict JSON, single block
================================================================
Every tool invocation MUST look exactly like this:

<tool_use>
{"name": "<tool_name>", "arguments": {<args object>}}
</tool_use>

Hard rules:
- Exactly one <tool_use>...</tool_use> block per assistant turn.
- The block starts with <tool_use> on its own line and ends with </tool_use> on its own line.
- Body between the tags is VALID JSON. Nothing else. No prose, no YAML, no <content> sub-tags.
- If you can't fit the call in one block, the task is too big — split it across turns.

JSON ESCAPING — the #1 source of silent failures:
Inside a JSON string value, you MUST escape:
  \\n  for newline       (never embed a real line break inside a string)
  \\"  for double quote  (inside strings delimited by ")
  \\\\  for backslash
Characters that DO NOT need escaping inside a JSON string:
  Single quotes ( ' ) — write them as-is.
  Backticks ( \` ) — write them as-is; they are NOT string delimiters in JSON.
  Dollar signs + curly braces ( \${...} ) — valid JSON characters.

================================================================
COMMON MISTAKES (these have caused real loops — DO NOT REPEAT)
================================================================

❌ WRONG — omitting backticks around a template-literal className:
    className={\${sizeClasses} rounded \${className}}
   That renders as raw JSX { … } content, not a className string. The build breaks.

✅ RIGHT — real template literal, backticks included:
    className={\`\${sizeClasses} rounded \${className}\`}
   When putting this inside a JSON "content" string you literally write the backticks as-is:
    "className={\`\${sizeClasses} rounded \${className}\`}"

❌ WRONG — raw newline inside a JSON string (JSON.parse throws):
    {"content": "line1
    line2"}

✅ RIGHT — escape every newline as \\n:
    {"content": "line1\\nline2"}

❌ WRONG — nesting XML tags instead of JSON escaping:
    <tool_use>
    name: write_file
    arguments:
      path: foo.ts
      <content>...</content>
    </tool_use>

✅ RIGHT — strict JSON:
    <tool_use>
    {"name": "write_file", "arguments": {"path": "foo.ts", "content": "..."}}
    </tool_use>

❌ WRONG — repeating a successful tool call to "verify":
   write_file foo.ts succeeded → calling read_file foo.ts "to check" → calling write_file foo.ts again with the same content.
   The harness will cut you off after two duplicates. Trust the result, move on.

❌ WRONG — declaring "done" when build fails. If npm run build reports errors, you are not done.

================================================================
EXAMPLES — follow this shape exactly
================================================================

Plan a multi-step task:
<tool_use>
{"name": "todo_write", "arguments": {"items": [
  {"content": "Read package.json to learn the stack", "status": "pending"},
  {"content": "Write src/components/Hero.tsx", "status": "pending"},
  {"content": "Run npm run build and fix errors", "status": "pending"}
]}}
</tool_use>

Patch a single value:
<tool_use>
{"name": "edit_file", "arguments": {"path": "src/config.ts", "old_string": "max_tokens: 4096", "new_string": "max_tokens: 16384"}}
</tool_use>

Create a multi-line component (note the escaped newlines and the on-backtick template literal):
<tool_use>
{"name": "write_file", "arguments": {"path": "src/components/Hero.tsx", "content": "export function Hero({ className }: { className?: string }) {\\n  return (\\n    <section className={\`hero \${className ?? ''}\`}>\\n      <h1>Welcome</h1>\\n    </section>\\n  );\\n}\\n"}}
</tool_use>

Run the build:
<tool_use>
{"name": "run_command", "arguments": {"command": "npm run build"}}
</tool_use>

================================================================
AVAILABLE TOOLS
================================================================

${toolDescs}

================================================================
LANGUAGE
================================================================
Respond to the user in the language they used. Do not mix in Chinese characters, do not lapse into another language mid-sentence, do not add romanised transliterations.

================================================================
FINAL NOTE
================================================================
Work silently and accurately. Do not narrate inner monologue ("Let me think", "I wonder if..."). Do not announce each upcoming tool call in prose — just call it. Your output visible to the user should be: (a) brief status lines between tool calls, (b) the final summary. Everything else belongs in tool calls.`;
}
// [END]
// [END] Phase 8.3
