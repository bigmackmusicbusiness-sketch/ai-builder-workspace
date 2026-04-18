// apps/web/src/features/editor/DiffViewer.tsx — Monaco diff editor for agent-proposed changes.
// Shows original vs proposed; per-file accept/reject + bulk accept.
import { useRef, useCallback } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type { DiffOnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';

export interface FileDiff {
  fileId: string;
  path: string;
  language: string;
  original: string;
  modified: string;
}

interface DiffViewerProps {
  diff: FileDiff;
  onAccept: (fileId: string, newContent: string) => void;
  onReject: (fileId: string) => void;
}

export function DiffViewer({ diff, onAccept, onReject }: DiffViewerProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);

  const handleMount = useCallback<DiffOnMount>((editor) => {
    editorRef.current = editor;
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Diff toolbar */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-base)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '0.75rem', fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)', flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {diff.path}
        </span>
        <button
          onClick={() => onReject(diff.fileId)}
          style={{
            padding: '3px var(--space-2)', border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)', background: 'var(--bg-subtle)',
            cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-secondary)',
          }}
        >
          Reject
        </button>
        <button
          onClick={() => onAccept(diff.fileId, diff.modified)}
          style={{
            padding: '3px var(--space-2)', border: 'none',
            borderRadius: 'var(--radius-field)', background: 'var(--color-success)',
            cursor: 'pointer', fontSize: '0.75rem', color: '#fff', fontWeight: 600,
          }}
        >
          Accept
        </button>
      </div>

      {/* Diff editor */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DiffEditor
          height="100%"
          language={diff.language}
          original={diff.original}
          modified={diff.modified}
          theme="abw-dark"
          onMount={handleMount}
          options={{
            readOnly: true,
            renderSideBySide: true,
            fontSize: 13,
            fontFamily: '"Fira Code", "Cascadia Code", "Consolas", monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}

// ── Proposed Changes Tray ────────────────────────────────────────────────────

interface ProposedChangesTrayProps {
  diffs: FileDiff[];
  onAccept: (fileId: string, newContent: string) => void;
  onReject: (fileId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function ProposedChangesTray({
  diffs,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: ProposedChangesTrayProps) {
  if (diffs.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'var(--bg-elevated)',
        borderTop: '2px solid var(--accent-500)',
        zIndex: 10, maxHeight: '50%',
        display: 'flex', flexDirection: 'column',
      }}
      role="region"
      aria-label="Proposed changes"
    >
      {/* Tray header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--border-base)', flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, flex: 1 }}>
          Proposed changes ({diffs.length} file{diffs.length !== 1 ? 's' : ''})
        </span>
        <button
          onClick={onRejectAll}
          style={{
            padding: '3px var(--space-2)', border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)', background: 'var(--bg-subtle)',
            cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-secondary)',
          }}
        >
          Reject all
        </button>
        <button
          onClick={onAcceptAll}
          style={{
            padding: '3px var(--space-2)', border: 'none',
            borderRadius: 'var(--radius-field)', background: 'var(--color-success)',
            cursor: 'pointer', fontSize: '0.75rem', color: '#fff', fontWeight: 600,
          }}
        >
          Accept all
        </button>
      </div>

      {/* File list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {diffs.map((diff) => (
          <div
            key={diff.fileId}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-3)',
              borderBottom: '1px solid var(--border-base)',
              fontSize: '0.8125rem',
            }}
          >
            <span
              style={{
                flex: 1, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {diff.path}
            </span>
            <button
              onClick={() => onReject(diff.fileId)}
              style={{
                padding: '2px var(--space-2)', border: '1px solid var(--border-base)',
                borderRadius: 'var(--radius-field)', background: 'none',
                cursor: 'pointer', fontSize: '0.6875rem', color: 'var(--text-secondary)',
              }}
            >
              Reject
            </button>
            <button
              onClick={() => onAccept(diff.fileId, diff.modified)}
              style={{
                padding: '2px var(--space-2)', border: 'none',
                borderRadius: 'var(--radius-field)', background: 'var(--color-success)',
                cursor: 'pointer', fontSize: '0.6875rem', color: '#fff', fontWeight: 600,
              }}
            >
              Accept
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
