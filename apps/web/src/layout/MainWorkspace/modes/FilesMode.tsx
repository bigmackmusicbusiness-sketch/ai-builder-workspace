// apps/web/src/layout/MainWorkspace/modes/FilesMode.tsx — file tree + search mode.
// Shows the project file tree, search input, and opens files into the Code editor.
import { useState } from 'react';
import { FileTree, type FileNode } from '../../../features/files/FileTree';

// Stub tree — replaced by API data in Step 6 backend wiring.
const STUB_TREE: FileNode[] = [
  {
    id: 'src',
    path: 'src',
    name: 'src',
    type: 'dir',
    children: [
      { id: 'src/main.tsx', path: 'src/main.tsx', name: 'main.tsx', type: 'file' },
      {
        id: 'src/app',
        path: 'src/app',
        name: 'app',
        type: 'dir',
        children: [
          { id: 'src/app/Shell.tsx', path: 'src/app/Shell.tsx', name: 'Shell.tsx', type: 'file' },
        ],
      },
      {
        id: 'src/styles',
        path: 'src/styles',
        name: 'styles',
        type: 'dir',
        children: [
          { id: 'src/styles/app.css', path: 'src/styles/app.css', name: 'app.css', type: 'file' },
        ],
      },
    ],
  },
  { id: 'package.json', path: 'package.json', name: 'package.json', type: 'file' },
  { id: 'vite.config.ts', path: 'vite.config.ts', name: 'vite.config.ts', type: 'file' },
];

export function FilesMode() {
  const [search, setSearch] = useState('');

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
        <FileTree nodes={STUB_TREE} searchQuery={search} />
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
