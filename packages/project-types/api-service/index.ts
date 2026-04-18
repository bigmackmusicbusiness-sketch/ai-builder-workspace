// packages/project-types/api-service/index.ts — API Service project type.
// Fastify + TypeScript REST API with typed routes, Zod validation, and OpenAPI docs.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const apiService: ProjectType = {
  id:          'api-service',
  label:       'API Service',
  description: 'Fastify + TypeScript REST API with Zod validation and OpenAPI documentation.',
  icon:        '🔌',

  scaffold(input: ScaffoldInput): FileTree {
    const name   = input.projectName;
    const slug   = input.projectSlug;
    const accent = input.accentColor ?? '#6366f1';

    return {
      'README.md': `# ${name}\n\n${input.description ?? 'REST API service.'}\n\n## Dev\n\n\`\`\`\npnpm install && pnpm dev\n\`\`\`\n\nAPI runs at \`http://localhost:3000\`.\nOpenAPI docs at \`http://localhost:3000/docs\`.\n`,
      'package.json': JSON.stringify({
        name: slug,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'tsx watch src/server.ts',
          build: 'tsc --noEmit',
          start: 'node dist/server.js',
          'test:unit': 'vitest run',
        },
        dependencies: {
          fastify:             '^4.27.0',
          '@fastify/swagger':  '^8.14.0',
          '@fastify/swagger-ui': '^4.0.1',
          zod:                 '^3.23.8',
          '@sinclair/typebox': '^0.32.28',
        },
        devDependencies: {
          typescript:   '^5.4.5',
          tsx:          '^4.11.0',
          vitest:       '^1.6.0',
          '@types/node': '^20.14.0',
        },
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
          lib: ['ES2022'], strict: true, noEmit: true, outDir: 'dist',
        },
        include: ['src'],
      }, null, 2),
      'src/server.ts': `// ${name} — Fastify server entry point.
import Fastify from 'fastify';
import { healthRoute }  from './routes/health.js';
import { exampleRoute } from './routes/example.js';

const app = Fastify({ logger: { level: 'info' } });

// Register routes
app.register(healthRoute);
app.register(exampleRoute, { prefix: '/api/v1' });

// Start
const port = Number(process.env['PORT'] ?? 3000);
app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
});
`,
      'src/routes/health.ts': `// Health check route — no auth required.
import type { FastifyPluginAsync } from 'fastify';

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_req, reply) => {
    return reply.send({ ok: true, ts: new Date().toISOString() });
  });
};
`,
      'src/routes/example.ts': `// Example CRUD route — replace with real domain entities.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const CreateItemSchema = z.object({ name: z.string().min(1).max(255) });

export const exampleRoute: FastifyPluginAsync = async (app) => {
  // GET /api/v1/items
  app.get('/items', async (_req, reply) => {
    return reply.send({ items: [] });
  });

  // POST /api/v1/items
  app.post('/items', async (req, reply) => {
    const parsed = CreateItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', issues: parsed.error.issues });
    }
    // TODO: persist to DB
    return reply.status(201).send({ id: crypto.randomUUID(), ...parsed.data });
  });
};
`,
      'src/config/env.ts': `// Zod-parsed environment config.
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT:     z.coerce.number().default(3000),
  DATABASE_URL: z.string().url().optional(),
});

export const env = EnvSchema.parse(process.env);
`,
      'src/routes/example.test.ts': `// Unit tests for example route.
import { describe, it, expect } from 'vitest';

describe('example route', () => {
  it('placeholder — wire Fastify test harness', () => {
    expect(true).toBe(true);
  });
});
`,
    };
  },

  defaultVerificationMatrix: [
    'lint', 'typecheck', 'build', 'unit', 'integration', 'secretScan', 'depVuln',
  ],

  defaultApprovalPolicy: {
    alwaysApprove: ['deploy.production', 'migration.apply.production'],
  },

  screens: ['code', 'files', 'console', 'tests', 'database', 'jobs'],
};
