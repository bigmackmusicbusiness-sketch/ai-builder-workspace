// packages/project-types/full-stack-app/index.ts — Full-Stack App project type.
// React frontend + Fastify API + Drizzle ORM + Supabase backend in a monorepo.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const fullStackApp: ProjectType = {
  id:          'full-stack-app',
  label:       'Full-Stack App',
  description: 'React + Fastify + Drizzle monorepo. Database, auth, API, and UI in one project.',
  icon:        '🏗️',

  scaffold(input: ScaffoldInput): FileTree {
    const name   = input.projectName;
    const slug   = input.projectSlug;
    const accent = input.accentColor ?? '#6366f1';

    return {
      'README.md': `# ${name}\n\n${input.description ?? 'Full-stack application.'}\n\n## Structure\n\n\`\`\`\napps/web     React 18 + TypeScript + Vite\napps/api     Fastify + TypeScript + Drizzle\npackages/db  Shared schema + migrations\npackages/shared  Shared Zod contracts\n\`\`\`\n\n## Dev\n\n\`\`\`\npnpm install\npnpm dev\n\`\`\`\n`,
      'package.json': JSON.stringify({ name: slug, version: '0.0.0', private: true, workspaces: ['apps/*', 'packages/*'], scripts: { dev: 'turbo run dev --parallel', build: 'turbo run build', lint: 'turbo run lint', typecheck: 'turbo run typecheck' } }, null, 2),
      'pnpm-workspace.yaml': `packages:\n  - 'apps/*'\n  - 'packages/*'\n`,
      'turbo.json': JSON.stringify({ $schema: 'https://turbo.build/schema.json', pipeline: { dev: { cache: false, persistent: true }, build: { dependsOn: ['^build'], outputs: ['dist/**'] }, lint: {}, typecheck: {} } }, null, 2),

      // Web app
      'apps/web/package.json': JSON.stringify({ name: `${slug}-web`, version: '0.0.0', type: 'module', scripts: { dev: 'vite', build: 'tsc && vite build' }, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { '@vitejs/plugin-react': '^4.3.1', typescript: '^5.4.5', vite: '^5.3.1', '@types/react': '^18.3.3', '@types/react-dom': '^18.3.0' } }, null, 2),
      'apps/web/index.html': `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${name}</title>\n  <script type="module" src="/src/main.tsx"></script>\n</head>\n<body><div id="root"></div></body>\n</html>\n`,
      'apps/web/vite.config.ts': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()], server: { proxy: { '/api': 'http://localhost:3000' } } });\n`,
      'apps/web/src/main.tsx': `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App';\nimport './styles.css';\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n`,
      'apps/web/src/App.tsx': `import { useEffect, useState } from 'react';

export function App() {
  const [health, setHealth] = useState<string>('checking…');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(() => setHealth('API connected ✓'))
      .catch(() => setHealth('API unreachable'));
  }, []);

  return (
    <div className="fs-shell">
      <h1>${name}</h1>
      <p className="fs-sub">${input.description ?? 'Full-stack application.'}</p>
      <div className="fs-status">API: {health}</div>
    </div>
  );
}
`,
      'apps/web/src/styles.css': `:root { --accent: ${accent}; }\n*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\nbody { font-family: system-ui, sans-serif; background: #fff; color: #111; }\n.fs-shell { max-width: 600px; margin: 8rem auto; padding: 0 1.5rem; }\n.fs-shell h1 { font-size: 2.5rem; font-weight: 800; margin-bottom: 0.75rem; }\n.fs-sub { color: #6b7280; font-size: 1.125rem; margin-bottom: 2rem; }\n.fs-status { display: inline-block; padding: 0.375rem 0.875rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; color: #166534; font-size: 0.875rem; font-weight: 600; }\n`,

      // API
      'apps/api/package.json': JSON.stringify({ name: `${slug}-api`, version: '0.0.0', type: 'module', scripts: { dev: 'tsx watch src/server.ts', build: 'tsc --noEmit' }, dependencies: { fastify: '^4.27.0', 'drizzle-orm': '^0.31.0', 'postgres': '^3.4.4', zod: '^3.23.8' }, devDependencies: { typescript: '^5.4.5', tsx: '^4.11.0', '@types/node': '^20.14.0', 'drizzle-kit': '^0.22.0' } }, null, 2),
      'apps/api/src/server.ts': `// ${name} API — Fastify server.
import Fastify from 'fastify';
const app = Fastify({ logger: { level: 'info' } });
app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));
const port = Number(process.env['PORT'] ?? 3000);
app.listen({ port, host: '0.0.0.0' }, (err) => { if (err) { app.log.error(err); process.exit(1); } });
`,
      'apps/api/src/config/env.ts': `import { z } from 'zod';\nconst EnvSchema = z.object({ NODE_ENV: z.enum(['development', 'test', 'production']).default('development'), PORT: z.coerce.number().default(3000), DATABASE_URL: z.string().url() });\nexport const env = EnvSchema.parse(process.env);\n`,

      // DB package
      'packages/db/package.json': JSON.stringify({ name: `${slug}-db`, version: '0.0.0', type: 'module', dependencies: { 'drizzle-orm': '^0.31.0', postgres: '^3.4.4' }, devDependencies: { typescript: '^5.4.5', 'drizzle-kit': '^0.22.0' } }, null, 2),
      'packages/db/schema/index.ts': `// Drizzle schema — add your tables here.
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id:        uuid('id').primaryKey().defaultRandom(),
  email:     text('email').notNull().unique(),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
`,

      // Shared contracts
      'packages/shared/package.json': JSON.stringify({ name: `${slug}-shared`, version: '0.0.0', type: 'module', dependencies: { zod: '^3.23.8' } }, null, 2),
      'packages/shared/contracts.ts': `// Shared Zod contracts between web, api, and worker.
import { z } from 'zod';
export const UserSchema = z.object({ id: z.string().uuid(), email: z.string().email(), name: z.string() });
export type User = z.infer<typeof UserSchema>;
`,
    };
  },

  defaultVerificationMatrix: [
    'lint', 'typecheck', 'build', 'unit', 'integration', 'e2e',
    'secretScan', 'depVuln', 'migrationSmoke', 'playwrightRuntime',
  ],

  defaultApprovalPolicy: {
    alwaysApprove: ['deploy.production', 'migration.apply.production', 'migration.apply.staging', 'auth.model.change'],
    broadRewriteFiles: 10,
    broadRewriteLines: 500,
  },

  screens: ['preview', 'code', 'files', 'console', 'tests', 'visualqa', 'split', 'database', 'jobs', 'env-secrets', 'approvals'],
  agentInstructions: {
    systemPromptPrelude: 'types/full-stack-app.md',
    copyGuidance:
      'Generic FE+BE monorepo. Reuse saas-app patterns when ambiguous.',
    securitySOPs: [
      'Auth + audit + Zod validation by default',
      'No hardcoded keys',
    ],
    multiPageStrategy: {
    },
    assetBudget: { images: 4, icons: 8 },
  },
};
