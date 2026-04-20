import { useTranslation } from "react-i18next";
import { Shuffle } from "lucide-react";
import {
  useImageGenStore,
  SAMPLERS,
  SIZE_PRESETS,
  type Sampler,
} from "../store/image_gen";
import { IMAGE_STYLE_PRESETS } from "../lib/image_style_presets";

// [START] Phase 7 — Image generation settings panel.
// The entire Draw Things-parity control surface in one scrollable column.
// Sampler / size / steps / CFG / seed / batch / shift / LoRA list / ControlNet
// hooks. Every control writes through the store so values persist and the
// `generate()` action always sees the current config.

export function ImageSettingsPanel() {
  const { t } = useTranslation();
  const {
    negative_prompt,
    width,
    height,
    steps,
    cfg_scale,
    sampler,
    seed,
    batch,
    shift,
    loras,
    control_model,
    control_strength,
    style_preset_id,
    setNegativePrompt,
    setSize,
    setSteps,
    setCfgScale,
    setSampler,
    setSeed,
    setBatch,
    setShift,
    addLora,
    removeLora,
    updateLora,
    setControlModel,
    setControlStrength,
    setStylePreset,
  } = useImageGenStore();

  function handlePreset(preset: (typeof SIZE_PRESETS)[number]): void {
    setSize(preset.width, preset.height);
  }

  function randomizeSeed(): void {
    setSeed(Math.floor(Math.random() * 2 ** 31));
  }

  return (
    <aside className="w-[320px] shrink-0 border-l border-ovo-border bg-ovo-surface-solid overflow-y-auto p-4 flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-ovo-text">{t("image.settings.title")}</h3>

      {/* Style preset */}
      <section>
        <label className="text-xs font-medium text-ovo-muted mb-1 block">
          {t("image.settings.style_preset")}
        </label>
        <select
          value={style_preset_id}
          onChange={(e) => setStylePreset(e.target.value)}
          className="w-full text-xs border border-ovo-border rounded px-2 py-1.5 bg-ovo-bg text-ovo-text"
        >
          {IMAGE_STYLE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-ovo-muted mt-1">
          {t("image.settings.style_preset_hint")}
        </p>
      </section>

      {/* Negative prompt */}
      <section>
        <label className="text-xs font-medium text-ovo-muted mb-1 block">
          {t("image.settings.negative_prompt")}
        </label>
        <textarea
          value={negative_prompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          rows={3}
          placeholder={t("image.settings.negative_placeholder")}
          className="w-full text-xs border border-ovo-border rounded px-2 py-1.5 bg-ovo-bg text-ovo-text resize-none"
        />
      </section>

      {/* Sampler */}
      <section>
        <label className="text-xs font-medium text-ovo-muted mb-1 block">
          {t("image.settings.sampler")}
        </label>
        <select
          value={sampler}
          onChange={(e) => setSampler(e.target.value as Sampler)}
          className="w-full text-xs border border-ovo-border rounded px-2 py-1.5 bg-ovo-bg text-ovo-text"
        >
          {SAMPLERS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </section>

      {/* Size presets + custom inputs */}
      <section>
        <label className="text-xs font-medium text-ovo-muted mb-1 block">
          {t("image.settings.size")}
        </label>
        <select
          onChange={(e) => {
            const idx = Number(e.target.value);
            if (!Number.isNaN(idx) && SIZE_PRESETS[idx]) handlePreset(SIZE_PRESETS[idx]);
          }}
          value={""}
          className="w-full text-xs border border-ovo-border rounded px-2 py-1.5 bg-ovo-bg text-ovo-text mb-2"
        >
          <option value="">{t("image.settings.size_preset_placeholder")}</option>
          {SIZE_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={64}
            max={2048}
            step={64}
            value={width}
            onChange={(e) => setSize(Number(e.target.value), height)}
            className="w-full text-xs border border-ovo-border rounded px-2 py-1 bg-ovo-bg text-ovo-text font-mono"
          />
          <span className="text-xs text-ovo-muted">×</span>
          <input
            type="number"
            min={64}
            max={2048}
            step={64}
            value={height}
            onChange={(e) => setSize(width, Number(e.target.value))}
            className="w-full text-xs border border-ovo-border rounded px-2 py-1 bg-ovo-bg text-ovo-text font-mono"
          />
        </div>
      </section>

      {/* Steps */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-ovo-muted">
            {t("image.settings.steps")}
          </label>
          <span className="text-xs font-mono tabular-nums text-ovo-muted">{steps}</span>
        </div>
        <input
          type="range"
          min={1}
          max={100}
          value={steps}
          onChange={(e) => setSteps(Number(e.target.value))}
          className="w-full accent-ovo-accent"
        />
      </section>

      {/* CFG */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-ovo-muted">
            {t("image.settings.cfg_scale")}
          </label>
          <span className="text-xs font-mono tabular-nums text-ovo-muted">
            {cfg_scale.toFixed(1)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={cfg_scale}
          onChange={(e) => setCfgScale(Number(e.target.value))}
          className="w-full accent-ovo-accent"
        />
      </section>

      {/* Seed */}
      <section>
        <label className="text-xs font-medium text-ovo-muted mb-1 block">
          {t("image.settings.seed")}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={-1}
            value={seed ?? ""}
            placeholder={t("image.settings.seed_random")}
            onChange={(e) =>
              setSeed(e.target.value === "" ? null : Number(e.target.value))
            }
            className="flex-1 text-xs border border-ovo-border rounded px-2 py-1 bg-ovo-bg text-ovo-text font-mono"
          />
          <button
            type="button"
            onClick={() => setSeed(null)}
            className="text-[10px] px-2 py-1 rounded bg-ovo-border text-ovo-text hover:bg-ovo-accent hover:text-white transition"
          >
            {t("image.settings.seed_clear")}
          </button>
          <button
            type="button"
            onClick={randomizeSeed}
            className="p-1 rounded bg-ovo-border text-ovo-text hover:bg-ovo-accent hover:text-white transition"
            title={t("image.settings.seed_random_btn")}
          >
            <Shuffle className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* Batch */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-ovo-muted">
            {t("image.settings.batch")}
          </label>
          <span className="text-xs font-mono tabular-nums text-ovo-muted">{batch}</span>
        </div>
        <input
          type="range"
          min={1}
          max={8}
          value={batch}
          onChange={(e) => setBatch(Number(e.target.value))}
          className="w-full accent-ovo-accent"
        />
      </section>

      {/* Shift (Flux) */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-ovo-muted">
            {t("image.settings.shift")}
          </label>
          <span className="text-xs font-mono tabular-nums text-ovo-muted">
            {shift === null ? "—" : shift.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={3}
          step={0.05}
          value={shift ?? 1.15}
          onChange={(e) => setShift(Number(e.target.value))}
          className="w-full accent-ovo-accent"
          disabled={shift === null}
        />
        <label className="flex items-center gap-1 mt-1 text-[10px] text-ovo-muted cursor-pointer">
          <input
            type="checkbox"
            checked={shift === null}
            onChange={(e) => setShift(e.target.checked ? null : 1.15)}
            className="accent-ovo-accent"
          />
          {t("image.settings.shift_off")}
        </label>
      </section>

      {/* LoRA stack */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-ovo-muted">
            {t("image.settings.loras")}
          </label>
          <button
            type="button"
            onClick={() => addLora({ path: "", strength: 1.0 })}
            className="text-[10px] px-1.5 py-0.5 rounded bg-ovo-border text-ovo-text hover:bg-ovo-accent hover:text-white transition"
          >
            {t("image.settings.lora_add")}
          </button>
        </div>
        {loras.length === 0 ? (
          <p className="text-[10px] text-ovo-muted/70 italic">
            {t("image.settings.lora_empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {loras.map((lora, i) => (
              <li key={i} className="p-2 rounded bg-ovo-bg border border-ovo-border">
                <input
                  type="text"
                  value={lora.path}
                  onChange={(e) => updateLora(i, { path: e.target.value })}
                  placeholder={t("image.settings.lora_path_placeholder")}
                  className="w-full text-[11px] border border-ovo-border rounded px-1.5 py-1 bg-ovo-surface-solid text-ovo-text font-mono mb-1"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={lora.strength}
                    onChange={(e) =>
                      updateLora(i, { strength: Number(e.target.value) })
                    }
                    className="flex-1 accent-ovo-accent"
                  />
                  <span className="text-[10px] font-mono text-ovo-muted w-10 text-right">
                    {lora.strength.toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLora(i)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-ovo-border text-ovo-text hover:bg-rose-100 hover:text-rose-700 transition"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ControlNet */}
      <section>
        <label className="text-xs font-medium text-ovo-muted mb-1 block">
          {t("image.settings.control_model")}
        </label>
        <input
          type="text"
          value={control_model ?? ""}
          onChange={(e) => setControlModel(e.target.value || null)}
          placeholder={t("image.settings.control_model_placeholder")}
          className="w-full text-xs border border-ovo-border rounded px-2 py-1 bg-ovo-bg text-ovo-text font-mono mb-2"
        />
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-ovo-muted">
            {t("image.settings.control_strength")}
          </label>
          <span className="text-xs font-mono tabular-nums text-ovo-muted">
            {control_strength.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={control_strength}
          onChange={(e) => setControlStrength(Number(e.target.value))}
          className="w-full accent-ovo-accent"
        />
        <p className="text-[10px] text-ovo-muted mt-1">{t("image.settings.control_hint")}</p>
      </section>
    </aside>
  );
}
// [END] Phase 7
