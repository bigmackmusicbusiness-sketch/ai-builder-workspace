// apps/api/src/server.ts — Fastify bootstrap. Registers all route plugins.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env';
import { initDb }         from './db/client';
import { filesRoutes }    from './routes/files';
import { versionsRoutes } from './routes/versions';
import { previewRoutes }  from './routes/preview';
import { projectsRoutes } from './routes/projects';
import { secretsRoutes }  from './routes/secrets';
import { jobsRoutes }     from './routes/jobs';
import { webhooksRoutes } from './routes/webhooks';
import { dbRoutes }       from './routes/db';
import { runsRoutes }     from './routes/runs';
import { testsRoutes }      from './routes/tests';
import { approvalsRoutes }  from './routes/approvals';
import { chatRoutes }       from './routes/chat';

async function main(): Promise<void> {
  // Initialise DB before anything else so getDb() is ready for all route handlers.
  // This resolves the Supabase hostname to IPv4 (Railway cannot route IPv6 to Supabase).
  await initDb();

  const app = Fastify({ logger: { level: 'info' } });

  // ── CORS ────────────────────────────────────────────────────────────────────
  await app.register(cors, {
    // Allow the Vite dev server + Cloudflare Pages deployments
    origin: (origin, cb) => {
      const allowed = [
        /^http:\/\/localhost:\d+$/,
        /^https:\/\/.*\.pages\.dev$/,
        /^https:\/\/.*\.railway\.app$/,
      ];
      if (!origin || allowed.some(r => r.test(origin))) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  });

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get('/healthz', async () => ({ ok: true, service: 'api', ts: Date.now() }));

  // ── Routes ──────────────────────────────────────────────────────────────────
  await app.register(projectsRoutes);
  await app.register(secretsRoutes);
  await app.register(jobsRoutes);
  await app.register(webhooksRoutes);
  await app.register(dbRoutes);
  await app.register(runsRoutes);
  await app.register(filesRoutes);
  await app.register(versionsRoutes);
  await app.register(previewRoutes);
  await app.register(testsRoutes);
  await app.register(approvalsRoutes);
  await app.register(chatRoutes);

  // ── Start ───────────────────────────────────────────────────────────────────
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`api listening on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
