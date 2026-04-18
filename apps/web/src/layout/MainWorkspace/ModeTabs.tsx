// apps/web/src/layout/MainWorkspace/ModeTabs.tsx — mode tab bar across workspace top.
// Tabs: Preview | Code | Files | Console | Tests | Visual QA | Split
import { useShellStore, type WorkspaceMode } from '../../lib/store/shellStore';

interface Tab {
  id: WorkspaceMode;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: 'preview',    label: 'Preview',    icon: '🖥' },
  { id: 'code',       label: 'Code',       icon: '</>' },
  { id: 'files',      label: 'Files',      icon: '📁' },
  { id: 'console',    label: 'Console',    icon: '>' },
  { id: 'tests',      label: 'Tests',      icon: '✅' },
  { id: 'visualqa',   label: 'Visual QA',  icon: '🖼' },
  { id: 'api-tester', label: 'API',        icon: '↩' },
  { id: 'terminal',   label: 'Terminal',   icon: '$' },
  { id: 'split',      label: 'Split',      icon: '⊞' },
];

export function ModeTabs() {
  const { activeMode, setActiveMode } = useShellStore();

  return (
    <div className="abw-workspace__tabs" aria-label="Workspace modes" role="tablist">
      {TABS.map(({ id, label, icon }) => {
        const isActive = activeMode === id;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`workspace-panel-${id}`}
            id={`workspace-tab-${id}`}
            className={`abw-workspace__tab${isActive ? ' abw-workspace__tab--active' : ''}`}
            onClick={() => setActiveMode(id)}
            title={label}
          >
            <span aria-hidden style={{ fontSize: '0.75rem' }}>{icon}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
