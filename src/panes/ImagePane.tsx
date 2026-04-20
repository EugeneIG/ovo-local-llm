import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, StopCircle, Trash2 } from "lucide-react";
import {
  deleteImage,
  imageRawUrl,
  listImagesGallery,
  listModels,
  upscaleImage,
} from "../lib/api";
import { isImageGenModel } from "../lib/models";
import { useSidecarStore } from "../store/sidecar";
import { useImageGenStore } from "../store/image_gen";
import { useToastsStore } from "../store/toasts";
import { ModelSelector } from "../components/ModelSelector";
import { ImageSettingsPanel } from "../components/ImageSettingsPanel";
import { SidecarOfflineCard } from "../components/SidecarOfflineCard";
import type { OvoModel } from "../types/ovo";

// [START] Phase 7 — Image generation pane.
// Three-column layout:
//   left  — prompt + generate + gallery
//   right — settings (sampler/size/steps/cfg/seed/batch/shift/lora/control)
// Top bar: image-gen model picker + HF search for new image models.

export function ImagePane() {
  const { t } = useTranslation();
  const sidecar = useSidecarStore((s) => s.status);
  const toast = useToastsStore((s) => s.push);

  const {
    model,
    prompt,
    generating,
    progress,
    loading_model_ref,
    last_error,
    session_gallery,
    setModel,
    setPrompt,
    generate,
    stop,
    clearGallery,
  } = useImageGenStore();

  const [models, setModels] = useState<OvoModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [diskGallery, setDiskGallery] = useState<string[]>([]);

  // [START] Phase 7 — lightbox (double-click to expand gallery image)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxSrc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);
  // [END]

  // [START] Phase 7 — upscale-in-progress banner (blocks duplicate clicks).
  const [upscaling, setUpscaling] = useState(false);
  // [END]

  // [START] Phase 7 — right-click custom menu. Tauri's native webview menu
  // surfaces "Open Image in New Window" / "Copy Image" etc. but most of
  // those actions are no-ops inside the sandbox. We intercept contextmenu
  // and render our own menu with the actions that actually work.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    path: string;
    src: string;
  } | null>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [ctxMenu]);
  // [END]

  // [START] Phase 7 — reusable refresh so download completion can call it too
  async function refreshModels(): Promise<void> {
    if (sidecar.health !== "healthy") return;
    try {
      const resp = await listModels(sidecar.ports);
      const imageModels = resp.models.filter(isImageGenModel);
      setModels(imageModels);
      setModelsError(null);
      if (!model && imageModels.length > 0) {
        setModel(imageModels[0].repo_id);
      }
    } catch (e: unknown) {
      setModelsError(e instanceof Error ? e.message : String(e));
    }
  }
  // [END]

  // Load image-gen models whenever sidecar becomes healthy
  useEffect(() => {
    let cancelled = false;
    void refreshModels().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidecar.health, sidecar.ports]);

  // Load disk gallery once sidecar is up
  useEffect(() => {
    if (sidecar.health !== "healthy") return;
    let cancelled = false;
    listImagesGallery(60, sidecar.ports)
      .then((data) => {
        if (cancelled) return;
        setDiskGallery(data.images.map((img) => img.path));
      })
      .catch(() => {
        /* gallery is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [sidecar.health, sidecar.ports, session_gallery.length]);

  // Bootstrap saved settings once
  useEffect(() => {
    useImageGenStore.getState().load();
  }, []);

  const progressPercent = useMemo(() => {
    if (!progress || progress.total <= 0) return 0;
    return Math.round((progress.step / progress.total) * 100);
  }, [progress]);

  const canGenerate = !generating && !!model && prompt.trim().length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header — centered ModelSelector (matches Chat tab layout) */}
      <header
        data-tauri-drag-region
        className="relative flex items-center justify-center gap-3 px-4 py-2 border-b border-ovo-border bg-ovo-surface"
      >
        <ModelSelector
          models={models}
          value={model}
          onChange={(repoId) => setModel(repoId)}
          disabled={generating}
        />
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("ovo:navigate", { detail: "models" }))
          }
          className="absolute right-4 top-1/2 -translate-y-1/2 px-2.5 py-1.5 text-xs rounded bg-ovo-border text-ovo-text hover:bg-ovo-accent hover:text-white transition"
        >
          {t("image.header.manage_models")}
        </button>
      </header>

      {/* Body: prompt+gallery | settings */}
      <div className="flex-1 flex min-h-0">
        {/* Left column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Prompt area */}
          <div className="p-4 border-b border-ovo-border bg-ovo-surface-solid">
            <label className="text-xs font-medium text-ovo-muted mb-1 block">
              {t("image.prompt.label")}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("image.prompt.placeholder")}
              rows={3}
              className="w-full text-sm border border-ovo-border rounded px-3 py-2 bg-ovo-bg text-ovo-text resize-y"
              disabled={generating}
            />
            <div className="mt-3 flex items-center gap-3">
              {generating ? (
                <button
                  type="button"
                  onClick={stop}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-rose-500 text-white hover:bg-rose-600 transition"
                >
                  <StopCircle className="w-3.5 h-3.5" aria-hidden />
                  {t("image.prompt.stop")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={!canGenerate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-ovo-accent text-white hover:bg-ovo-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
                  {t("image.prompt.generate")}
                </button>
              )}
              {loading_model_ref ? (
                <div className="flex-1 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-ovo-muted" aria-hidden />
                  <span className="text-[11px] text-ovo-muted font-mono truncate">
                    {t("image.prompt.loading_model", { model: loading_model_ref })}
                  </span>
                </div>
              ) : progress ? (
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-ovo-border overflow-hidden">
                    <div
                      className="h-full bg-ovo-accent transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-ovo-muted tabular-nums">
                    {progress.step}/{progress.total}
                  </span>
                </div>
              ) : null}
            </div>
            {modelsError && (
              <p className="mt-2 text-xs text-rose-500">
                {t("common.error")}: {modelsError}
              </p>
            )}
            {last_error === "no_model" && (
              <p className="mt-2 text-xs text-rose-500">
                {t("image.errors.no_model")}
              </p>
            )}
            {last_error === "empty_prompt" && (
              <p className="mt-2 text-xs text-rose-500">
                {t("image.errors.empty_prompt")}
              </p>
            )}
            {last_error && last_error !== "no_model" && last_error !== "empty_prompt" && (
              <p className="mt-2 text-xs text-rose-500 break-all">{last_error}</p>
            )}
          </div>

          {/* Gallery */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-ovo-muted">
                {t("image.gallery.title")}
              </span>
              {session_gallery.length > 0 && (
                <button
                  type="button"
                  onClick={clearGallery}
                  className="text-[10px] px-2 py-0.5 rounded bg-ovo-border text-ovo-muted hover:bg-rose-100 hover:text-rose-700 transition"
                >
                  {t("image.gallery.clear")}
                </button>
              )}
            </div>
            {session_gallery.length === 0 && diskGallery.length === 0 ? (
              sidecar.health === "healthy" ? (
                <p className="text-xs text-ovo-muted/70 italic">
                  {t("image.gallery.empty")}
                </p>
              ) : (
                <div className="flex justify-center py-6">
                  <SidecarOfflineCard
                    health={sidecar.health}
                    onStart={() => void useSidecarStore.getState().restart()}
                  />
                </div>
              )
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {/* Session (most recent) — base64 inline so first paint doesn't hit the sidecar */}
                {session_gallery.map((img) => (
                  <GalleryCard
                    key={`s-${img.path}`}
                    path={img.path}
                    src={`data:image/png;base64,${img.base64_png}`}
                    caption={`seed ${img.seed} · ${img.width}×${img.height}`}
                    ports={sidecar.ports}
                    onExpand={(src) => setLightboxSrc(src)}
                    onContextMenu={(x, y, p, s) =>
                      setCtxMenu({ x, y, path: p, src: s })
                    }
                    onDeleted={async () => {
                      const fresh = await listImagesGallery(60, sidecar.ports);
                      setDiskGallery(fresh.images.map((i) => i.path));
                      useImageGenStore.setState((s) => ({
                        session_gallery: s.session_gallery.filter((e) => e.path !== img.path),
                      }));
                    }}
                  />
                ))}
                {/* Disk (older) — served via sidecar HTTP so Tauri asset scope is a non-issue */}
                {diskGallery
                  .filter((path) => !session_gallery.some((s) => s.path === path))
                  .map((path) => (
                    <GalleryCard
                      key={`d-${path}`}
                      path={path}
                      src={imageRawUrl(path, sidecar.ports)}
                      caption={path.split("/").pop() ?? ""}
                      ports={sidecar.ports}
                      onExpand={(src) => setLightboxSrc(src)}
                    onContextMenu={(x, y, p, s) =>
                      setCtxMenu({ x, y, path: p, src: s })
                    }
                      onDeleted={async () => {
                        const fresh = await listImagesGallery(60, sidecar.ports);
                        setDiskGallery(fresh.images.map((i) => i.path));
                      }}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — settings */}
        <ImageSettingsPanel />
      </div>

      {/* [START] Phase 7 — Custom context menu (replaces broken webview menu) */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-md bg-ovo-surface-solid border border-ovo-border shadow-xl py-1 text-sm"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={() => {
              setLightboxSrc(ctxMenu.src);
              setCtxMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-ovo-text hover:bg-ovo-accent hover:text-white transition"
          >
            🔍 {t("image.ctx.expand")}
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(ctxMenu.path).then(() => {
                toast({ kind: "info", message: t("image.ctx.path_copied") });
              });
              setCtxMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-ovo-text hover:bg-ovo-accent hover:text-white transition"
          >
            📋 {t("image.ctx.copy_path")}
          </button>
          <button
            type="button"
            onClick={() => {
              window.open(imageRawUrl(ctxMenu.path, sidecar.ports), "_blank");
              setCtxMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-ovo-text hover:bg-ovo-accent hover:text-white transition"
          >
            🪟 {t("image.ctx.open_new_window")}
          </button>
          <button
            type="button"
            onClick={async () => {
              const target = ctxMenu.path;
              setCtxMenu(null);
              if (upscaling) return;
              setUpscaling(true);
              toast({ kind: "info", message: t("image.ctx.upscale_started") });
              try {
                const result = await upscaleImage(
                  {
                    source_path: target,
                    prompt: useImageGenStore.getState().prompt,
                  },
                  sidecar.ports,
                );
                // Prepend to session gallery so the upscaled version is
                // visible alongside the source.
                useImageGenStore.setState((s) => ({
                  session_gallery: [
                    {
                      index: 0,
                      path: result.path,
                      base64_png: result.base64_png,
                      seed: 0,
                      width: result.width,
                      height: result.height,
                    },
                    ...s.session_gallery,
                  ].slice(0, 200),
                }));
                const fresh = await listImagesGallery(60, sidecar.ports);
                setDiskGallery(fresh.images.map((i) => i.path));
                toast({
                  kind: "info",
                  message: t("image.ctx.upscale_done", {
                    w: result.width,
                    h: result.height,
                  }),
                });
              } catch (err) {
                toast({
                  kind: "error",
                  message:
                    err instanceof Error ? err.message : String(err),
                });
              } finally {
                setUpscaling(false);
              }
            }}
            className="w-full text-left px-3 py-1.5 text-ovo-text hover:bg-ovo-accent hover:text-white transition disabled:opacity-50"
            disabled={upscaling}
          >
            🔍 {t("image.ctx.upscale")}
          </button>
          <div className="h-px my-1 bg-ovo-border" />
          <button
            type="button"
            onClick={async () => {
              const target = ctxMenu.path;
              setCtxMenu(null);
              try {
                await deleteImage(target, sidecar.ports);
                const fresh = await listImagesGallery(60, sidecar.ports);
                setDiskGallery(fresh.images.map((i) => i.path));
                useImageGenStore.setState((s) => ({
                  session_gallery: s.session_gallery.filter((e) => e.path !== target),
                }));
              } catch (err) {
                toast({
                  kind: "error",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }}
            className="w-full text-left px-3 py-1.5 text-rose-500 hover:bg-rose-500 hover:text-white transition"
          >
            🗑 {t("image.ctx.delete")}
          </button>
        </div>
      )}
      {/* [END] */}

      {/* [START] Phase 7 — Lightbox overlay (double-click gallery image) */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <img
            src={lightboxSrc}
            alt="expanded"
            className="max-w-[94vw] max-h-[94vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 text-white hover:bg-black/80 transition text-lg"
            aria-label="close"
          >
            ✕
          </button>
        </div>
      )}
      {/* [END] */}
    </div>
  );
}
// [END] Phase 7

// [START] Phase 7 — Gallery card with a hover-reveal delete button. Keeps
// the JSX in the main component readable and centralises the delete-on-the-
// spot affordance. `path` is the absolute filesystem path; `src` may be a
// data URL (for session entries) OR a sidecar raw URL (for on-disk ones).
interface GalleryCardProps {
  path: string;
  src: string;
  caption: string;
  ports: import("../types/sidecar").SidecarPorts;
  onDeleted: () => Promise<void> | void;
  onExpand: (src: string) => void;
  onContextMenu: (x: number, y: number, path: string, src: string) => void;
}

function GalleryCard({
  path,
  src,
  caption,
  ports,
  onDeleted,
  onExpand,
  onContextMenu,
}: GalleryCardProps) {
  const toast = useToastsStore((s) => s.push);

  async function handleDelete(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await deleteImage(path, ports);
      await onDeleted();
    } catch (err) {
      toast({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleContext(e: ReactMouseEvent) {
    e.preventDefault();
    onContextMenu(e.clientX, e.clientY, path, src);
  }

  return (
    <div
      className="relative group rounded-lg overflow-hidden border border-ovo-border bg-ovo-chip hover:border-ovo-accent transition cursor-zoom-in"
      onDoubleClick={() => onExpand(src)}
      onContextMenu={handleContext}
      title={path}
    >
      <img
        src={src}
        alt={caption}
        className="w-full h-auto aspect-square object-cover select-none"
        draggable={false}
      />
      <div className="px-2 py-1 text-[10px] font-mono text-ovo-muted truncate">{caption}</div>
      <button
        type="button"
        onClick={handleDelete}
        className="absolute top-1 right-1 p-1 rounded bg-rose-500/90 text-white opacity-0 group-hover:opacity-100 transition"
        title={path}
      >
        <Trash2 className="w-3 h-3" aria-hidden />
      </button>
    </div>
  );
}
// [END] Phase 7 gallery card
