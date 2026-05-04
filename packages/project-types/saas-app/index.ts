// packages/project-types/saas-app/index.ts — SaaS App project type.
// Full multi-tenant SaaS with auth, billing, teams, settings, and API.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const saasApp: ProjectType = {
  id:          'saas-app',
  label:       'SaaS App',
  description: 'Multi-tenant SaaS with auth, billing, team management, settings, and API.',
  icon:        '☁️',

  scaffold(input: ScaffoldInput): FileTree {
    const name   = input.projectName;
    const slug   = input.projectSlug;
    const accent = input.accentColor ?? '#6366f1';

    return {
      'README.md': `# ${name}\n\n${input.description ?? 'SaaS application.'}\n\n## Stack\n\nReact 18 + TypeScript + Vite (frontend)\nFastify + Drizzle + Supabase (backend)\n\n## Getting started\n\n\`\`\`\npnpm install\npnpm dev\n\`\`\`\n`,

      // Frontend
      'apps/web/index.html': `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${name}</title>\n  <script type="module" src="/src/main.tsx"></script>\n</head>\n<body><div id="root"></div></body>\n</html>\n`,
      'apps/web/package.json': JSON.stringify({ name: `${slug}-web`, version: '0.0.0', type: 'module', scripts: { dev: 'vite', build: 'tsc && vite build' }, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { '@vitejs/plugin-react': '^4.3.1', typescript: '^5.4.5', vite: '^5.3.1', '@types/react': '^18.3.3', '@types/react-dom': '^18.3.0' } }, null, 2),
      'apps/web/vite.config.ts': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()], server: { proxy: { '/api': 'http://localhost:3000' } } });\n`,
      'apps/web/src/main.tsx': `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App';\nimport './styles.css';\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n`,
      'apps/web/src/App.tsx': `export function App() {
  return (
    <div className="saas-shell">
      <nav className="saas-nav">
        <span className="saas-nav__brand">${name}</span>
        <div className="saas-nav__links">
          <a href="/dashboard">Dashboard</a>
          <a href="/billing">Billing</a>
          <a href="/team">Team</a>
          <a href="/settings">Settings</a>
        </div>
        <button className="saas-btn saas-btn--primary">Sign in</button>
      </nav>
      <main className="saas-main">
        <div className="saas-hero">
          <h1>${name}</h1>
          <p>${input.description ?? 'Your SaaS application.'}</p>
          <button className="saas-btn saas-btn--primary saas-btn--lg">Get started free</button>
        </div>
      </main>
    </div>
  );
}
`,
      'apps/web/src/styles.css': `/* ${name} SaaS styles */
:root { --accent: ${accent}; --font: system-ui, -apple-system, sans-serif; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); }
.saas-shell { min-height: 100vh; display: flex; flex-direction: column; }
.saas-nav { display: flex; align-items: center; gap: 1.5rem; padding: 0 1.5rem; height: 56px; border-bottom: 1px solid #e5e7eb; }
.saas-nav__brand { font-weight: 700; font-size: 1rem; }
.saas-nav__links { display: flex; gap: 1.25rem; flex: 1; }
.saas-nav__links a { text-decoration: none; color: #374151; font-size: 0.9375rem; }
.saas-main { flex: 1; }
.saas-hero { max-width: 700px; margin: 8rem auto; text-align: center; padding: 0 1.5rem; }
.saas-hero h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 800; margin-bottom: 1rem; }
.saas-hero p { color: #6b7280; font-size: 1.1875rem; margin-bottom: 2.5rem; }
.saas-btn { padding: 0.625rem 1.5rem; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; font-family: inherit; transition: opacity 0.15s; }
.saas-btn--primary { background: var(--accent); color: #fff; }
.saas-btn--primary:hover { opacity: 0.88; }
.saas-btn--lg { padding: 0.875rem 2rem; font-size: 1.0625rem; }
`,

      // API (stub)
      'apps/api/src/server.ts': `// ${name} API server — Fastify
import Fastify from 'fastify';
const app = Fastify({ logger: true });
app.get('/api/health', async () => ({ ok: true }));
app.listen({ port: 3000 }, (err) => { if (err) { app.log.error(err); process.exit(1); } });
`,
      'apps/api/package.json': JSON.stringify({ name: `${slug}-api`, version: '0.0.0', type: 'module', scripts: { dev: 'tsx watch src/server.ts', build: 'tsc --noEmit' }, dependencies: { fastify: '^4.27.0' }, devDependencies: { typescript: '^5.4.5', tsx: '^4.11.0', '@types/node': '^20.14.0' } }, null, 2),

      // Shared types
      'packages/shared/types.ts': `// Shared types between web and API
export interface User { id: string; email: string; name: string; tenantId: string; }
export interface Tenant { id: string; name: string; plan: 'starter' | 'pro' | 'enterprise'; }
`,

      // Infra
      'package.json': JSON.stringify({ name: slug, version: '0.0.0', private: true, workspaces: ['apps/*', 'packages/*'], scripts: { dev: 'turbo run dev', build: 'turbo run build' } }, null, 2),
    };
  },

  defaultVerificationMatrix: [
    'lint', 'typecheck', 'build', 'unit', 'integration', 'secretScan', 'depVuln', 'playwrightRuntime',
  ],

  defaultApprovalPolicy: {
    alwaysApprove: ['deploy.production', 'migration.apply.production', 'auth.model.change'],
    broadRewriteFiles: 8,
    broadRewriteLines: 300,
  },

  screens: ['preview', 'code', 'files', 'console', 'tests', 'visualqa', 'database', 'jobs', 'env-secrets', 'approvals'],
  agentInstructions: {
    systemPromptPrelude: 'types/saas-app.md',
    copyGuidance:
      'Marketing site (landing-page patterns) + dashboard SPA + auth flow. Niches: B2B SaaS / B2C SaaS / marketplace / productivity.',
    securitySOPs: [
      'Auth via Supabase or NextAuth — never roll-your-own',
      'No hardcoded API keys',
      'Stripe keys via env vars only',
      'CORS configured per origin',
    ],
    multiPageStrategy: {
      nicheManifestPath: 'types/saas-app/niches/',
      detectFromPrompt:  true,
    },
    assetBudget: { images: 8, icons: 8 },
  },
};
