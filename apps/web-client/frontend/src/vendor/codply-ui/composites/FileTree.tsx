"use client";

import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import {
  ChevronRight,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson2,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export type FileTreeKind = "code" | "image" | "audio" | "data";

/** Flat bundle entry — shape matches the version-files endpoint items. */
export interface FileTreeFile {
  /** Slash-separated path inside the bundle, e.g. "assets/hero.svg". */
  path: string;
  kind: FileTreeKind;
  editable?: boolean;
}

export interface FileTreeProps {
  files: FileTreeFile[];
  selectedPath?: string | null;
  onSelect: (path: string) => void;
  /** aria-label of the tree; default "Files" (E33 localizable). */
  "aria-label"?: string;
  className?: string;
}

const KIND_ICONS: Record<FileTreeKind, { icon: LucideIcon; className: string }> = {
  code: { icon: FileCode2, className: "text-success" },
  image: { icon: FileImage, className: "text-violet" },
  audio: { icon: FileAudio, className: "text-cyan" },
  data: { icon: FileJson2, className: "text-info" },
};

interface DirNode {
  type: "dir";
  name: string;
  path: string;
  children: TreeNode[];
}

interface FileNode {
  type: "file";
  name: string;
  path: string;
  kind: FileTreeKind;
  editable: boolean;
}

type TreeNode = DirNode | FileNode;

/** Sort contract: index.html first, then folders before files, then alpha. */
function compareNodes(a: TreeNode, b: TreeNode): number {
  const aEntry = a.type === "file" && a.name === "index.html";
  const bEntry = b.type === "file" && b.name === "index.html";
  if (aEntry !== bEntry) return aEntry ? -1 : 1;
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  const sorted = [...nodes].sort(compareNodes);
  return sorted.map((node) =>
    node.type === "dir" ? { ...node, children: sortTree(node.children) } : node,
  );
}

function buildTree(files: FileTreeFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const segments = file.path.split("/").filter((s) => s !== "");
    if (segments.length === 0) continue;
    let siblings = root;
    let prefix = "";
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]!;
      prefix = prefix === "" ? name : `${prefix}/${name}`;
      let dir = siblings.find((n): n is DirNode => n.type === "dir" && n.path === prefix);
      if (!dir) {
        dir = { type: "dir", name, path: prefix, children: [] };
        siblings.push(dir);
      }
      siblings = dir.children;
    }
    siblings.push({
      type: "file",
      name: segments[segments.length - 1]!,
      path: file.path,
      kind: file.kind,
      editable: file.editable ?? false,
    });
  }
  return sortTree(root);
}

/**
 * Explorer-style tree over the flat published bundle (E14-F5): folders
 * expand/collapse (chevron rotates), file icons by kind, selected highlight.
 * Folders start expanded — the whole bundle is small and truthful.
 */
export function FileTree({
  files,
  selectedPath,
  onSelect,
  "aria-label": ariaLabel = "Files",
  className,
}: FileTreeProps): ReactElement {
  const tree = useMemo(() => buildTree(files), [files]);
  // Track *collapsed* paths so newly-appearing folders default to expanded.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNodes = (nodes: TreeNode[], depth: number): ReactElement[] =>
    nodes.map((node) => {
      const indent = { paddingInlineStart: 8 + depth * 14 };
      if (node.type === "dir") {
        const expanded = !collapsed.has(node.path);
        const FolderIcon = expanded ? FolderOpen : Folder;
        return (
          <li key={node.path} role="treeitem" aria-expanded={expanded} data-path={node.path}>
            <button
              type="button"
              onClick={() => toggle(node.path)}
              style={indent}
              className={cn(
                "fp-hit flex h-8 w-full min-w-0 items-center gap-1.5 rounded-xl pe-2 text-sm",
                "text-ink-secondary transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
              )}
            >
              <ChevronRight
                className={cn(
                  "fp-flip-rtl size-3.5 shrink-0 transition-transform duration-150 ease-out",
                  expanded && "rotate-90",
                )}
                aria-hidden
              />
              <FolderIcon className="size-4 shrink-0 text-warning" aria-hidden />
              <span className="truncate">{node.name}</span>
            </button>
            {expanded && (
              <ul role="group" className="flex flex-col">
                {renderNodes(node.children, depth + 1)}
              </ul>
            )}
          </li>
        );
      }
      const meta = KIND_ICONS[node.kind];
      const selected = node.path === selectedPath;
      return (
        <li key={node.path} role="treeitem" aria-selected={selected} data-path={node.path}>
          <button
            type="button"
            onClick={() => onSelect(node.path)}
            // Files align with folder names (no chevron): +20px = chevron + gap.
            style={{ paddingInlineStart: 8 + depth * 14 + 20 }}
            className={cn(
              "fp-hit flex h-8 w-full min-w-0 items-center gap-1.5 rounded-xl pe-2 text-sm",
              "transition-colors duration-150 ease-out",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
              selected
                ? "bg-violet/15 text-ink"
                : "text-ink-secondary hover:bg-surface-2 hover:text-ink",
            )}
          >
            <meta.icon className={cn("size-4 shrink-0", meta.className)} aria-hidden />
            <span className="truncate" dir="ltr">
              {node.name}
            </span>
          </button>
        </li>
      );
    });

  return (
    <ul
      role="tree"
      aria-label={ariaLabel}
      className={cn("flex flex-col gap-0.5", className)}
      data-testid="file-tree"
    >
      {renderNodes(tree, 0)}
    </ul>
  );
}
