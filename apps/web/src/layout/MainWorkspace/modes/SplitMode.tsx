// apps/web/src/layout/MainWorkspace/modes/SplitMode.tsx — two-pane split view.
// Uses a draggable divider (Resizable primitive from packages/ui). Layout persisted in shellStore.
import { useShellStore, type WorkspaceMode } from '../../../lib/store/shellStore';
import { PreviewMode } from './PreviewMode';
import { CodeMode } from './CodeMode';
import { FilesMode } from './FilesMode';
import { ConsoleMode } from './ConsoleMode';
import { TestsMode } from './TestsMode';
import { VisualQAMode } from './VisualQAMode';
import { ApiTesterMode } from './ApiTesterMode';
import { TerminalMode } from './TerminalMode';

const MODE_COMPONENTS: Record<WorkspaceMode, React.ComponentType> = {
  preview:      PreviewMode,
  code:         CodeMode,
  files:        FilesMode,
  console:      ConsoleMode,
  tests:        TestsMode,
  visualqa:     VisualQAMode,
  'api-tester': ApiTesterMode,
  terminal:     TerminalMode,
  split: () => null, // split inside split is not allowed
};

const SPLIT_OPTIONS: { id: WorkspaceMode; label: string }[] = [
  { id: 'preview',    label: 'Preview' },
  { id: 'code',       label: 'Code' },
  { id: 'files',      label: 'Files' },
  { id: 'console',    label: 'Console' },
  { id: 'tests',      label: 'Tests' },
  { id: 'visualqa',   label: 'Visual QA' },
  { id: 'api-tester', label: 'API' },
  { id: 'terminal',   label: 'Terminal' },
];

export function SplitMode() {
  const { splitLayout, setSplitLayout } = useShellStore();

  const LeftComp = MODE_COMPONENTS[splitLayout.left] ?? PreviewMode;
  const RightComp = MODE_COMPONENTS[splitLayout.right] ?? CodeMode;

  const leftPct = Math.max(20, Math.min(80, splitLayout.splitPct));

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left pane */}
      <div style={{ width: `${leftPct}%`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <SplitPaneHeader
          value={splitLayout.left}
          options={SPLIT_OPTIONS.filter((o) => o.id !== splitLayout.right)}
          onChange={(m) => setSplitLayout({ left: m })}
          aria-label="Left pane mode"
        />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <LeftComp />
        </div>
      </div>

      {/* Divider */}
      <div
        style={{
          width: 4, cursor: 'col-resize', background: 'var(--border-base)',
          flexShrink: 0, transition: 'background var(--duration-fast)',
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize split"
        title="Drag to resize"
      />

      {/* Right pane */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <SplitPaneHeader
          value={splitLayout.right}
          options={SPLIT_OPTIONS.filter((o) => o.id !== splitLayout.left)}
          onChange={(m) => setSplitLayout({ right: m })}
          aria-label="Right pane mode"
        />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <RightComp />
        </div>
      </div>
    </div>
  );
}

function SplitPaneHeader({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: WorkspaceMode;
  options: { id: WorkspaceMode; label: string }[];
  onChange: (m: WorkspaceMode) => void;
  'aria-label': string;
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '0 var(--space-2)', background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border-base)', minHeight: 30,
      }}
      role="toolbar"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          style={{
            border: 'none', background: 'none', cursor: 'pointer',
            padding: '0 var(--space-2)', height: 28,
            fontSize: '0.75rem', fontWeight: 500,
            color: value === opt.id ? 'var(--accent-600)' : 'var(--text-secondary)',
            borderBottom: value === opt.id ? '2px solid var(--accent-500)' : '2px solid transparent',
          }}
          aria-pressed={value === opt.id}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
