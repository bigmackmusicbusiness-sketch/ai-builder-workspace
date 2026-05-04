// packages/project-types/automation-panel/index.ts — Automation Control Panel type.
// Control surface for automation workflows: trigger board, run log, approvals, rollback.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const automationPanel: ProjectType = {
  id:          'automation-panel',
  label:       'Automation Control Panel',
  description: 'Control surface for automation workflows: triggers, run log, approvals, rollback.',
  icon:        '⚙️',

  scaffold(input: ScaffoldInput): FileTree {
    const name   = input.projectName;
    const accent = input.accentColor ?? '#6366f1';

    return {
      'README.md': `# ${name}\n\n${input.description ?? 'Automation control panel.'}\n\n## Architecture\n\nEach automation is defined in \`src/automations/\`. Every action that touches live accounts is approval-gated.\n`,
      'index.html': `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${name}</title>\n  <script type="module" src="/src/main.tsx"></script>\n</head>\n<body><div id="root"></div></body>\n</html>\n`,
      'vite.config.ts': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`,
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['ES2020', 'DOM'], module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, noEmit: true }, include: ['src'] }, null, 2),
      'package.json': JSON.stringify({ name: input.projectSlug, version: '0.0.0', type: 'module', scripts: { dev: 'vite', build: 'tsc && vite build' }, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { '@vitejs/plugin-react': '^4.3.1', typescript: '^5.4.5', vite: '^5.3.1', '@types/react': '^18.3.3', '@types/react-dom': '^18.3.0' } }, null, 2),
      'src/main.tsx': `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App';\nimport './styles.css';\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n`,
      'src/App.tsx': `import { useState } from 'react';

type RunStatus = 'idle' | 'running' | 'success' | 'failed' | 'awaiting_approval';

interface Automation {
  id:     string;
  label:  string;
  desc:   string;
  live:   boolean; // touches live accounts — always requires approval
  status: RunStatus;
  lastRun?: string;
}

const INITIAL: Automation[] = [
  { id: 'welcome-email', label: 'Send welcome email', desc: 'Sends onboarding email to new signups.', live: false, status: 'idle' },
  { id: 'sync-crm',      label: 'Sync to CRM',        desc: 'Pushes contact records to the CRM.', live: true, status: 'idle' },
  { id: 'provision-account', label: 'Provision account', desc: 'Creates accounts in the connected platform.', live: true, status: 'idle' },
];

const STATUS_LABELS: Record<RunStatus, string> = {
  idle: 'Idle', running: 'Running…', success: 'Success',
  failed: 'Failed', awaiting_approval: 'Awaiting approval',
};

export function App() {
  const [automations, setAutomations] = useState<Automation[]>(INITIAL);

  function trigger(id: string) {
    setAutomations((prev) => prev.map((a) => {
      if (a.id !== id) return a;
      // Live automations require approval — surface "awaiting_approval" state
      const nextStatus: RunStatus = a.live ? 'awaiting_approval' : 'running';
      return { ...a, status: nextStatus };
    }));
  }

  function reset(id: string) {
    setAutomations((prev) => prev.map((a) => a.id === id ? { ...a, status: 'idle' } : a));
  }

  return (
    <div className="ap-shell">
      <header className="ap-header">
        <span className="ap-header__brand">${name}</span>
        <span className="ap-header__sub">Automation Control Panel</span>
      </header>
      <main className="ap-main">
        <div className="ap-page-header">
          <h1>Automations</h1>
          <p className="ap-page-sub">Trigger and monitor automated workflows. Live-account actions require approval.</p>
        </div>
        <div className="ap-list">
          {automations.map((a) => (
            <div key={a.id} className="ap-card">
              <div className="ap-card__body">
                <div className="ap-card__label">{a.label}</div>
                <div className="ap-card__desc">{a.desc}</div>
                {a.live && <span className="ap-badge ap-badge--live">Touches live accounts</span>}
              </div>
              <div className="ap-card__status">
                <span className={\`ap-status ap-status--\${a.status}\`}>{STATUS_LABELS[a.status]}</span>
              </div>
              <div className="ap-card__actions">
                {a.status === 'idle' || a.status === 'success' || a.status === 'failed' ? (
                  <button className="ap-btn ap-btn--primary" onClick={() => trigger(a.id)}>
                    {a.live ? 'Request run' : 'Run'}
                  </button>
                ) : a.status === 'awaiting_approval' ? (
                  <button className="ap-btn ap-btn--ghost" onClick={() => reset(a.id)}>Cancel request</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
`,
      'src/styles.css': `/* ${name} automation panel styles */
:root {
  --accent: ${accent};
  --bg: #ffffff;
  --bg-surface: #f8fafc;
  --border: #e2e8f0;
  --text: #0f172a;
  --text-secondary: #64748b;
  --font: system-ui, -apple-system, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--bg); color: var(--text); }
.ap-shell { display: flex; flex-direction: column; min-height: 100vh; }
.ap-header { padding: 0.875rem 1.5rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 1rem; }
.ap-header__brand { font-weight: 700; font-size: 0.9375rem; }
.ap-header__sub { font-size: 0.8125rem; color: var(--text-secondary); }
.ap-main { padding: 2rem; max-width: 900px; margin: 0 auto; width: 100%; }
.ap-page-header { margin-bottom: 2rem; }
.ap-page-header h1 { font-size: 1.5rem; font-weight: 700; }
.ap-page-sub { color: var(--text-secondary); font-size: 0.9375rem; margin-top: 0.25rem; }
.ap-list { display: flex; flex-direction: column; gap: 1rem; }
.ap-card { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 1.5rem; padding: 1.25rem; border: 1px solid var(--border); border-radius: 10px; }
.ap-card__label { font-weight: 600; font-size: 0.9375rem; }
.ap-card__desc { font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.25rem; }
.ap-badge { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0.625rem; border-radius: 100px; margin-top: 0.5rem; }
.ap-badge--live { background: #fef9c3; color: #854d0e; }
.ap-status { font-size: 0.8125rem; font-weight: 600; padding: 0.25rem 0.625rem; border-radius: 100px; }
.ap-status--idle { color: var(--text-secondary); background: var(--bg-surface); }
.ap-status--running { color: #1d4ed8; background: #eff6ff; }
.ap-status--success { color: #166534; background: #f0fdf4; }
.ap-status--failed { color: #991b1b; background: #fef2f2; }
.ap-status--awaiting_approval { color: #92400e; background: #fffbeb; }
.ap-btn { padding: 0.5rem 1rem; border-radius: 6px; border: none; cursor: pointer; font-size: 0.875rem; font-family: inherit; font-weight: 600; transition: opacity 0.15s; }
.ap-btn--primary { background: var(--accent); color: #fff; }
.ap-btn--primary:hover { opacity: 0.88; }
.ap-btn--ghost { background: var(--bg-surface); color: var(--text); border: 1px solid var(--border); }
`,
      'src/automations/index.ts': `// Register your automation handlers here.
// Each automation must have a typed input, a typed output, and an explicit
// requiresApproval flag. Live-account automations are ALWAYS approval-gated
// by the server-side approvalMatrix.
export interface AutomationHandler<I, O> {
  id:              string;
  requiresApproval: boolean;
  run(input: I): Promise<O>;
  rollback(input: I, output: O): Promise<void>;
}

// Example (replace with real implementations):
// export const sendWelcomeEmail: AutomationHandler<{ userId: string }, { sent: boolean }> = { ... }
`,
    };
  },

  defaultVerificationMatrix: ['lint', 'typecheck', 'build', 'secretScan', 'playwrightRuntime'],

  defaultApprovalPolicy: {
    alwaysApprove: ['automation.run.live', 'automation.bulk'],
  },

  screens: ['preview', 'code', 'files', 'console', 'tests', 'jobs', 'approvals'],
  agentInstructions: {
    systemPromptPrelude: 'types/automation-panel.md',
    copyGuidance:
      'Task/workflow runner UI. Queue + status + retry patterns.',
    securitySOPs: [
      'Webhook receivers verify signature',
      'Trigger requires confirm step',
      'Audit run history',
    ],
    multiPageStrategy: {
    },
    assetBudget: { images: 0, icons: 8 },
  },
};
