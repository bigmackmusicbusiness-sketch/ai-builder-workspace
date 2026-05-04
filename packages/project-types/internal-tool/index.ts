// packages/project-types/internal-tool/index.ts — Internal Tool project type.
// CRUD admin panel / ops tool: table views, detail panels, forms, auth gate.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const internalTool: ProjectType = {
  id:          'internal-tool',
  label:       'Internal Tool',
  description: 'Admin panel or ops tool with table views, detail panels, forms, and auth.',
  icon:        '🔧',

  scaffold(input: ScaffoldInput): FileTree {
    const name   = input.projectName;
    const accent = input.accentColor ?? '#6366f1';

    return {
      'README.md': `# ${name}\n\n${input.description ?? 'Internal tool.'}\n\n## Getting started\n\nConfigure your data source in \`src/data.ts\`, then run \`npm run dev\`.\n`,
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name} | Internal</title>
  <script type="module" src="/src/main.tsx"></script>
</head>
<body><div id="root"></div></body>
</html>
`,
      'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });
`,
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2020', lib: ['ES2020', 'DOM'],
          module: 'ESNext', moduleResolution: 'bundler',
          jsx: 'react-jsx', strict: true, noEmit: true,
        },
        include: ['src'],
      }, null, 2),
      'package.json': JSON.stringify({
        name: input.projectSlug,
        version: '0.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'tsc && vite build', preview: 'vite preview' },
        dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
        devDependencies: {
          '@vitejs/plugin-react': '^4.3.1',
          typescript: '^5.4.5',
          vite: '^5.3.1',
          '@types/react': '^18.3.3',
          '@types/react-dom': '^18.3.0',
        },
      }, null, 2),
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
`,
      'src/App.tsx': `import { useState } from 'react';

const NAV = ['Records', 'Reports', 'Settings'] as const;
type View = typeof NAV[number];

export function App() {
  const [view, setView] = useState<View>('Records');
  return (
    <div className="it-shell">
      <header className="it-topbar">
        <span className="it-topbar__brand">${name}</span>
        <nav className="it-topbar__nav">
          {NAV.map((v) => (
            <button
              key={v}
              className={\`it-nav-btn\${view === v ? ' it-nav-btn--active' : ''}\`}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </nav>
        <div className="it-topbar__spacer" />
        <span className="it-topbar__user">Admin</span>
      </header>
      <main className="it-main">
        {view === 'Records' && <RecordsView />}
        {view === 'Reports' && <PlaceholderView label="Reports" />}
        {view === 'Settings' && <PlaceholderView label="Settings" />}
      </main>
    </div>
  );
}

function RecordsView() {
  return (
    <div className="it-view">
      <div className="it-page-header">
        <h1>Records</h1>
        <button className="it-btn it-btn--primary">+ New record</button>
      </div>
      <div className="it-table-wrap">
        <table className="it-table">
          <thead>
            <tr><th>ID</th><th>Name</th><th>Status</th><th>Updated</th><th></th></tr>
          </thead>
          <tbody>
            <tr><td colSpan={5} className="it-table__empty">No records yet. Create one above.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlaceholderView({ label }: { label: string }) {
  return (
    <div className="it-view it-view--empty">
      <p>{label} — coming soon.</p>
    </div>
  );
}
`,
      'src/styles.css': `/* ${name} internal tool styles */
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
.it-shell { display: flex; flex-direction: column; min-height: 100vh; }
.it-topbar { display: flex; align-items: center; gap: 1rem; padding: 0 1.25rem; height: 52px; border-bottom: 1px solid var(--border); background: var(--bg); }
.it-topbar__brand { font-weight: 700; font-size: 0.9375rem; }
.it-topbar__nav { display: flex; gap: 0.25rem; }
.it-topbar__spacer { flex: 1; }
.it-topbar__user { font-size: 0.8125rem; color: var(--text-secondary); }
.it-nav-btn { padding: 0.3125rem 0.875rem; border-radius: 6px; border: none; background: transparent; cursor: pointer; font-size: 0.875rem; font-family: inherit; color: var(--text-secondary); transition: background 0.12s; }
.it-nav-btn:hover { background: var(--bg-surface); color: var(--text); }
.it-nav-btn--active { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); font-weight: 600; }
.it-main { flex: 1; overflow-y: auto; }
.it-view { padding: 2rem; }
.it-view--empty { display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }
.it-page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
.it-page-header h1 { font-size: 1.25rem; font-weight: 700; }
.it-btn { padding: 0.5rem 1rem; border-radius: 6px; border: none; cursor: pointer; font-size: 0.875rem; font-family: inherit; font-weight: 600; transition: opacity 0.15s; }
.it-btn--primary { background: var(--accent); color: #fff; }
.it-btn--primary:hover { opacity: 0.88; }
.it-table-wrap { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.it-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.it-table th { padding: 0.625rem 1rem; text-align: left; background: var(--bg-surface); color: var(--text-secondary); font-weight: 600; border-bottom: 1px solid var(--border); }
.it-table td { padding: 0.625rem 1rem; border-bottom: 1px solid var(--border); }
.it-table tbody tr:last-child td { border-bottom: none; }
.it-table__empty { text-align: center; color: var(--text-secondary); padding: 3rem 1rem !important; }
`,
    };
  },

  defaultVerificationMatrix: ['lint', 'typecheck', 'build', 'secretScan', 'playwrightRuntime'],

  defaultApprovalPolicy: {
    alwaysApprove: ['deploy.production', 'auth.model.change'],
  },

  screens: ['preview', 'code', 'files', 'console', 'tests', 'database'],
  agentInstructions: {
    systemPromptPrelude: 'types/internal-tool.md',
    copyGuidance:
      'list-detail-form CRUD. Audit log, role-based UI, auth gate, data table with filters.',
    securitySOPs: [
      'Auth gate is mandatory',
      'Audit log every mutation',
      'Role-based UI guards on sensitive actions',
    ],
    multiPageStrategy: {
    },
    assetBudget: { images: 0, icons: 8 },
  },
};
