// packages/project-types/dashboard/index.ts — Dashboard project type.
// React + TypeScript admin/analytics dashboard with sidebar nav, widgets, data table.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const dashboard: ProjectType = {
  id:          'dashboard',
  label:       'Dashboard',
  description: 'Admin / analytics dashboard with sidebar nav, stat widgets, and data tables.',
  icon:        '📊',

  scaffold(input: ScaffoldInput): FileTree {
    const accent = input.accentColor ?? '#6366f1';
    const name   = input.projectName;

    return {
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
      'src/App.tsx': `import { Sidebar } from './Sidebar';
import { Overview } from './Overview';

export function App() {
  return (
    <div className="dash-shell">
      <Sidebar />
      <main className="dash-main">
        <Overview />
      </main>
    </div>
  );
}
`,
      'src/Sidebar.tsx': `const NAV = [
  { label: 'Overview',   icon: '📊', active: true },
  { label: 'Analytics',  icon: '📈', active: false },
  { label: 'Users',      icon: '👥', active: false },
  { label: 'Reports',    icon: '📋', active: false },
  { label: 'Settings',   icon: '⚙️',  active: false },
];

export function Sidebar() {
  return (
    <aside className="dash-sidebar">
      <div className="dash-sidebar__brand">${name}</div>
      <nav className="dash-sidebar__nav">
        {NAV.map((item) => (
          <button
            key={item.label}
            className={\`dash-nav-item\${item.active ? ' dash-nav-item--active' : ''}\`}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
`,
      'src/Overview.tsx': `const STATS = [
  { label: 'Total users',   value: '—',  delta: null },
  { label: 'Active today',  value: '—',  delta: null },
  { label: 'Revenue (mo)',  value: '—',  delta: null },
  { label: 'Open tickets',  value: '—',  delta: null },
];

export function Overview() {
  return (
    <div className="dash-overview">
      <div className="dash-page-header">
        <h1>Overview</h1>
        <p className="dash-page-sub">Real-time snapshot of your key metrics.</p>
      </div>
      <div className="dash-stat-grid">
        {STATS.map((s) => (
          <div key={s.label} className="dash-stat-card">
            <div className="dash-stat-label">{s.label}</div>
            <div className="dash-stat-value">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th>ID</th><th>Name</th><th>Status</th><th>Date</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={4} style={{ textAlign: 'center', opacity: 0.5, padding: '2rem' }}>No data yet</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
`,
      'src/styles.css': `/* ${name} dashboard styles */
:root {
  --accent: ${accent};
  --bg: #0f172a;
  --bg-surface: #1e293b;
  --text: #f1f5f9;
  --text-secondary: #94a3b8;
  --border: #334155;
  --font: system-ui, -apple-system, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--bg); color: var(--text); }
.dash-shell { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.dash-sidebar { background: var(--bg-surface); border-right: 1px solid var(--border); padding: 1.5rem 0; display: flex; flex-direction: column; }
.dash-sidebar__brand { font-weight: 700; font-size: 1rem; padding: 0 1.25rem 1.5rem; color: var(--text); }
.dash-sidebar__nav { display: flex; flex-direction: column; gap: 0.25rem; padding: 0 0.75rem; }
.dash-nav-item { display: flex; align-items: center; gap: 0.625rem; padding: 0.5rem 0.75rem; border-radius: 6px; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 0.875rem; font-family: inherit; width: 100%; text-align: left; transition: background 0.12s; }
.dash-nav-item:hover { background: rgba(255,255,255,0.06); color: var(--text); }
.dash-nav-item--active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); font-weight: 600; }
.dash-main { padding: 2rem; overflow-y: auto; }
.dash-page-header { margin-bottom: 2rem; }
.dash-page-header h1 { font-size: 1.5rem; font-weight: 700; }
.dash-page-sub { color: var(--text-secondary); font-size: 0.9375rem; margin-top: 0.25rem; }
.dash-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
.dash-stat-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem 1.5rem; }
.dash-stat-label { font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 0.5rem; }
.dash-stat-value { font-size: 1.75rem; font-weight: 700; }
.dash-table-wrap { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.dash-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.dash-table th { padding: 0.75rem 1rem; text-align: left; color: var(--text-secondary); font-weight: 600; border-bottom: 1px solid var(--border); }
.dash-table td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); }
.dash-table tbody tr:last-child td { border-bottom: none; }
`,
      'README.md': `# ${name}\n\n${input.description ?? 'Admin dashboard.'}\n\n## Dev\n\n\`\`\`\nnpm install && npm run dev\n\`\`\`\n`,
    };
  },

  defaultVerificationMatrix: ['lint', 'typecheck', 'build', 'unit', 'secretScan', 'playwrightRuntime'],

  defaultApprovalPolicy: {},

  screens: ['preview', 'code', 'files', 'console', 'tests', 'split'],
  agentInstructions: {
    systemPromptPrelude: 'types/dashboard.md',
    copyGuidance:
      'React+Vite admin SPA. Sidebar nav, KPI cards, time-series charts, paginated tables, filter bar.',
    securitySOPs: [
      'Auth gate on all routes by default',
      'No hardcoded API keys — env vars only',
      'CSP-conscious script tags',
    ],
    multiPageStrategy: {
      nicheManifestPath: 'types/dashboard/niches/',
      detectFromPrompt:  true,
    },
    assetBudget: { images: 2, icons: 8 },
  },
};
