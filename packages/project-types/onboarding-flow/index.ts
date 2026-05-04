// packages/project-types/onboarding-flow/index.ts — Onboarding Flow project type.
// Multi-step onboarding wizard with typed steps, progress tracking,
// intake forms, and approval-gated account-setup steps.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

function buildStepTypes(steps: string[]): string {
  const stepUnion = steps.map((s) => JSON.stringify(s)).join(' | ');
  return `// Auto-generated step types for this onboarding flow.
export type StepId = ${stepUnion};

export interface StepDef {
  id:          StepId;
  title:       string;
  description: string;
  /** If true, completing this step requires an approval. */
  requiresApproval?: boolean;
  /** Optional roll-back function invoked on reject/undo. */
  rollback?:   () => Promise<void>;
}

export const STEPS: StepDef[] = [
${steps.map((s, i) => `  {
    id:          ${JSON.stringify(s)},
    title:       ${JSON.stringify(s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' '))},
    description: 'Complete this step to continue.',
    requiresApproval: false,
  },`).join('\n')}
];
`;
}

function buildApp(name: string, steps: string[], accent: string): string {
  return `import { useState } from 'react';
import { STEPS } from './steps';

type StepStatus = 'pending' | 'active' | 'done' | 'error';

export function App() {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [statusMap, setStatusMap] = useState<Record<string, StepStatus>>(() =>
    Object.fromEntries(STEPS.map((s, i) => [s.id, i === 0 ? 'active' : 'pending']))
  );
  const [error, setError] = useState<string | null>(null);

  const current = STEPS[currentIdx];

  function advance() {
    if (currentIdx >= STEPS.length - 1) return;
    setStatusMap((prev) => ({
      ...prev,
      [current.id]: 'done',
      [STEPS[currentIdx + 1].id]: 'active',
    }));
    setCurrentIdx((i) => i + 1);
    setError(null);
  }

  const pct = Math.round((Object.values(statusMap).filter((s) => s === 'done').length / STEPS.length) * 100);

  return (
    <div className="of-shell">
      {/* Header */}
      <header className="of-header">
        <span className="of-header__brand">${name}</span>
        <div className="of-progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="of-progress-bar__fill" style={{ width: \`\${pct}%\` }} />
        </div>
        <span className="of-header__pct">{pct}%</span>
      </header>

      <div className="of-body">
        {/* Step list */}
        <aside className="of-steps">
          {STEPS.map((step, idx) => {
            const status = statusMap[step.id] ?? 'pending';
            return (
              <div key={step.id} className={\`of-step of-step--\${status}\`}>
                <div className="of-step__indicator">
                  {status === 'done' ? '✓' : idx + 1}
                </div>
                <div className="of-step__info">
                  <div className="of-step__title">{step.title}</div>
                  <div className="of-step__desc">{step.description}</div>
                </div>
              </div>
            );
          })}
        </aside>

        {/* Active step content */}
        <main className="of-content">
          {error && (
            <div className="of-error" role="alert">{error}</div>
          )}
          <div className="of-step-card">
            <h1 className="of-step-card__title">{current.title}</h1>
            <p className="of-step-card__desc">{current.description}</p>
            {current.requiresApproval && (
              <div className="of-approval-notice">
                ⚠️ This step requires approval before it can be completed.
              </div>
            )}
            <div className="of-step-card__actions">
              <button
                className="of-btn of-btn--primary"
                onClick={advance}
                disabled={currentIdx >= STEPS.length - 1 && statusMap[current.id] === 'done'}
              >
                {currentIdx >= STEPS.length - 1 ? 'Finish' : 'Continue'}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
`;
}

function buildStyles(accent: string): string {
  return `/* Onboarding flow styles */
:root {
  --accent: ${accent};
  --bg: #ffffff;
  --bg-surface: #f9fafb;
  --border: #e5e7eb;
  --text: #111827;
  --text-secondary: #6b7280;
  --font: system-ui, -apple-system, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--bg); color: var(--text); }

.of-shell { display: flex; flex-direction: column; min-height: 100vh; }
.of-header { display: flex; align-items: center; gap: 1rem; padding: 0.875rem 1.5rem; border-bottom: 1px solid var(--border); }
.of-header__brand { font-weight: 700; font-size: 0.9375rem; white-space: nowrap; }
.of-header__pct { font-size: 0.8125rem; color: var(--text-secondary); white-space: nowrap; }
.of-progress-bar { flex: 1; height: 6px; background: var(--border); border-radius: 100px; overflow: hidden; }
.of-progress-bar__fill { height: 100%; background: var(--accent); border-radius: 100px; transition: width 0.3s ease; }

.of-body { display: grid; grid-template-columns: 280px 1fr; flex: 1; }
.of-steps { border-right: 1px solid var(--border); padding: 2rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; background: var(--bg-surface); }

.of-step { display: flex; gap: 0.875rem; padding: 0.75rem; border-radius: 8px; transition: background 0.12s; }
.of-step--active { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.of-step--done { opacity: 0.65; }
.of-step--error { background: color-mix(in srgb, #ef4444 8%, transparent); }
.of-step__indicator { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0; }
.of-step--active .of-step__indicator { border-color: var(--accent); color: var(--accent); }
.of-step--done .of-step__indicator { border-color: #10b981; background: #10b981; color: #fff; }
.of-step--error .of-step__indicator { border-color: #ef4444; color: #ef4444; }
.of-step__title { font-size: 0.875rem; font-weight: 600; }
.of-step__desc { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem; }

.of-content { padding: 3rem; overflow-y: auto; }
.of-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 0.875rem 1rem; color: #991b1b; font-size: 0.875rem; margin-bottom: 1.5rem; }
.of-approval-notice { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 0.875rem 1rem; font-size: 0.875rem; color: #92400e; margin-bottom: 1.5rem; }
.of-step-card { max-width: 600px; }
.of-step-card__title { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.75rem; }
.of-step-card__desc { color: var(--text-secondary); margin-bottom: 2rem; line-height: 1.6; }
.of-step-card__actions { display: flex; gap: 0.75rem; }
.of-btn { padding: 0.625rem 1.5rem; border-radius: 8px; border: none; cursor: pointer; font-size: 0.9375rem; font-family: inherit; font-weight: 600; transition: opacity 0.15s; }
.of-btn--primary { background: var(--accent); color: #fff; }
.of-btn--primary:hover:not(:disabled) { opacity: 0.88; }
.of-btn:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 768px) {
  .of-body { grid-template-columns: 1fr; }
  .of-steps { display: none; }
  .of-content { padding: 1.5rem; }
}
`;
}

export const onboardingFlow: ProjectType = {
  id:          'onboarding-flow',
  label:       'Onboarding Flow',
  description: 'Multi-step onboarding wizard with typed steps, progress, and approval-gated account actions.',
  icon:        '🚀',

  scaffold(input: ScaffoldInput): FileTree {
    const steps  = input.steps?.length ? input.steps : ['welcome', 'account-setup', 'configure', 'verify', 'done'];
    const accent = input.accentColor ?? '#6366f1';
    const name   = input.projectName;

    return {
      'README.md': `# ${name}\n\n${input.description ?? 'Onboarding flow.'}\n\n## Steps\n${steps.map((s) => `- ${s}`).join('\n')}\n`,
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <script type="module" src="/src/main.tsx"></script>
</head>
<body><div id="root"></div></body>
</html>
`,
      'vite.config.ts': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`,
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['ES2020', 'DOM'], module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, noEmit: true }, include: ['src'] }, null, 2),
      'package.json': JSON.stringify({ name: input.projectSlug, version: '0.0.0', type: 'module', scripts: { dev: 'vite', build: 'tsc && vite build' }, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { '@vitejs/plugin-react': '^4.3.1', typescript: '^5.4.5', vite: '^5.3.1', '@types/react': '^18.3.3', '@types/react-dom': '^18.3.0' } }, null, 2),
      'src/main.tsx': `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App';\nimport './styles.css';\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n`,
      'src/steps.ts': buildStepTypes(steps),
      'src/App.tsx': buildApp(name, steps, accent),
      'src/styles.css': buildStyles(accent),
    };
  },

  defaultVerificationMatrix: [
    'lint', 'typecheck', 'build', 'secretScan', 'playwrightRuntime',
  ],

  defaultApprovalPolicy: {
    alwaysApprove: ['automation.run.live', 'automation.bulk', 'integration.connect'],
  },

  screens: ['preview', 'code', 'files', 'console', 'tests', 'onboarding'],
  agentInstructions: {
    systemPromptPrelude: 'types/onboarding-flow.md',
    copyGuidance:
      'Multi-step typed wizard. Progress bar. Save-and-resume. Approval gates between sensitive steps.',
    securitySOPs: [
      'Validate every step input via Zod',
      'PII fields use input type="password" or masked',
      'No auto-submit — user must click Continue',
    ],
    multiPageStrategy: {
      nicheManifestPath: 'types/onboarding-flow/niches/',
      detectFromPrompt:  true,
    },
    assetBudget: { images: 2, icons: 8 },
  },
};
