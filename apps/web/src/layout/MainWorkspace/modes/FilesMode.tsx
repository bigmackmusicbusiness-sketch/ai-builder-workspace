// apps/web/src/layout/MainWorkspace/modes/FilesMode.tsx — file tree + search mode.
// Shows the project file tree, search input, and opens files into the Code editor.
//
// Source of truth: GET /api/files/workspace?slug=… returns the flat list of
// files the AI agent has written into the per-tenant workspace directory.
// We build a nested tree client-side so the panel mirrors what the agent
// actually generated (the legacy STUB_TREE was a hardcoded scaffold that
// never matched reality once the agent ran).
import { useEffect, useMemo, useState } from 'react';
import { FileTree, type FileNode } from '../../../features/files/FileTree';
import { useProjectStore } from '../../../lib/store/projectStore';
import { apiFetch } from '../../../lib/api';

/** Build a nested FileNode tree from a flat list of paths like '/src/main.tsx'. */
function buildTree(paths: string[]): FileNode[] {
  const root: FileNode = { id: '', path: '', name: '', type: 'dir', children: [] };

  for (const p of paths) {
    const clean = p.replace(/^\/+/, '');
    if (!clean) continue;
    const parts = clean.split('/');
    let cursor: FileNode = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      acc = acc ? `${acc}/${name}` : name;
      const isFile = i === parts.length - 1;
      let child = cursor.children?.find((c) => c.name === name);
      if (!child) {
        child = {
          id: acc,
          path: acc,
          name,
          type: isFile ? 'file' : 'dir',
          ...(isFile ? {} : { children: [] }),
        };
        cursor.children ??= [];
        cursor.children.push(child);
      }
      cursor = child;
    }
  }

  // Sort each level: directories first, then files, alphabetical
  const sortLevel = (node: FileNode): void => {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of node.children) sortLevel(c);
  };
  sortLevel(root);
  return root.children ?? [];
}

/** Restore state from /api/files/workspace. Optional for backward-compat with
 *  older api versions during a deploy roll — when undefined, treat as
 *  'skipped' so we render the same "No files yet" copy as before. */
type RestoreState = 'skipped' | 'success' | 'failed' | 'empty-backup' | undefined;
type FilesResp    = { files: string[]; restored?: RestoreState; restoreError?: string };

export function FilesMode() {
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreState, setRestoreState] = useState<RestoreState>(undefined);
  // One-shot retry counter — bumped by the 3s timeout when restore comes back
  // empty/failed. Re-running the effect gives Storage time to propagate in
  // multi-replica deploys before we tell the user "No files yet."
  const [retryCount, setRetryCount] = useState(0);

  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projects         = useProjectStore((s) => s.projects);
  const slug = currentProjectId !== 'global' ? projects[currentProjectId]?.slug : undefined;

  // Refetch on project change OR when retryCount bumps.
  useEffect(() => {
    if (!slug) {
      setFiles([]);
      setError(null);
      setRestoreState(undefined);
      setRetryCount(0);
      return;
    }
    let cancelled    = false;
    let retryTimerId: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setError(null);
    apiFetch<FilesResp>(`/api/files/workspace?slug=${encodeURIComponent(slug)}`)
      .then((res) => {
        if (cancelled) return;
        setFiles(res.files);
        setRestoreState(res.restored);
        // One-shot retry on "files empty + restore not skipped" — gives the
        // Supabase Storage list a few seconds to propagate in multi-replica
        // deploys. Don't loop: if the retry also comes back empty, we render
        // the typed "Workspace is syncing" copy instead of "No files yet."
        if (
          res.files.length === 0
          && (res.restored === 'empty-backup' || res.restored === 'failed')
          && retryCount === 0
        ) {
          retryTimerId = setTimeout(() => {
            if (!cancelled) setRetryCount(1);
          }, 3000);
        }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load files'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (retryTimerId) clearTimeout(retryTimerId);
    };
  }, [slug, retryCount]);

  // Reset retry budget when the project changes.
  useEffect(() => {
    setRetryCount(0);
  }, [slug]);

  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Search bar */}
      <div style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--border-base)', flexShrink: 0 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files…"
          style={{
            width: '100%', border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)', background: 'var(--bg-subtle)',
            color: 'var(--text-primary)', fontSize: '0.8125rem',
            padding: 'var(--space-1) var(--space-2)', outline: 'none',
          }}
          aria-label="Search files"
        />
      </div>

      {/* File tree */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {!slug ? (
          <div style={{ padding: 'var(--space-3)', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
            Pick a project from the top bar to see its files.
          </div>
        ) : loading && files.length === 0 ? (
          <div style={{ padding: 'var(--space-3)', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
            Loading…
          </div>
        ) : error ? (
          <div style={{ padding: 'var(--space-3)', color: 'var(--error-500)', fontSize: '0.8125rem' }}>
            {error}
          </div>
        ) : tree.length === 0 ? (
          <div style={{ padding: 'var(--space-3)', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
            {/* Empty-state copy depends on what the server told us about restore.
                'empty-backup' / 'failed' on a fresh container means Storage either
                hadn't propagated or the restore threw — give the user a clear
                "syncing" signal instead of the misleading "no files." Falls back
                to the original copy when restored==='skipped' or undefined. */}
            {restoreState === 'empty-backup' || restoreState === 'failed'
              ? 'Workspace is syncing — refresh in a moment.'
              : 'No files yet. Ask the AI to build something.'}
          </div>
        ) : (
          <FileTree nodes={tree} searchQuery={search} />
        )}
      </div>

      {/* Impact summary placeholder — wired in Step 6 API */}
      <div
        style={{
          padding: 'var(--space-2) var(--space-3)',
          borderTop: '1px solid var(--border-base)',
          fontSize: '0.6875rem', color: 'var(--text-secondary)',
        }}
      >
        Hover a file to see import impact
      </div>
    </div>
  );
}
