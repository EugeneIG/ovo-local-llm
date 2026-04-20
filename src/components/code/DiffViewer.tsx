// [START] Phase 8.2 — Monaco diff editor wrapper
import { DiffEditor } from "@monaco-editor/react";
import { useThemeStore } from "../../store/theme";

interface DiffViewerProps {
  original: string;
  modified: string;
  language: string;
}

export function DiffViewer({ original, modified, language }: DiffViewerProps) {
  const isDark = useThemeStore((s) => s.effective) === "dark";

  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={language}
      theme={isDark ? "ovo-dark" : "ovo-light"}
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
        readOnly: true,
        renderSideBySide: true,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        minimap: { enabled: false },
      }}
    />
  );
}
// [END] Phase 8.2
