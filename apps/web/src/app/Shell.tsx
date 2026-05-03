// apps/web/src/app/Shell.tsx — root layout shell.
// CSS Grid: top bar spans full width; left panel collapses via CSS var; main area
// renders whatever route is active (Workspace modes or a dedicated screen).
// Keyboard shortcut Cmd/Ctrl+\ toggles the left panel. All state survives collapse.
//
// Mode-aware (Phase E): the LeftPanel only renders in BUILDER mode (a project
// is selected AND the user is on a non-browse route). Browse routes like
// /projects, /templates, settings — render edge-to-edge without the chat panel.
import { type ReactNode, useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useShellStore } from '../lib/store/shellStore';
import { useProjectStore } from '../lib/store/projectStore';
import { TopBar } from '../layout/TopBar/TopBar';
import { LeftPanel } from '../layout/LeftPanel/LeftPanel';

interface ShellProps {
  /** Active route rendered by TanStack Router's <Outlet /> */
  children: ReactNode;
}

/** Routes that render WITHOUT the LeftPanel (chat). Mirrors the BROWSE_ROUTE
 *  set in TopBar.tsx. Keep in sync. */
const BROWSE_ROUTE_PREFIXES = [
  '/projects',
  '/templates',
  '/create',
  '/publish',
  '/approvals',
  '/integrations',
  '/env-secrets',
  '/database',
  '/assets',
  '/versions',
  '/runs',
  '/logs',
  '/jobs',
  '/onboarding',
  '/settings',
];

export function Shell({ children }: ShellProps) {
  const { collapsed, toggleCollapsed } = useShellStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const routerState = useRouterState();
  const path = routerState.location.pathname;

  const onBrowseRoute = BROWSE_ROUTE_PREFIXES.some((p) => path.startsWith(p));
  const isBuilderMode = currentProjectId !== 'global' && !onBrowseRoute;

  // Keyboard shortcut: Cmd/Ctrl + \
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleCollapsed();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCollapsed]);

  return (
    <div
      className={[
        'abw-shell',
        collapsed ? 'abw-shell--collapsed' : '',
        isBuilderMode ? 'abw-shell--builder' : 'abw-shell--browse',
      ].filter(Boolean).join(' ')}
      data-testid="shell"
    >
      {/* Top bar: project switcher, env badge, search, profile — spans full width */}
      <TopBar />

      {/* Left panel: chat + run history + approvals + model selector — only in builder mode */}
      {isBuilderMode && <LeftPanel />}

      {/* Main area: active route (Workspace or a screen) */}
      <main className="abw-shell__main" aria-label="Main workspace">
        {children}
      </main>
    </div>
  );
}
