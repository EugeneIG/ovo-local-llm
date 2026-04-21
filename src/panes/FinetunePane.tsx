// [START] FinetunePane — dataset management, LoRA training, adapter list.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GraduationCap, FolderOpen, Trash2, Play, Square,
  Loader2, Merge, ChevronDown, ChevronUp, Database,
} from "lucide-react";
import { useSidecarStore } from "../store/sidecar";
import { useToastsStore } from "../store/toasts";
import {
  listDatasets, createDataset, deleteDataset,
  listAdapters, deleteAdapter, mergeAdapter,
  startTraining, getRunProgress, cancelRun, listRuns,
  type FTDataset, type FTAdapter, type TrainingRun,
} from "../lib/finetune";
import { listModels } from "../lib/api";
import { isChatCapableModel } from "../lib/models";
import { parseFile, getParseStatus, installKordoc } from "../lib/parsing";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import type { OvoModel } from "../types/ovo";

export function FinetunePane() {
  const { t } = useTranslation();
  const ports = useSidecarStore((s) => s.status.ports);
  const health = useSidecarStore((s) => s.status.health);

  const [datasets, setDatasets] = useState<FTDataset[]>([]);
  const [adapters, setAdapters] = useState<FTAdapter[]>([]);
  const [models, setModels] = useState<OvoModel[]>([]);
  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const [tab, setTab] = useState<"datasets" | "train" | "adapters">("datasets");

  const refresh = async () => {
    try {
      const [ds, ad, rs] = await Promise.all([
        listDatasets(ports), listAdapters(ports), listRuns(ports),
      ]);
      setDatasets(ds);
      setAdapters(ad);
      setRuns(rs.filter((r) => r.status === "running" || r.status === "pending"));
    } catch { /* sidecar may not be ready */ }
  };

  useEffect(() => {
    if (health !== "healthy") return;
    void refresh();
    void listModels(ports).then((r) => setModels(r.models.filter(isChatCapableModel))).catch(() => {});
  }, [health, ports]);

  if (health !== "healthy") {
    return (
      <div className="h-full flex items-center justify-center text-sm text-ovo-muted">
        {t(`sidecar.status.${health}`)}…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold text-ovo-text flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-ovo-accent" />
          {t("finetune.title")}
        </h2>
        <span className="text-xs text-ovo-muted">{t("finetune.subtitle")}</span>
      </header>

      {/* Tab switcher */}
      <div className="inline-flex rounded-md border border-ovo-border bg-ovo-surface p-0.5 mb-5">
        {(["datasets", "train", "adapters"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-3 py-1 text-xs rounded transition ${
              tab === k ? "bg-ovo-accent text-ovo-accent-ink" : "text-ovo-muted hover:text-ovo-text"
            }`}
          >
            {t(`finetune.tab_${k}`)}
          </button>
        ))}
      </div>

      {tab === "datasets" && (
        <DatasetTab datasets={datasets} ports={ports} onRefresh={refresh} />
      )}
      {tab === "train" && (
        <TrainTab datasets={datasets} models={models} runs={runs} ports={ports} onRefresh={refresh} />
      )}
      {tab === "adapters" && (
        <AdapterTab adapters={adapters} ports={ports} onRefresh={refresh} />
      )}
    </div>
  );
}

// ── Dataset Tab ─────────────────────────────────────────────

function DatasetTab({ datasets, ports, onRefresh }: {
  datasets: FTDataset[];
  ports: ReturnType<typeof useSidecarStore.getState>["status"]["ports"];
  onRefresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const dsName = name.trim();
    if (!dsName) return;
    setCreating(true);
    try {
      const status = await getParseStatus(ports);
      if (!status.ready) {
        useToastsStore.getState().push({ kind: "info", message: t("kb.install_required_title") });
        await installKordoc(ports);
      }

      const selected = await tauriOpen({ directory: true, multiple: false, title: t("finetune.select_folder") });
      if (!selected) { setCreating(false); return; }

      useToastsStore.getState().push({ kind: "info", message: t("finetune.parsing_docs") });

      const folderPath = typeof selected === "string" ? selected : selected;
      const { readDir } = await import("@tauri-apps/plugin-fs");
      const entries = await readDir(folderPath);
      const supportedExts = new Set(["pdf","hwp","hwpx","docx","xlsx","pptx","txt","md"]);

      const docs: { filename: string; full_text: string }[] = [];
      for (const entry of entries) {
        if (!entry.name) continue;
        const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
        if (!supportedExts.has(ext)) continue;
        try {
          const { readFile } = await import("@tauri-apps/plugin-fs");
          const bytes = await readFile(`${folderPath}/${entry.name}`);
          const blob = new Blob([bytes]);
          const file = new File([blob], entry.name);
          const parsed = await parseFile(file, ports);
          docs.push({ filename: parsed.filename, full_text: parsed.full_text });
        } catch (e) {
          console.warn("Skip file:", entry.name, e);
        }
      }

      if (docs.length === 0) {
        useToastsStore.getState().push({ kind: "error", message: t("finetune.no_docs") });
        setCreating(false);
        return;
      }

      const result = await createDataset(dsName, docs, ports);
      useToastsStore.getState().push({
        kind: "success",
        message: t("finetune.dataset_created", { name: dsName, docs: result.doc_count, qa: result.qa_count }),
      });
      setName("");
      await onRefresh();
    } catch (e) {
      useToastsStore.getState().push({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
          placeholder={t("finetune.dataset_name_placeholder")}
          className="flex-1 px-3 py-2 rounded-lg bg-ovo-surface border border-ovo-border text-sm text-ovo-text placeholder:text-ovo-muted focus:outline-none focus:ring-1 focus:ring-ovo-accent"
        />
        <button
          disabled={!name.trim() || creating}
          onClick={() => void handleCreate()}
          className="px-4 py-2 rounded-lg bg-ovo-accent text-white text-sm font-medium disabled:opacity-40 hover:brightness-110 transition flex items-center gap-2"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
          {t("finetune.create_dataset")}
        </button>
      </div>

      {datasets.length === 0 ? (
        <div className="text-center py-12 text-sm text-ovo-muted">
          <Database className="w-10 h-10 mx-auto mb-3 text-ovo-muted" />
          {t("finetune.no_datasets")}
        </div>
      ) : (
        <ul className="space-y-2">
          {datasets.map((ds) => (
            <li key={ds.dataset_id} className="p-3 rounded-lg bg-ovo-surface border border-ovo-border flex items-center gap-3">
              <Database className="w-4 h-4 text-ovo-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ovo-text">{ds.name}</div>
                <div className="text-[11px] text-ovo-muted">
                  {t("finetune.dataset_stats", { docs: ds.doc_count, qa: ds.qa_count })}
                  {" · "}{ds.created_at.split("T")[0]}
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm(t("finetune.confirm_delete_dataset", { name: ds.name }))) return;
                  await deleteDataset(ds.dataset_id, ports);
                  await onRefresh();
                }}
                className="p-1 rounded text-ovo-muted hover:text-rose-500 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Train Tab ───────────────────────────────────────────────

function TrainTab({ datasets, models, runs, ports, onRefresh }: {
  datasets: FTDataset[];
  models: OvoModel[];
  runs: TrainingRun[];
  ports: ReturnType<typeof useSidecarStore.getState>["status"]["ports"];
  onRefresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [adapterName, setAdapterName] = useState("");
  const [selectedDataset, setSelectedDataset] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [epochs, setEpochs] = useState(3);
  const [lr, setLr] = useState(1e-4);
  const [rank, setRank] = useState(8);
  const [starting, setStarting] = useState(false);

  const [activeRun, setActiveRun] = useState<TrainingRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (runs.length > 0) setActiveRun(runs[0]);
  }, [runs]);

  useEffect(() => {
    if (!activeRun || (activeRun.status !== "running" && activeRun.status !== "pending")) return;
    pollRef.current = setInterval(async () => {
      try {
        const updated = await getRunProgress(activeRun.run_id, ports);
        setActiveRun(updated);
        if (updated.status === "done" || updated.status === "error" || updated.status === "cancelled") {
          if (pollRef.current) clearInterval(pollRef.current);
          await onRefresh();
          useToastsStore.getState().push({
            kind: updated.status === "done" ? "success" : "error",
            message: updated.status === "done"
              ? t("finetune.train_done", { name: updated.adapter_name })
              : updated.error ?? "Training failed",
          });
        }
      } catch { /* swallow */ }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeRun?.run_id, activeRun?.status, ports, onRefresh, t]);

  const handleStart = async () => {
    if (!adapterName.trim() || !selectedDataset || !selectedModel) return;
    setStarting(true);
    try {
      const result = await startTraining({
        adapter_name: adapterName.trim(),
        base_model: selectedModel,
        dataset_id: selectedDataset,
        epochs, learning_rate: lr, lora_rank: rank,
      }, ports);
      const run = await getRunProgress(result.run_id, ports);
      setActiveRun(run);
      useToastsStore.getState().push({ kind: "info", message: t("finetune.train_started", { name: adapterName }) });
    } catch (e) {
      useToastsStore.getState().push({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Active training progress */}
      {activeRun && (activeRun.status === "running" || activeRun.status === "pending") && (
        <div className="p-4 rounded-xl bg-ovo-accent/10 border border-ovo-accent/30">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-ovo-text flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-ovo-accent" />
              {activeRun.adapter_name}
            </div>
            <button
              type="button"
              onClick={async () => {
                await cancelRun(activeRun.run_id, ports);
                setActiveRun(null);
              }}
              className="text-xs text-rose-500 hover:text-rose-400 transition"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="w-full h-2 rounded-full bg-ovo-border overflow-hidden mb-2">
            <div
              className="h-full bg-ovo-accent rounded-full transition-all"
              style={{ width: `${Math.round(activeRun.progress * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-ovo-muted">
            <span>{t("finetune.epoch")} {activeRun.current_epoch}/{activeRun.total_epochs}</span>
            <span>loss: {activeRun.train_loss.toFixed(4)}</span>
            <span>{Math.round(activeRun.elapsed_seconds)}s</span>
          </div>
        </div>
      )}

      {/* New training form */}
      <div className="space-y-3">
        <input
          type="text"
          value={adapterName}
          onChange={(e) => setAdapterName(e.target.value)}
          placeholder={t("finetune.adapter_name_placeholder")}
          className="w-full px-3 py-2 rounded-lg bg-ovo-surface border border-ovo-border text-sm text-ovo-text placeholder:text-ovo-muted focus:outline-none focus:ring-1 focus:ring-ovo-accent"
        />

        <div className="grid grid-cols-2 gap-3">
          <select
            value={selectedDataset}
            onChange={(e) => setSelectedDataset(e.target.value)}
            className="px-3 py-2 rounded-lg bg-ovo-surface border border-ovo-border text-sm text-ovo-text focus:outline-none focus:ring-1 focus:ring-ovo-accent"
          >
            <option value="">{t("finetune.select_dataset")}</option>
            {datasets.map((d) => (
              <option key={d.dataset_id} value={d.dataset_id}>
                {d.name} ({d.qa_count} Q&A)
              </option>
            ))}
          </select>

          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="px-3 py-2 rounded-lg bg-ovo-surface border border-ovo-border text-sm text-ovo-text focus:outline-none focus:ring-1 focus:ring-ovo-accent"
          >
            <option value="">{t("finetune.select_model")}</option>
            {models.map((m) => (
              <option key={m.repo_id} value={m.repo_id}>
                {m.repo_id.split("/").pop()}
              </option>
            ))}
          </select>
        </div>

        {/* Advanced settings */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-xs text-ovo-muted hover:text-ovo-text transition"
        >
          {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {t("finetune.advanced")}
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-ovo-surface border border-ovo-border">
            <label className="text-xs text-ovo-muted">
              {t("finetune.epochs")}
              <input type="number" min={1} max={50} value={epochs} onChange={(e) => setEpochs(Number(e.target.value))}
                className="mt-1 w-full px-2 py-1 rounded bg-ovo-bg border border-ovo-border text-sm text-ovo-text" />
            </label>
            <label className="text-xs text-ovo-muted">
              {t("finetune.learning_rate")}
              <input type="number" step={0.00001} value={lr} onChange={(e) => setLr(Number(e.target.value))}
                className="mt-1 w-full px-2 py-1 rounded bg-ovo-bg border border-ovo-border text-sm text-ovo-text" />
            </label>
            <label className="text-xs text-ovo-muted">
              LoRA Rank
              <input type="number" min={4} max={64} value={rank} onChange={(e) => setRank(Number(e.target.value))}
                className="mt-1 w-full px-2 py-1 rounded bg-ovo-bg border border-ovo-border text-sm text-ovo-text" />
            </label>
          </div>
        )}

        <button
          disabled={!adapterName.trim() || !selectedDataset || !selectedModel || starting}
          onClick={() => void handleStart()}
          className="w-full px-4 py-2.5 rounded-lg bg-ovo-accent text-white text-sm font-medium disabled:opacity-40 hover:brightness-110 transition flex items-center justify-center gap-2"
        >
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {t("finetune.start_training")}
        </button>
      </div>
    </div>
  );
}

// ── Adapter Tab ─────────────────────────────────────────────

function AdapterTab({ adapters, ports, onRefresh }: {
  adapters: FTAdapter[];
  ports: ReturnType<typeof useSidecarStore.getState>["status"]["ports"];
  onRefresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [merging, setMerging] = useState<Set<string>>(new Set());

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  if (adapters.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-ovo-muted">
        <GraduationCap className="w-10 h-10 mx-auto mb-3 text-ovo-muted" />
        {t("finetune.no_adapters")}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {adapters.map((a) => (
        <li key={a.adapter_id} className="p-3 rounded-lg bg-ovo-surface border border-ovo-border">
          <div className="flex items-center gap-3">
            <GraduationCap className="w-4 h-4 text-ovo-accent shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ovo-text flex items-center gap-2">
                {a.name}
                {a.merged && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    {t("finetune.merged")}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-ovo-muted">
                {a.base_model.split("/").pop()} · {a.dataset_name} · {formatSize(a.size_bytes)}
              </div>
            </div>

            {!a.merged && (
              <button
                type="button"
                disabled={merging.has(a.adapter_id)}
                onClick={async () => {
                  setMerging((s) => new Set(s).add(a.adapter_id));
                  try {
                    await mergeAdapter(a.adapter_id, ports);
                    useToastsStore.getState().push({ kind: "success", message: t("finetune.merge_done", { name: a.name }) });
                    await onRefresh();
                  } catch (e) {
                    useToastsStore.getState().push({ kind: "error", message: e instanceof Error ? e.message : String(e) });
                  } finally {
                    setMerging((s) => { const n = new Set(s); n.delete(a.adapter_id); return n; });
                  }
                }}
                className="p-1.5 rounded text-ovo-muted hover:text-ovo-accent transition disabled:opacity-40"
                title={t("finetune.merge_btn")}
              >
                {merging.has(a.adapter_id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Merge className="w-3.5 h-3.5" />}
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(t("finetune.confirm_delete_adapter", { name: a.name }))) return;
                await deleteAdapter(a.adapter_id, ports);
                await onRefresh();
              }}
              className="p-1.5 rounded text-ovo-muted hover:text-rose-500 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
// [END]
