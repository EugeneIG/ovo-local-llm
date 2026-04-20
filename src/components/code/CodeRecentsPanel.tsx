// [START] Phase 8 — Code sessions recents panel (sidebar)
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Pin, Trash2 } from "lucide-react";
import { useCodeSessionsStore } from "../../store/code_sessions";
import { useCodeEditorStore } from "../../store/code_editor";

export function CodeRecentsPanel() {
  const { t } = useTranslation();
  const sessions = useCodeSessionsStore((s) => s.sessions);
  const currentSessionId = useCodeSessionsStore((s) => s.currentSessionId);
  const searchQuery = useCodeSessionsStore((s) => s.searchQuery);
  const selectSession = useCodeSessionsStore((s) => s.selectSession);
  const deleteSession = useCodeSessionsStore((s) => s.deleteSession);
  const togglePinned = useCodeSessionsStore((s) => s.togglePinned);
  const setSearchQuery = useCodeSessionsStore((s) => s.setSearchQuery);
  const setProjectPath = useCodeEditorStore((s) => s.setProjectPath);
  const pickFolder = useCodeEditorStore((s) => s.pickFolder);
  const createSession = useCodeSessionsStore((s) => s.createSession);

  useEffect(() => {
    void useCodeSessionsStore.getState().load();
  }, []);

  const filtered = sessions.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.project_path.toLowerCase().includes(q)
    );
  });

  const pinned = filtered.filter((s) => s.pinned);
  const recent = filtered.filter((s) => !s.pinned);

  async function handleNewSession() {
    const folder = await pickFolder();
    if (!folder) return;
    await createSession(folder);
    await setProjectPath(folder);
  }

  async function handleSelect(sessionId: string, projectPath: string) {
    selectSession(sessionId);
    await setProjectPath(projectPath);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search */}
      <div className="px-3 py-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("code.recents.search_placeholder")}
          className="w-full text-xs px-2 py-1.5 rounded bg-ovo-bg border border-ovo-border text-ovo-text placeholder:text-ovo-muted focus:outline-none focus:ring-1 focus:ring-ovo-accent"
        />
      </div>

      {/* New session button */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => void handleNewSession()}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded bg-ovo-accent text-ovo-accent-ink hover:bg-ovo-accent-hover transition"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          {t("code.recents.new")}
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2">
        {sessions.length === 0 && (
          <p className="text-xs text-ovo-muted text-center py-6">
            {t("code.recents.empty")}
          </p>
        )}

        {/* Pinned */}
        {pinned.length > 0 && (
          <>
            <div className="text-[9px] font-semibold uppercase tracking-widest text-ovo-muted px-1 pt-2 pb-1">
              {t("code.recents.pinned")}
            </div>
            {pinned.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                isActive={s.id === currentSessionId}
                onSelect={() => void handleSelect(s.id, s.project_path)}
                onDelete={() => void deleteSession(s.id)}
                onTogglePin={() => void togglePinned(s.id)}
              />
            ))}
          </>
        )}

        {/* Recent */}
        {recent.length > 0 && (
          <>
            <div className="text-[9px] font-semibold uppercase tracking-widest text-ovo-muted px-1 pt-2 pb-1">
              {t("code.recents.recent")}
            </div>
            {recent.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                isActive={s.id === currentSessionId}
                onSelect={() => void handleSelect(s.id, s.project_path)}
                onDelete={() => void deleteSession(s.id)}
                onTogglePin={() => void togglePinned(s.id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// [START] Individual session row
import type { CodeSession } from "../../types/code";

function SessionRow({
  session,
  isActive,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  session: CodeSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition text-xs ${
        isActive
          ? "bg-ovo-nav-active text-ovo-text"
          : "text-ovo-muted hover:bg-ovo-surface-solid hover:text-ovo-text"
      }`}
    >
      <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-400" />
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{session.title}</div>
        <div className="truncate text-[10px] opacity-60">
          {session.project_path.split("/").slice(-2).join("/")}
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          className={`p-0.5 rounded hover:bg-ovo-border ${session.pinned ? "text-ovo-accent" : ""}`}
          title={session.pinned ? "Unpin" : "Pin"}
        >
          <Pin className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-0.5 rounded hover:bg-rose-500/20 text-ovo-muted hover:text-rose-400"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
// [END] Phase 8
