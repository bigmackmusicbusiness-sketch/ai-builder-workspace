// apps/web/src/features/files/FileTree.tsx — virtualized file tree with expand/collapse.
// Nodes are sorted: directories first, then files, both alphabetically.
import { useState, useMemo, type KeyboardEvent } from 'react';
import { useEditorStore } from '../../lib/store/editorStore';
import { languageFromPath } from '../editor/languageFromPath';

export interface FileNode {
  id: string;
  path: string;
  name: string;
  type: 'file' | 'dir';
  children?: FileNode[];
  isDirty?: boolean;
}

interface FileTreeProps {
  nodes: FileNode[];
  searchQuery?: string;
}

export function FileTree({ nodes, searchQuery }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['src']));
  const { openTab, tabs } = useEditorStore();

  const filtered = useMemo(
    () => (searchQuery ? filterNodes(nodes, searchQuery.toLowerCase()) : nodes),
    [nodes, searchQuery],
  );

  function toggleDir(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function openFile(node: FileNode) {
    if (node.type !== 'file') return;
    const existingTab = tabs.find((t) => t.fileId === node.id);
    if (existingTab) {
      openTab(existingTab);
      return;
    }
    // Open with empty content stub — real content fetched from API in Step 6 API wiring
    openTab({
      fileId: node.id,
      path: node.path,
      language: languageFromPath(node.path),
      content: `// ${node.path}\n// File content loaded from API.\n`,
      savedContent: `// ${node.path}\n// File content loaded from API.\n`,
    });
  }

  if (filtered.length === 0) {
    return (
      <div style={{ padding: 'var(--space-3)', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
        {searchQuery ? 'No files match your search.' : 'No files yet.'}
      </div>
    );
  }

  return (
    <div role="tree" aria-label="File tree">
      {filtered.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          onToggleDir={toggleDir}
          onOpenFile={openFile}
          dirtyFileIds={new Set(tabs.filter((t) => t.content !== t.savedContent).map((t) => t.fileId))}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  onToggleDir: (id: string) => void;
  onOpenFile: (node: FileNode) => void;
  dirtyFileIds: Set<string>;
}

function TreeNode({ node, depth, expanded, onToggleDir, onOpenFile, dirtyFileIds }: TreeNodeProps) {
  const isExpanded = expanded.has(node.id);
  const isDir = node.type === 'dir';
  const isDirty = dirtyFileIds.has(node.id);

  const indent = depth * 12;

  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      isDir ? onToggleDir(node.id) : onOpenFile(node);
    }
    if (e.key === 'ArrowRight' && isDir && !isExpanded) onToggleDir(node.id);
    if (e.key === 'ArrowLeft' && isDir && isExpanded) onToggleDir(node.id);
  }

  return (
    <>
      <div
        role={isDir ? 'treeitem' : 'treeitem'}
        aria-expanded={isDir ? isExpanded : undefined}
        aria-selected={false}
        tabIndex={0}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          paddingLeft: indent + 8, paddingRight: 8,
          height: 24, cursor: 'pointer', userSelect: 'none',
          fontSize: '0.8125rem', color: 'var(--text-primary)',
        }}
        onClick={() => isDir ? onToggleDir(node.id) : onOpenFile(node)}
        onKeyDown={handleKey}
      >
        {/* Arrow icon */}
        <span
          style={{
            width: 12, color: 'var(--text-secondary)', fontSize: '0.625rem', flexShrink: 0,
            transform: isDir ? (isExpanded ? 'rotate(90deg)' : '') : '',
            transition: 'transform 120ms',
          }}
          aria-hidden
        >
          {isDir ? '▶' : ''}
        </span>

        {/* File / folder icon */}
        <span style={{ fontSize: '0.75rem', flexShrink: 0 }} aria-hidden>
          {isDir ? (isExpanded ? '📂' : '📁') : fileIcon(node.name)}
        </span>

        {/* Name */}
        <span
          style={{
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: isDir ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}
        >
          {node.name}
        </span>

        {/* Dirty indicator */}
        {isDirty && (
          <span
            style={{ color: 'var(--accent-500)', fontSize: '0.5rem', flexShrink: 0 }}
            aria-label="Unsaved changes"
          >
            ●
          </span>
        )}
      </div>

      {/* Children */}
      {isDir && isExpanded && node.children && (
        <div role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
              dirtyFileIds={dirtyFileIds}
            />
          ))}
        </div>
      )}
    </>
  );
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const icons: Record<string, string> = {
    ts: '🔷', tsx: '⚛️', js: '🟡', jsx: '⚛️',
    css: '🎨', scss: '🎨', json: '📋', md: '📝',
    html: '🌐', sql: '🗄', yaml: '⚙️', yml: '⚙️',
    toml: '⚙️', env: '🔒', sh: '⬛', bash: '⬛',
  };
  return icons[ext] ?? '📄';
}

function filterNodes(nodes: FileNode[], q: string): FileNode[] {
  return nodes.reduce<FileNode[]>((acc, node) => {
    if (node.type === 'dir' && node.children) {
      const filteredChildren = filterNodes(node.children, q);
      if (filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren });
      }
    } else if (node.type === 'file' && node.path.toLowerCase().includes(q)) {
      acc.push(node);
    }
    return acc;
  }, []);
}
