import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { CollapsibleSection } from "./CollapsibleSection";
import { useSkillsStore } from "../store/skills";
import { useProjectContextStore } from "../store/project_context";

// [START] Phase 6.4 — Skills section in Settings.
// Scans `<project_path>/.ovo/skills/*.md` (or the optional folder override) and
// lets the user toggle individual skills on/off. Enabled skills get concatenated
// into the chat system prompt as a `<ovo_skills>` block.

export function SkillsSection() {
  const { t } = useTranslation();
  const skills = useSkillsStore((s) => s.skills);
  const enabled = useSkillsStore((s) => s.enabled);
  const folderOverride = useSkillsStore((s) => s.folder_override);
  const loading = useSkillsStore((s) => s.loading);
  const lastFolder = useSkillsStore((s) => s.last_folder);
  const lastError = useSkillsStore((s) => s.last_error);
  const rescan = useSkillsStore((s) => s.rescan);
  const setEnabled = useSkillsStore((s) => s.setEnabled);
  const setFolderOverride = useSkillsStore((s) => s.setFolderOverride);
  const projectPath = useProjectContextStore((s) => s.project_path);

  // Rescan when the section mounts — catches first-visit after project changes
  useEffect(() => {
    void rescan();
  }, [rescan, projectPath, folderOverride]);

  async function handlePickOverride() {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string" && picked.length > 0) {
        await setFolderOverride(picked);
      }
    } catch {
      /* user cancelled or dialog denied — ignore */
    }
  }

  const activeFolder = lastFolder ?? (folderOverride ?? (projectPath ? `${projectPath}/.ovo/skills` : null));
  const activeCount = skills.filter((s) => enabled[s.path] !== false).length;

  return (
    <CollapsibleSection id="skills" title={t("settings.skills.section_title")}>
      <p className="text-xs text-ovo-muted mb-3">
        {t("settings.skills.description")}
      </p>

      {/* Folder + controls */}
      <div className="flex items-center gap-2 flex-wrap text-xs mb-3">
        <div className="font-mono text-ovo-muted truncate max-w-xs" title={activeFolder ?? undefined}>
          {activeFolder ?? t("settings.skills.no_folder")}
        </div>
        <button
          type="button"
          onClick={() => void rescan()}
          disabled={loading}
          className="px-2 py-1 rounded bg-ovo-border text-ovo-text hover:bg-ovo-accent hover:text-white transition disabled:opacity-40"
        >
          {loading ? t("common.loading") : t("settings.skills.rescan")}
        </button>
        <button
          type="button"
          onClick={() => void handlePickOverride()}
          className="px-2 py-1 rounded bg-ovo-border text-ovo-text hover:bg-ovo-accent hover:text-white transition"
        >
          {t("settings.skills.pick_override")}
        </button>
        {folderOverride && (
          <button
            type="button"
            onClick={() => void setFolderOverride(null)}
            className="px-2 py-1 rounded bg-ovo-border text-ovo-text hover:bg-rose-100 hover:text-rose-700 transition"
          >
            {t("settings.skills.clear_override")}
          </button>
        )}
      </div>

      {lastError && (
        <p className="text-xs text-rose-500 mb-3">
          {t("settings.skills.error", { error: lastError })}
        </p>
      )}

      {/* Skill list */}
      {skills.length === 0 ? (
        <p className="text-xs text-ovo-muted/70 italic">
          {t("settings.skills.empty")}
        </p>
      ) : (
        <>
          <p className="text-[11px] text-ovo-muted mb-2">
            {t("settings.skills.active_count", { active: activeCount, total: skills.length })}
          </p>
          <ul className="flex flex-col gap-1.5">
            {skills.map((skill) => {
              const isEnabled = enabled[skill.path] !== false;
              return (
                <li
                  key={skill.path}
                  className="flex items-start gap-2 p-2 rounded border border-ovo-border bg-ovo-chip"
                >
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => setEnabled(skill.path, e.target.checked)}
                    className="accent-ovo-accent mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ovo-text font-medium truncate">
                      ✨ {skill.name}
                    </div>
                    {skill.description && (
                      <div className="text-[11px] text-ovo-muted mt-0.5">
                        {skill.description}
                      </div>
                    )}
                    <div
                      className="text-[10px] font-mono text-ovo-muted/60 mt-0.5 truncate"
                      title={skill.path}
                    >
                      {skill.path}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </CollapsibleSection>
  );
}
// [END] Phase 6.4
