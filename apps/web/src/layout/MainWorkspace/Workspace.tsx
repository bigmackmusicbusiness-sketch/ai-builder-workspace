// apps/web/src/layout/MainWorkspace/Workspace.tsx — dominant main workspace.
// Renders the active mode: Preview | Code | Files | Console | Tests | Visual QA | API | Terminal | Split.
// Tab switch is instant (<50ms); no lazy loading needed at this scale.
// NOTE: The <main> wrapper lives in Shell.tsx; this component fills that area.
import { useShellStore, type WorkspaceMode } from '../../lib/store/shellStore';
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
