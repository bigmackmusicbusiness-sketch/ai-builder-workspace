// apps/web/src/app/Shell.tsx — root layout shell.
// CSS Grid: top bar spans full width; left panel collapses via CSS var; main area
// renders whatever route is active (Workspace modes or a dedicated screen).
// Keyboard shortcut Cmd/Ctrl+\ toggles the left panel. All state survives collapse.
//
// Mode-aware (Phase E): the LeftPanel only renders in BUILDER mode (a project
// is selected AND the user is on a non-browse route). Browse routes like
// /projects, /templates, settings — render edge-to-edge without the chat panel.
//
// Embedded mode (round 8 Feature A): when the IDE is loaded inside an iframe
// (SPS portals' "Open builder" buttons), the URL carries `?embedded=true`.
// In that case we hide the TopBar so SPS's own chrome isn't doubled up. The
// flag is detected once on first mount and persisted in sessionStorage so it
// survives client-side navigations within the iframe (TanStack Router strips
// query params on link clicks; sessionStorage keeps the embedded flag sticky
// for the iframe's lifetime).
import { type ReactNode, useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useShellStore } from '../lib/store/shellStore';
import { useProjectStore } from '../lib/store/projectStore';
import { TopBar } from '../layout/TopBar/TopBar';
import { LeftPanel } from '../layout/LeftPanel/LeftPanel';

/** SessionStorage key for the round-8 embedded flag. Lives per-tab so opening
 *  the same project in a non-iframe tab restores full chrome. */
const EMBEDDED_FLAG_KEY = 'abw.embedded';

function readEmbeddedFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Initial detect: URL query param. SPS passes `?embedded=true` on the
    // first iframe load via the handoff redirect; the SPA picks it up here.
    const params = new URLSearchParams(window.location.search);
    if (params.get('embedded') === 'true') {
      try { sessionStorage.setItem(EMBEDDED_FLAG_KEY, '1'); } catch { /* ignore */ }
      return true;
    }
    return sessionStorage.getItem(EMBEDDED_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

interface ShellProps {
  /** Active route rendered by TanStack Router's <Outlet /> */
  children: ReactNode;
}

/** Routes that render WITHOUT the LeftPanel (chat). Mirrors the BROWSE_ROUTE
 *  set in TopBar.tsx. Keep in sync.
 *
 *  `/publish` is intentionally NOT here — it's a per-project surface reached
 *  from the in-builder ▲ Publish button, so the chat panel + builder topbar
 *  stay visible while the rep manages targets. */
const BROWSE_ROUTE_PREFIXES = [
  '/projects',
  '/templates',
  '/create',
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

  // Round-8 embedded mode. Detected on mount from `?embedded=true` query
  // param OR sessionStorage (sticky across navigations within the iframe).
  const [embedded] = useState<boolean>(() => readEmbeddedFlag());

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
        embedded ? 'abw-shell--embedded' : '',
      ].filter(Boolean).join(' ')}
      data-testid="shell"
      data-embedded={embedded ? 'true' : undefined}
    >
      {/* Top bar: project switcher, env badge, search, profile — spans full
          width. Hidden in embedded mode so the SPS portal's chrome isn't
          doubled-up with the IDE's. LeftPanel (chat) stays — it's the
          primary tool, not chrome. */}
      {!embedded && <TopBar />}

      {/* Left panel: chat + run history + approvals + model selector — only in builder mode */}
      {isBuilderMode && <LeftPanel />}

      {/* Main area: active route (Workspace or a screen) */}
      <main className="abw-shell__main" aria-label="Main workspace">
        {children}
      </main>
    </div>
  );
}
