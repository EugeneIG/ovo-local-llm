// [START] Phase 8 + 8.2 + 8.3 + Phase 5 — Full Code IDE pane with resizable panels
import { useCallback, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Code2,
  FolderOpen,
  Files,
  GitBranch as GitBranchIcon,
  Search,
  Settings2,
  TerminalSquare,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  Eye,
  EyeOff,
} from "lucide-react";
import { useCodeEditorStore } from "../store/code_editor";
import { useCodeSessionsStore } from "../store/code_sessions";
import { useSidecarStore } from "../store/sidecar";
import { updateCodeSessionModel } from "../db/code_sessions";
import { unloadLoadedModels } from "../lib/api";
import { FileExplorer } from "../components/code/FileExplorer";
import { EditorTabs } from "../components/code/EditorTabs";
import { MonacoEditor } from "../components/code/MonacoEditor";
import { Terminal } from "../components/code/Terminal";
import { GitPanel } from "../components/code/GitPanel";
import { SearchPanel } from "../components/code/SearchPanel";
import { AgentChat } from "../components/code/AgentChat";
import { ResizeHandle } from "../components/code/ResizeHandle";
import { QuickOpen } from "../components/code/QuickOpen";
import { CodeSettingsModal } from "../components/code/CodeSettingsModal";
import { MarkdownPreview } from "../components/code/MarkdownPreview";

type SidebarMode = "explorer" | "git" | "search";

// [START] Default panel sizes (pixels / percentage)
const DEFAULT_EXPLORER_WIDTH = 208;   // w-52
const MIN_EXPLORER_WIDTH = 140;
const MAX_EXPLORER_WIDTH = 400;

const DEFAULT_AGENT_WIDTH = 288;      // w-72
const MIN_AGENT_WIDTH = 200;
const MAX_AGENT_WIDTH = 500;

const DEFAULT_TERMINAL_PERCENT = 35;
const MIN_TERMINAL_PERCENT = 15;
const MAX_TERMINAL_PERCENT = 70;
// [END]

export function CodePane() {
  const { t } = useTranslation();
  const projectPath = useCodeEditorStore((s) => s.projectPath);
  const fileTree = useCodeEditorStore((s) => s.fileTree);
  const openTabs = useCodeEditorStore((s) => s.openTabs);
  const activeTabPath = useCodeEditorStore((s) => s.activeTabPath);
  const expandedDirs = useCodeEditorStore((s) => s.expandedDirs);
  const pickFolder = useCodeEditorStore((s) => s.pickFolder);
  const setProjectPath = useCodeEditorStore((s) => s.setProjectPath);
  const openFile = useCodeEditorStore((s) => s.openFile);
  const closeTab = useCodeEditorStore((s) => s.closeTab);
  const setActiveTab = useCodeEditorStore((s) => s.setActiveTab);
  const updateTabContent = useCodeEditorStore((s) => s.updateTabContent);
  const saveFile = useCodeEditorStore((s) => s.saveFile);
  const toggleDir = useCodeEditorStore((s) => s.toggleDir);
  const createSession = useCodeSessionsStore((s) => s.createSession);
  const currentSessionId = useCodeSessionsStore((s) => s.currentSessionId);
  const currentSession = useCodeSessionsStore((s) =>
    s.sessions.find((se) => se.id === s.currentSessionId),
  );
  const ports = useSidecarStore((s) => s.status.ports);

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("explorer");
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [agentVisible, setAgentVisible] = useState(true);

  // [START] Phase 5 — Markdown Preview toggle.
  // Local state (not persisted) because the behaviour is per-session:
  // opening a fresh file often means the user wants to write first and
  // preview second. Auto-turns off when the active tab isn't markdown so
  // the layout doesn't break for non-md files.
  const [mdPreviewOpen, setMdPreviewOpen] = useState(false);
  // [END]

  // [START] Phase 5 — Quick Open + Settings + Search auto-focus trigger.
  // searchFocusKey is bumped every time the user requests the search panel
  // via keybinding so `SearchPanel` can refocus its input without us
  // holding a ref across the component boundary.
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [searchFocusKey, setSearchFocusKey] = useState(0);
  // [END]

  // [START] Resizable panel state
  const [explorerWidth, setExplorerWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const [agentWidth, setAgentWidth] = useState(DEFAULT_AGENT_WIDTH);
  const [terminalPercent, setTerminalPercent] = useState(DEFAULT_TERMINAL_PERCENT);
  const centerRef = useRef<HTMLDivElement>(null);
  // [END]

  const activeTab = openTabs.find((tab) => tab.path === activeTabPath) ?? null;

  const handleOpenFolder = useCallback(async () => {
    const folder = await pickFolder();
    if (!folder) return;
    await createSession(folder);
    await setProjectPath(folder);
  }, [pickFolder, createSession, setProjectPath]);

  const handleEditorChange = useCallback(
    (value: string) => {
      if (activeTabPath) {
        updateTabContent(activeTabPath, value);
      }
    },
    [activeTabPath, updateTabContent],
  );

  const handleSave = useCallback(() => {
    if (activeTabPath) {
      void saveFile(activeTabPath);
    }
  }, [activeTabPath, saveFile]);

  // [START] Model change — unload existing chat/image models to free unified memory
  const handleModelChange = useCallback(async (newModelRef: string) => {
    try {
      await unloadLoadedModels(ports);
    } catch {
      // best-effort
    }
    if (currentSessionId) {
      await updateCodeSessionModel(currentSessionId, newModelRef);
      useCodeSessionsStore.setState((s) => ({
        sessions: s.sessions.map((se) =>
          se.id === currentSessionId ? { ...se, model_ref: newModelRef } : se,
        ),
      }));
    }
  }, [currentSessionId, ports]);
  // [END]

  // [START] Resize handlers
  const handleExplorerResize = useCallback((delta: number) => {
    setExplorerWidth((w) => Math.max(MIN_EXPLORER_WIDTH, Math.min(MAX_EXPLORER_WIDTH, w + delta)));
  }, []);

  const handleAgentResize = useCallback((delta: number) => {
    setAgentWidth((w) => Math.max(MIN_AGENT_WIDTH, Math.min(MAX_AGENT_WIDTH, w - delta)));
  }, []);

  const handleTerminalResize = useCallback((delta: number) => {
    if (!centerRef.current) return;
    const height = centerRef.current.clientHeight;
    if (height <= 0) return;
    const deltaPercent = (delta / height) * -100;
    setTerminalPercent((p) => Math.max(MIN_TERMINAL_PERCENT, Math.min(MAX_TERMINAL_PERCENT, p + deltaPercent)));
  }, []);
  // [END]

  // [START] Phase 5 — global IDE keybindings.
  // Scoped to this pane via a `window.addEventListener` inside the effect;
  // we check `projectPath` before acting so the welcome screen doesn't
  // intercept Cmd+P etc. (those keys are meaningless without a project).
  //
  // Cmd+S is handled inside MonacoEditor's addAction — keeping it there
  // ensures the editor is focused when save fires and avoids the ordering
  // race that'd exist if we pushed it up here.
  useEffect(() => {
    if (!projectPath) return;
    const onKey = (e: KeyboardEvent) => {
      const metaOrCtrl = e.metaKey || e.ctrlKey;
      if (!metaOrCtrl) return;

      // Cmd+P — Quick Open. Skip when Shift is held (Cmd+Shift+P is VSCode's
      // command palette, which we don't implement yet — reserve the slot).
      if (e.key === "p" && !e.shiftKey) {
        e.preventDefault();
        setQuickOpenVisible(true);
        return;
      }

      // Cmd+Shift+F — project search. Switch sidebar to search + bump focus key.
      if (e.key.toLowerCase() === "f" && e.shiftKey) {
        e.preventDefault();
        setSidebarMode("search");
        setSearchFocusKey((k) => k + 1);
        return;
      }

      // Cmd+Shift+E — file explorer.
      if (e.key.toLowerCase() === "e" && e.shiftKey) {
        e.preventDefault();
        setSidebarMode("explorer");
        return;
      }

      // Cmd+Shift+G — git panel.
      if (e.key.toLowerCase() === "g" && e.shiftKey) {
        e.preventDefault();
        setSidebarMode("git");
        return;
      }

      // Cmd+` — toggle terminal.
      if (e.key === "`") {
        e.preventDefault();
        setTerminalVisible((v) => !v);
        return;
      }

      // Cmd+W — close active tab. Don't fire if no active tab — otherwise
      // the keystroke would bubble and maybe close the whole window.
      if (e.key.toLowerCase() === "w" && !e.shiftKey) {
        if (useCodeEditorStore.getState().activeTabPath) {
          e.preventDefault();
          const path = useCodeEditorStore.getState().activeTabPath;
          if (path) useCodeEditorStore.getState().closeTab(path);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectPath]);
  // [END]

  // [START] No project — welcome screen
  if (!projectPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
        <Code2 className="w-12 h-12 text-ovo-muted" aria-hidden />
        <h2 className="text-lg font-semibold text-ovo-text">{t("code.title")}</h2>
        <p className="text-sm text-ovo-muted max-w-md">{t("code.no_project")}</p>
        <button
          type="button"
          onClick={() => void handleOpenFolder()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ovo-accent text-ovo-accent-ink hover:bg-ovo-accent-hover transition text-sm font-medium"
        >
          <FolderOpen className="w-4 h-4" />
          {t("code.open_folder")}
        </button>
      </div>
    );
  }
  // [END]

  return (
    <div className="h-full flex overflow-hidden">
      {/* [START] Activity bar */}
      <div className="w-10 shrink-0 bg-ovo-surface border-r border-ovo-border flex flex-col items-center pt-2 gap-1">
        <ToolbarButton
          icon={Files}
          active={sidebarMode === "explorer"}
          onClick={() => setSidebarMode("explorer")}
          title={t("code.file_explorer")}
        />
        <ToolbarButton
          icon={Search}
          active={sidebarMode === "search"}
          onClick={() => setSidebarMode("search")}
          title={t("code.search.title")}
        />
        <ToolbarButton
          icon={GitBranchIcon}
          active={sidebarMode === "git"}
          onClick={() => setSidebarMode("git")}
          title={t("code.git.title")}
        />
        <div className="flex-1" />
        <ToolbarButton
          icon={terminalVisible ? PanelBottomClose : PanelBottomOpen}
          active={terminalVisible}
          onClick={() => setTerminalVisible((v) => !v)}
          title={t("code.terminal.title")}
        />
        <ToolbarButton
          icon={agentVisible ? PanelRightClose : PanelRightOpen}
          active={agentVisible}
          onClick={() => setAgentVisible((v) => !v)}
          title={t("code.agent.title")}
        />
        {/* [START] Phase 5 — editor settings entry */}
        <ToolbarButton
          icon={Settings2}
          active={settingsVisible}
          onClick={() => setSettingsVisible(true)}
          title={t("code.settings.title")}
        />
        {/* [END] */}
        <div className="h-2" />
      </div>
      {/* [END] */}

      {/* [START] Left panel — explorer / search / git (resizable) */}
      <div
        className="shrink-0 border-r border-ovo-border bg-ovo-surface flex flex-col overflow-hidden"
        style={{ width: explorerWidth }}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-ovo-border shrink-0">
          <button
            type="button"
            onClick={() => void handleOpenFolder()}
            className="p-1 rounded hover:bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text transition"
            title={t("code.open_folder")}
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-medium text-ovo-text truncate flex-1">
            {projectPath.split("/").pop() ?? projectPath}
          </span>
        </div>
        {sidebarMode === "explorer" && (
          <FileExplorer
            tree={fileTree}
            expandedDirs={expandedDirs}
            onToggleDir={toggleDir}
            onOpenFile={(path) => void openFile(path)}
          />
        )}
        {sidebarMode === "search" && (
          <SearchPanel
            projectRoot={projectPath}
            onOpenFile={(path) => void openFile(path)}
            focusKey={searchFocusKey}
          />
        )}
        {sidebarMode === "git" && <GitPanel projectRoot={projectPath} />}
      </div>

      {/* Resize handle: explorer ↔ editor */}
      <ResizeHandle direction="horizontal" onResize={handleExplorerResize} />
      {/* [END] */}

      {/* [START] Center — editor + terminal (resizable split) */}
      <div ref={centerRef} className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Editor area */}
        <div className="flex flex-col min-w-0 overflow-hidden" style={{ flex: terminalVisible ? `1 1 ${100 - terminalPercent}%` : "1 1 100%" }}>
          <EditorTabs
            tabs={openTabs}
            activeTabPath={activeTabPath}
            onSelect={setActiveTab}
            onClose={closeTab}
          />
          <div className="flex-1 min-h-0 flex min-w-0">
            {activeTab ? (
              <>
                {/* [START] Phase 5 — Markdown preview split.
                    When the active tab is markdown AND preview is toggled
                    on, we render Monaco and the preview side-by-side at
                    50/50. The toggle button only appears for .md tabs so
                    non-markdown files don't clutter the editor chrome. */}
                <div className="flex-1 min-w-0 relative">
                  {activeTab.language === "markdown" && (
                    <button
                      type="button"
                      onClick={() => setMdPreviewOpen((v) => !v)}
                      title={
                        mdPreviewOpen
                          ? t("code.md_preview.hide")
                          : t("code.md_preview.show")
                      }
                      aria-pressed={mdPreviewOpen}
                      className={`absolute top-2 right-3 z-20 p-1 rounded transition ${
                        mdPreviewOpen
                          ? "bg-ovo-accent/20 text-ovo-accent"
                          : "bg-ovo-surface-solid/80 text-ovo-muted hover:text-ovo-text hover:bg-ovo-surface-solid"
                      }`}
                    >
                      {mdPreviewOpen ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                  <MonacoEditor
                    path={activeTab.path}
                    content={activeTab.content}
                    language={activeTab.language}
                    onChange={handleEditorChange}
                    onSave={handleSave}
                    completionModelRef={currentSession?.model_ref ?? null}
                  />
                </div>
                {activeTab.language === "markdown" && mdPreviewOpen && (
                  <>
                    <div className="w-px bg-ovo-border shrink-0" />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <MarkdownPreview
                        content={activeTab.content}
                        path={activeTab.path}
                      />
                    </div>
                  </>
                )}
                {/* [END] */}
              </>
            ) : (
              <div className="h-full w-full flex items-center justify-center text-sm text-ovo-muted">
                {openTabs.length === 0 ? t("code.no_project") : t("code.select_file")}
              </div>
            )}
          </div>
        </div>

        {/* Resize handle: editor ↔ terminal */}
        {terminalVisible && (
          <ResizeHandle direction="vertical" onResize={handleTerminalResize} />
        )}

        {/* Terminal panel */}
        {terminalVisible && (
          <div className="overflow-hidden" style={{ flex: `0 0 ${terminalPercent}%`, minHeight: 80 }}>
            <div className="flex items-center justify-between px-3 py-1 bg-ovo-surface border-b border-ovo-border shrink-0">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ovo-muted">
                <TerminalSquare className="w-3 h-3" />
                {t("code.terminal.title")}
              </div>
            </div>
            <div className="h-[calc(100%-24px)]">
              <Terminal projectRoot={projectPath} visible={terminalVisible} />
            </div>
          </div>
        )}
      </div>
      {/* [END] */}

      {/* [START] Right — Agent chat (resizable) */}
      {agentVisible && currentSessionId && (
        <>
          {/* Resize handle: editor ↔ agent */}
          <ResizeHandle direction="horizontal" onResize={handleAgentResize} />
          <div
            className="shrink-0 border-l border-ovo-border overflow-hidden"
            style={{ width: agentWidth }}
          >
            <AgentChat
              sessionId={currentSessionId}
              modelRef={currentSession?.model_ref ?? null}
              onModelChange={(ref) => void handleModelChange(ref)}
            />
          </div>
        </>
      )}
      {/* [END] */}

      {/* [START] Phase 5 — Quick Open + Settings modals */}
      {quickOpenVisible && (
        <QuickOpen
          tree={fileTree}
          onPick={(path) => {
            void openFile(path);
            setQuickOpenVisible(false);
          }}
          onClose={() => setQuickOpenVisible(false)}
        />
      )}
      {settingsVisible && (
        <CodeSettingsModal onClose={() => setSettingsVisible(false)} />
      )}
      {/* [END] */}
    </div>
  );
}

// [START] Toolbar icon button
function ToolbarButton({
  icon: Icon,
  active,
  onClick,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition ${
        active
          ? "text-ovo-accent bg-ovo-nav-active"
          : "text-ovo-muted hover:text-ovo-text hover:bg-ovo-nav-active-hover"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
// [END] Phase 8 + 8.2 + 8.3
