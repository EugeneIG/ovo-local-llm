// [START] Phase 8 — File explorer tree view
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Plus,
  FolderPlus,
  MessageSquarePlus,
  Copy,
  ExternalLink,
  Pencil,
  Trash2,
  FileText,
  Terminal,
  RefreshCw,
  Palette,
  Check,
} from "lucide-react";
import { getFileIcon, getFolderIcon } from "./FileIcon";
import { CODE_THEME_PRESETS, useCodeThemeStore } from "../../store/code_theme";
import { invoke } from "@tauri-apps/api/core";
import type { FileTreeNode } from "../../types/code";
import { useCodeEditorStore } from "../../store/code_editor";
import { useCodeAgentStore } from "../../store/code_agent";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

interface FileExplorerProps {
  tree: FileTreeNode[];
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
}

// [START] Recursive tree node component
function TreeNode({
  node,
  depth,
  expandedDirs,
  onToggleDir,
  onOpenFile,
  onContextMenu,
}: {
  node: FileTreeNode;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: FileTreeNode) => void;
}) {
  const isExpanded = expandedDirs.has(node.path);
  const paddingLeft = 8 + depth * 16;

  if (node.is_dir) {
    const folderIcon = getFolderIcon(node.name, isExpanded, 14);
    return (
      <>
        <button
          type="button"
          onClick={() => onToggleDir(node.path)}
          onContextMenu={(e) => onContextMenu(e, node)}
          className="w-full flex items-center gap-1 py-0.5 text-xs text-ovo-text hover:bg-ovo-surface-solid transition truncate"
          style={{ paddingLeft }}
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-ovo-muted shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-ovo-muted shrink-0" />
          )}
          <span className="shrink-0 flex items-center">{folderIcon.node}</span>
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
            onOpenFile={onOpenFile}
            onContextMenu={onContextMenu}
          />
        ))}
      </>
    );
  }

  const fileIcon = getFileIcon(node.name, 14);
  return (
    <button
      type="button"
      onClick={() => onOpenFile(node.path)}
      onContextMenu={(e) => onContextMenu(e, node)}
      className="w-full flex items-center gap-1 py-0.5 text-xs text-ovo-text hover:bg-ovo-surface-solid transition truncate"
      style={{ paddingLeft: paddingLeft + 18 }}
    >
      <span className="shrink-0 flex items-center">{fileIcon.node}</span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}
// [END]

export function FileExplorer({ tree, expandedDirs, onToggleDir, onOpenFile }: FileExplorerProps) {
  const { t } = useTranslation();
  const [creatingType, setCreatingType] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const createFile = useCodeEditorStore((s) => s.createFile);
  const createFolder = useCodeEditorStore((s) => s.createFolder);
  const renameItem = useCodeEditorStore((s) => s.renameItem);
  const deleteItem = useCodeEditorStore((s) => s.deleteItem);
  const projectRoot = useCodeEditorStore((s) => s.projectPath);
  const refreshTree = useCodeEditorStore((s) => s.refreshTree);
  const addAttachment = useCodeAgentStore((s) => s.addAttachment);
  const codeThemeId = useCodeThemeStore((s) => s.presetId);
  const setCodeTheme = useCodeThemeStore((s) => s.setPreset);
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  // [START] Phase 8.4 — auto-refresh tree on window focus + gentle polling.
  // External changes (rm via terminal, git checkout, background compiler
  // output) don't reach our tree until something triggers refreshTree.
  // Two cheap signals:
  //   (a) `focus`: user tabbed back from a terminal — refresh immediately.
  //   (b) a 3s poll while focused — catches changes that happen while the
  //       app keeps focus (e.g. another app writing into the project).
  // Polling is gated on document.hasFocus so backgrounded windows don't
  // hammer the FS. A proper `notify` fs-watcher in Rust would be nicer
  // but adds non-trivial plumbing; revisit in Phase 9.
  useEffect(() => {
    const tick = () => {
      if (document.hasFocus()) void refreshTree();
    };
    const onFocus = () => void refreshTree();
    window.addEventListener("focus", onFocus);
    const interval = setInterval(tick, 3000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [refreshTree]);
  // [END]

  // [START] Phase 8.4 — right-click context menu state.
  // When a user right-clicks a tree entry we snapshot its path + kind and
  // the click position; the overlay renders until the user picks something
  // or clicks away. Actions dispatch through the same stores as manual UI.
  const [menu, setMenu] = useState<
    | { x: number; y: number; path: string; isDir: boolean; name: string }
    | null
  >(null);
  const [renaming, setRenaming] = useState<{ path: string; originalName: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const openContextMenu = useCallback(
    (e: React.MouseEvent, node: FileTreeNode) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, path: node.path, isDir: node.is_dir, name: node.name });
    },
    [],
  );

  const copyPath = useCallback(async (rel: string, absolute: boolean) => {
    const value = absolute && projectRoot ? `${projectRoot}/${rel}` : rel;
    try {
      await navigator.clipboard.writeText(value);
    } catch (err) {
      console.warn("clipboard write failed", err);
    }
  }, [projectRoot]);

  const revealInFinder = useCallback(
    async (rel: string) => {
      if (!projectRoot) return;
      try {
        await invoke("code_fs_reveal", { projectRoot, path: rel });
      } catch (err) {
        console.warn("reveal_in_finder not available", err);
      }
    },
    [projectRoot],
  );

  const handleCreate = useCallback(async () => {
    if (!newName.trim() || !creatingType) return;
    if (creatingType === "file") {
      await createFile(newName.trim());
    } else {
      await createFolder(newName.trim());
    }
    setCreatingType(null);
    setNewName("");
  }, [newName, creatingType, createFile, createFolder]);

  const confirmRename = useCallback(async () => {
    if (!renaming || !renameDraft.trim() || renameDraft === renaming.originalName) {
      setRenaming(null);
      return;
    }
    const parent = renaming.path.includes("/")
      ? renaming.path.substring(0, renaming.path.lastIndexOf("/"))
      : "";
    const target = parent ? `${parent}/${renameDraft.trim()}` : renameDraft.trim();
    try {
      await renameItem(renaming.path, target);
    } catch (err) {
      console.warn("rename failed", err);
    }
    setRenaming(null);
  }, [renaming, renameDraft, renameItem]);

  const buildMenuItems = useCallback(
    (target: { path: string; isDir: boolean; name: string }): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      if (!target.isDir) {
        items.push({
          id: "open",
          label: t("code.ctx.open"),
          icon: <File className="w-3.5 h-3.5" />,
          onSelect: () => onOpenFile(target.path),
        });
      }
      items.push({
        id: "add_to_chat",
        label: target.isDir ? t("code.ctx.add_folder_to_chat") : t("code.ctx.add_file_to_chat"),
        icon: <MessageSquarePlus className="w-3.5 h-3.5 text-ovo-accent" />,
        onSelect: () => addAttachment(target.path),
        separatorBefore: !target.isDir,
      });
      items.push({
        id: "reveal",
        label: t("code.ctx.reveal_in_finder"),
        icon: <ExternalLink className="w-3.5 h-3.5" />,
        onSelect: () => void revealInFinder(target.path),
        separatorBefore: true,
      });
      items.push({
        id: "copy_path",
        label: t("code.ctx.copy_path"),
        icon: <Copy className="w-3.5 h-3.5" />,
        onSelect: () => void copyPath(target.path, true),
      });
      items.push({
        id: "copy_relpath",
        label: t("code.ctx.copy_relative_path"),
        icon: <FileText className="w-3.5 h-3.5" />,
        onSelect: () => void copyPath(target.path, false),
      });
      if (target.isDir) {
        items.push({
          id: "new_file_here",
          label: t("code.new_file"),
          icon: <Plus className="w-3.5 h-3.5" />,
          onSelect: () => {
            setCreatingType("file");
            setNewName(`${target.path}/`);
          },
          separatorBefore: true,
        });
        items.push({
          id: "new_folder_here",
          label: t("code.new_folder"),
          icon: <FolderPlus className="w-3.5 h-3.5" />,
          onSelect: () => {
            setCreatingType("folder");
            setNewName(`${target.path}/`);
          },
        });
        items.push({
          id: "terminal",
          label: t("code.ctx.open_terminal"),
          icon: <Terminal className="w-3.5 h-3.5" />,
          onSelect: () => void revealInFinder(target.path),
        });
      }
      items.push({
        id: "rename",
        label: t("code.ctx.rename"),
        shortcut: "⏎",
        icon: <Pencil className="w-3.5 h-3.5" />,
        onSelect: () => {
          setRenaming({ path: target.path, originalName: target.name });
          setRenameDraft(target.name);
        },
        separatorBefore: true,
      });
      items.push({
        id: "delete",
        label: t("code.ctx.delete"),
        shortcut: "⌫",
        icon: <Trash2 className="w-3.5 h-3.5" />,
        destructive: true,
        onSelect: () => {
          if (!confirm(t("code.ctx.delete_confirm", { name: target.name }))) return;
          void deleteItem(target.path);
        },
      });
      return items;
    },
    [t, onOpenFile, addAttachment, revealInFinder, copyPath, deleteItem],
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ovo-border shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ovo-muted">
          {t("code.file_explorer")}
        </span>
        <div className="flex items-center gap-1 relative">
          <button
            type="button"
            onClick={() => setThemePickerOpen((v) => !v)}
            className="p-0.5 rounded hover:bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text transition"
            title={t("code.ctx.theme")}
          >
            <Palette className="w-3.5 h-3.5" />
          </button>
          {themePickerOpen && (
            <div className="absolute right-0 top-6 z-50 min-w-[180px] bg-ovo-surface-solid border border-ovo-chip-border rounded-md shadow-xl py-1 text-xs">
              {Object.values(CODE_THEME_PRESETS).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setCodeTheme(p.id);
                    setThemePickerOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-ovo-surface/60 transition"
                >
                  <span
                    className="w-3 h-3 rounded-sm border border-ovo-chip-border shrink-0"
                    style={{ background: p.background }}
                  />
                  <span className="flex-1 truncate text-ovo-text">{p.label}</span>
                  {codeThemeId === p.id && (
                    <Check className="w-3.5 h-3.5 text-ovo-accent shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => void refreshTree()}
            className="p-0.5 rounded hover:bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text transition"
            title={t("code.ctx.refresh")}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { setCreatingType("file"); setNewName(""); }}
            className="p-0.5 rounded hover:bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text transition"
            title={t("code.new_file")}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { setCreatingType("folder"); setNewName(""); }}
            className="p-0.5 rounded hover:bg-ovo-surface-solid text-ovo-muted hover:text-ovo-text transition"
            title={t("code.new_folder")}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* New file/folder input */}
      {creatingType && (
        <div className="px-2 py-1 border-b border-ovo-border">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
              if (e.key === "Escape") { setCreatingType(null); setNewName(""); }
            }}
            onBlur={() => { setCreatingType(null); setNewName(""); }}
            placeholder={creatingType === "file" ? t("code.new_file") : t("code.new_folder")}
            className="w-full text-xs px-2 py-1 rounded bg-ovo-bg border border-ovo-border text-ovo-text placeholder:text-ovo-muted focus:outline-none focus:ring-1 focus:ring-ovo-accent"
          />
        </div>
      )}

      {/* Inline rename input */}
      {renaming && (
        <div className="px-2 py-1 border-b border-ovo-border">
          <input
            autoFocus
            type="text"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirmRename();
              if (e.key === "Escape") setRenaming(null);
            }}
            onBlur={() => setRenaming(null)}
            placeholder={renaming.originalName}
            className="w-full text-xs px-2 py-1 rounded bg-ovo-bg border border-ovo-border text-ovo-text placeholder:text-ovo-muted focus:outline-none focus:ring-1 focus:ring-ovo-accent"
          />
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 ? (
          <p className="text-xs text-ovo-muted px-3 py-4 text-center">
            {t("code.no_project")}
          </p>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
              onContextMenu={openContextMenu}
            />
          ))
        )}
      </div>

      {/* Right-click context menu overlay */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems({ path: menu.path, isDir: menu.isDir, name: menu.name })}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
// [END] Phase 8
