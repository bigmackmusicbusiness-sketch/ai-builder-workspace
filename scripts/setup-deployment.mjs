#!/usr/bin/env node
// scripts/setup-deployment.mjs — One-shot deployment setup script.
// Run after pasting credentials: node scripts/setup-deployment.mjs
// Reads from .env.deploy (gitignored) and writes all env files + deploys.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function run(cmd, opts = {}) {
  console.log(`\n▶  ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function readEnvFile(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

// ── Load credentials ──────────────────────────────────────────────────────────
const deployEnvPath = resolve(ROOT, '.env.deploy');
if (!existsSync(deployEnvPath)) {
  console.error(`
❌  Missing .env.deploy file.

Create it at the repo root with:

  SUPABASE_URL=https://xxxx.supabase.co
  SUPABASE_ANON_KEY=eyJ...
  SUPABASE_SERVICE_ROLE_KEY=eyJ...
  SUPABASE_JWT_SECRET=your-jwt-secret
  CF_ACCOUNT_ID=your-account-id
  CF_API_TOKEN=your-api-token
  RAILWAY_API_URL=https://your-app.up.railway.app

Then run this script again.
`);
  process.exit(1);
}

const creds = readEnvFile(deployEnvPath);
const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET', 'CF_ACCOUNT_ID', 'CF_API_TOKEN'];
const missing = required.filter(k => !creds[k]);
if (missing.length) {
  console.error(`❌  Missing required credentials: ${missing.join(', ')}`);
  process.exit(1);
}

// ── Generate vault master key ─────────────────────────────────────────────────
const VAULT_MASTER_KEY = randomBytes(32).toString('base64');
console.log('\n🔑  Generated VAULT_MASTER_KEY (save this somewhere safe — it encrypts all vault secrets):');
console.log(`    ${VAULT_MASTER_KEY}\n`);

const RAILWAY_URL = creds['RAILWAY_API_URL'] ?? 'http://localhost:3007';
const CF_PAGES_URL = ''; // filled in after deployment

// ── Write apps/api/.env ────────────────────────────────────────────────────────
const apiEnv = `# apps/api/.env — Server-side secrets. NEVER commit this file.
NODE_ENV=production
PORT=3007
HOST=0.0.0.0

SUPABASE_URL=${creds['SUPABASE_URL']}
SUPABASE_ANON_KEY=${creds['SUPABASE_ANON_KEY']}
SUPABASE_SERVICE_ROLE_KEY=${creds['SUPABASE_SERVICE_ROLE_KEY']}
SUPABASE_JWT_SECRET=${creds['SUPABASE_JWT_SECRET']}

VAULT_MASTER_KEY=${VAULT_MASTER_KEY}

CF_ACCOUNT_ID=${creds['CF_ACCOUNT_ID']}
CF_API_TOKEN=${creds['CF_API_TOKEN']}
CF_PAGES_PROJECT=abw-web

OLLAMA_BASE_URL=http://localhost:11434
PREVIEW_ROOT_DOMAIN=preview.local.test
`;
writeFileSync(resolve(ROOT, 'apps/api/.env'), apiEnv);
console.log('✅  Wrote apps/api/.env');

// ── Write apps/web/.env.local ─────────────────────────────────────────────────
const webEnv = `# apps/web/.env.local — Public browser env vars. Safe to commit structure, not values.
VITE_SUPABASE_URL=${creds['SUPABASE_URL']}
VITE_SUPABASE_ANON_KEY=${creds['SUPABASE_ANON_KEY']}
VITE_API_URL=${RAILWAY_URL}
`;
writeFileSync(resolve(ROOT, 'apps/web/.env.local'), webEnv);
console.log('✅  Wrote apps/web/.env.local');

// ── Install deps ──────────────────────────────────────────────────────────────
run('pnpm install --frozen-lockfile');

// ── Build API ─────────────────────────────────────────────────────────────────
run('pnpm --filter @abw/api build');

// ── Build web ─────────────────────────────────────────────────────────────────
run('pnpm --filter @abw/web build');

// ── Deploy worker to Cloudflare ───────────────────────────────────────────────
console.log('\n🚀  Deploying Cloudflare Worker (preview sandbox)...');
process.env['CF_ACCOUNT_ID'] = creds['CF_ACCOUNT_ID'];
process.env['CF_API_TOKEN'] = creds['CF_API_TOKEN'];
try {
  run('npx wrangler deploy', { cwd: resolve(ROOT, 'apps/worker') });
  console.log('✅  Worker deployed');
} catch {
  console.warn('⚠️   Worker deploy failed — check wrangler.toml and try: npx wrangler deploy in apps/worker');
}

// ── Deploy web to Cloudflare Pages ───────────────────────────────────────────
console.log('\n🚀  Deploying web to Cloudflare Pages...');
try {
  run(`npx wrangler pages deploy apps/web/dist --project-name=abw-web --commit-dirty=true`);
  console.log('✅  Web deployed to Cloudflare Pages');
  console.log('    → Visit https://dash.cloudflare.com to find your Pages URL');
} catch {
  console.warn('⚠️   Pages deploy failed — try: npx wrangler pages deploy apps/web/dist --project-name=abw-web');
}

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🎉  Deployment setup complete!                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  Next steps:                                                     ║
║                                                                  ║
║  1. Push Railway env vars (copy apps/api/.env contents into      ║
║     Railway dashboard → Variables tab for your service)          ║
║                                                                  ║
║  2. Find your Pages URL in Cloudflare dashboard and update        ║
║     RAILWAY CORS list if needed                                  ║
║                                                                  ║
║  3. Run Supabase migrations:                                      ║
║     npx supabase db push                                         ║
║                                                                  ║
║  4. VAULT_MASTER_KEY (save this NOW — printed above):            ║
║     → Add to Railway Variables as VAULT_MASTER_KEY               ║
╚══════════════════════════════════════════════════════════════════╝
`);
