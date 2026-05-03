// apps/web/src/layout/MainWorkspace/Workspace.tsx — dominant main workspace.
// Renders the active mode: Preview | Code | Files | Console | Tests | Visual QA | API | Terminal | Split.
// Tab switch is instant (<50ms); no lazy loading needed at this scale.
//
// Route guard (Phase 4.4): if no project is selected, redirect to /projects so users
// don't land on an empty featureless shell. The post-login flow already targets
// /projects, but this closes the gap when users deep-link to /.
//
// NOTE: The <main> wrapper lives in Shell.tsx; this component fills that area.
import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useShellStore, type WorkspaceMode } from '../../lib/store/shellStore';
import { useProjectStore } from '../../lib/store/projectStore';
import { ModeTabs } from './ModeTabs';
import { PreviewMode } from './modes/PreviewMode';
import { CodeMode } from './modes/CodeMode';
import { FilesMode } from './modes/FilesMode';
import { ConsoleMode } from './modes/ConsoleMode';
import { TestsMode } from './modes/TestsMode';
import { VisualQAMode } from './modes/VisualQAMode';
import { SplitMode } from './modes/SplitMode';
import { ApiTesterMode } from './modes/ApiTesterMode';
import { TerminalMode } from './modes/TerminalMode';

type ModeComponent = React.ComponentType;

const MODE_MAP: Record<WorkspaceMode, ModeComponent> = {
  preview:     PreviewMode,
  code:        CodeMode,
  files:       FilesMode,
  console:     ConsoleMode,
  tests:       TestsMode,
  visualqa:    VisualQAMode,
  'api-tester': ApiTesterMode,
  terminal:    TerminalMode,
  split:       SplitMode,
};

export function Workspace() {
  const { activeMode } = useShellStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const navigate = useNavigate();

  // Guard: no project selected → bounce to /projects.
  // Done in an effect (not synchronously during render) so we don't fight TanStack
  // Router's render cycle.
  useEffect(() => {
    if (currentProjectId === 'global') {
      void navigate({ to: '/projects', replace: true });
    }
  }, [currentProjectId, navigate]);

  // While the redirect is in-flight, render nothing — avoids a flash of empty shell.
  if (currentProjectId === 'global') return null;

  const ActiveComponent = MODE_MAP[activeMode] ?? PreviewMode;

  return (
    <div className="abw-workspace">
      <ModeTabs />
      <div
        className="abw-workspace__content"
        role="tabpanel"
        id={`workspace-panel-${activeMode}`}
        aria-labelledby={`workspace-tab-${activeMode}`}
      >
        <ActiveComponent />
      </div>
    </div>
  );
}
