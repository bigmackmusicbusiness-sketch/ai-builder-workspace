// apps/web/src/app/Shell.tsx — root layout shell.
// CSS Grid: top bar spans full width; left panel collapses via CSS var; main area
// renders whatever route is active (Workspace modes or a dedicated screen).
// Keyboard shortcut Cmd/Ctrl+\ toggles the left panel. All state survives collapse.
import { type ReactNode, useEffect } from 'react';
import { useShellStore } from '../lib/store/shellStore';
import { TopBar } from '../layout/TopBar/TopBar';
import { LeftPanel } from '../layout/LeftPanel/LeftPanel';

interface ShellProps {
  /** Active route rendered by TanStack Router's <Outlet /> */
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const { collapsed, toggleCollapsed } = useShellStore();

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
      className={`abw-shell${collapsed ? ' abw-shell--collapsed' : ''}`}
      data-testid="shell"
    >
      {/* Top bar: project switcher, env badge, search, profile — spans full width */}
      <TopBar />

      {/* Left panel: chat + run history + approvals + model selector */}
      <LeftPanel />

      {/* Main area: active route (Workspace or a screen) */}
      <main className="abw-shell__main" aria-label="Main workspace">
        {children}
      </main>
    </div>
  );
}
