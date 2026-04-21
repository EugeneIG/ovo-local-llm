// [START] Knowledge Base management panel — create, list, toggle, ingest, delete KBs.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Plus, Trash2, FolderOpen, Loader2, Check, AlertCircle, Download } from "lucide-react";
import { useKBStore } from "../store/knowledge_base";
import { useSidecarStore } from "../store/sidecar";
import { useToastsStore } from "../store/toasts";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";

export function KnowledgeBasePanel() {
  const { t } = useTranslation();
  const ports = useSidecarStore((s) => s.status.ports);
  const kbs = useKBStore((s) => s.kbs);
  const activeKBIds = useKBStore((s) => s.activeKBIds);
  const kordocStatus = useKBStore((s) => s.kordocStatus);
  const installing = useKBStore((s) => s.installing);
  const loading = useKBStore((s) => s.loading);
  const refresh = useKBStore((s) => s.refresh);
  const checkKordoc = useKBStore((s) => s.checkKordoc);
  const installRuntime = useKBStore((s) => s.installRuntime);
  const createKB = useKBStore((s) => s.create);
  const removeKB = useKBStore((s) => s.remove);
  const toggleActive = useKBStore((s) => s.toggleActive);
  const ingest = useKBStore((s) => s.ingest);
  const pollIngest = useKBStore((s) => s.pollIngest);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [ingesting, setIngesting] = useState<Record<string, { progress: number; file: string }>>({});

  useEffect(() => {
    void checkKordoc(ports);
    void refresh(ports);
  }, [ports, checkKordoc, refresh]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createKB(name, ports);
      setNewName("");
      useToastsStore.getState().push({ kind: "success", message: t("kb.created", { name }) });
    } catch (e) {
      useToastsStore.getState().push({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setCreating(false);
    }
  };

  const handleIngest = async (kbId: string) => {
    try {
      const selected = await tauriOpen({ directory: true, multiple: false, title: t("kb.select_folder") });
      if (!selected) return;
      const folderPath = typeof selected === "string" ? selected : selected;
      const taskId = await ingest(kbId, [folderPath], ports);

      const poll = setInterval(async () => {
        try {
          const progress = await pollIngest(kbId, taskId, ports);
          setIngesting((prev) => ({
            ...prev,
            [kbId]: { progress: progress.progress, file: progress.current_file },
          }));
          if (progress.status === "done" || progress.status === "done_with_errors") {
            clearInterval(poll);
            setIngesting((prev) => {
              const next = { ...prev };
              delete next[kbId];
              return next;
            });
            await refresh(ports);
            useToastsStore.getState().push({
              kind: progress.error ? "error" : "success",
              message: progress.error
                ? t("kb.ingest_error", { error: progress.error })
                : t("kb.ingest_done", { count: progress.parsed }),
            });
          }
        } catch {
          clearInterval(poll);
        }
      }, 1500);
    } catch (e) {
      useToastsStore.getState().push({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleDelete = async (kbId: string, name: string) => {
    if (!window.confirm(t("kb.confirm_delete", { name }))) return;
    try {
      await removeKB(kbId, ports);
      useToastsStore.getState().push({ kind: "info", message: t("kb.deleted", { name }) });
    } catch (e) {
      useToastsStore.getState().push({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  // kordoc not installed — show install prompt
  if (kordocStatus && !kordocStatus.ready) {
    return (
      <div className="p-3 rounded-lg bg-ovo-surface border border-ovo-border">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-medium text-ovo-text">{t("kb.install_required_title")}</span>
        </div>
        <p className="text-[11px] text-ovo-muted mb-3">{t("kb.install_required_desc")}</p>
        <button
          disabled={installing}
          onClick={() => void installRuntime(ports)}
          className="w-full px-3 py-1.5 rounded-lg bg-ovo-accent text-white text-xs font-medium disabled:opacity-40 hover:brightness-110 transition flex items-center justify-center gap-2"
        >
          {installing ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("kb.installing")}</>
          ) : (
            <><Download className="w-3.5 h-3.5" /> {t("kb.install_btn")}</>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-ovo-accent" />
        <span className="text-xs font-semibold text-ovo-text">{t("kb.title")}</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-ovo-muted" />}
      </div>

      {/* Create new KB */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
          placeholder={t("kb.new_placeholder")}
          className="flex-1 px-2.5 py-1.5 rounded-lg bg-ovo-surface border border-ovo-border text-xs text-ovo-text placeholder:text-ovo-muted focus:outline-none focus:ring-1 focus:ring-ovo-accent"
        />
        <button
          disabled={!newName.trim() || creating}
          onClick={() => void handleCreate()}
          className="px-2.5 py-1.5 rounded-lg bg-ovo-accent text-white text-xs font-medium disabled:opacity-40 hover:brightness-110 transition"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* KB List */}
      {kbs.length === 0 ? (
        <p className="text-[11px] text-ovo-muted text-center py-4">{t("kb.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {kbs.map((kb) => {
            const active = activeKBIds.includes(kb.kb_id);
            const ingestState = ingesting[kb.kb_id];
            return (
              <li
                key={kb.kb_id}
                className={`p-2.5 rounded-lg border transition ${
                  active
                    ? "bg-ovo-accent/10 border-ovo-accent/30"
                    : "bg-ovo-surface border-ovo-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  {/* Toggle active */}
                  <button
                    type="button"
                    onClick={() => toggleActive(kb.kb_id)}
                    className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                      active ? "bg-ovo-accent border-ovo-accent" : "border-ovo-border"
                    }`}
                    title={active ? t("kb.deactivate") : t("kb.activate")}
                  >
                    {active && <Check className="w-3 h-3 text-white" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-ovo-text truncate">{kb.name}</div>
                    <div className="text-[10px] text-ovo-muted">
                      {t("kb.stats", { docs: kb.doc_count, chunks: kb.chunk_count })}
                    </div>
                  </div>

                  {/* Ingest folder */}
                  <button
                    type="button"
                    onClick={() => void handleIngest(kb.kb_id)}
                    disabled={!!ingestState}
                    className="p-1 rounded text-ovo-muted hover:text-ovo-accent transition disabled:opacity-40"
                    title={t("kb.add_docs")}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => void handleDelete(kb.kb_id, kb.name)}
                    className="p-1 rounded text-ovo-muted hover:text-rose-500 transition"
                    title={t("kb.delete")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Ingest progress bar */}
                {ingestState && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Loader2 className="w-3 h-3 animate-spin text-ovo-accent" />
                      <span className="text-[10px] text-ovo-muted truncate">{ingestState.file}</span>
                    </div>
                    <div className="w-full h-1 rounded-full bg-ovo-border overflow-hidden">
                      <div
                        className="h-full bg-ovo-accent rounded-full transition-all"
                        style={{ width: `${Math.round(ingestState.progress * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Hint */}
      {kbs.length > 0 && (
        <p className="text-[10px] text-ovo-muted leading-relaxed">
          {t("kb.hint")}
        </p>
      )}
    </div>
  );
}
// [END]
