#!/usr/bin/env node
/**
 * Lightweight secret scanner used by CI and the verification matrix.
 * Pure Node, no deps. The full `packages/security/patterns` list is the
 * authoritative source at runtime; this file mirrors the most common ones
 * so the repo itself is always scanned before anything else ships.
 *
 * Fails (exit 1) on any match outside of ignored paths / example files.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  '.next',
  'dist',
  'build',
  'coverage',
  '.wrangler',
  'playwright-report',
  'test-results',
]);

const IGNORE_FILE_SUFFIXES = [
  '.example',
  '.md', // docs reference patterns but should not hold real secrets
];

const IGNORE_BASENAMES = new Set([
  '.env.example',
  '.env.local.example',
  'secret-scan.mjs',
  'patterns.ts',
  'redact.ts',
  'vault.ts',
  'HANDOFF.md',
  'HANDOFF_NOTES.md',
  'README.md',
]);

// Keep these patterns conservative. False positives block CI.
const PATTERNS = [
  { id: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'aws_secret',     re: /\baws_secret_access_key\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/i },
  { id: 'gh_pat',         re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { id: 'gh_oauth',       re: /\bgho_[A-Za-z0-9]{36}\b/ },
  { id: 'gh_fine',        re: /\bgithub_pat_[A-Za-z0-9_]{82}\b/ },
  { id: 'openai_key',     re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { id: 'anthropic_key',  re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/ },
  { id: 'slack_token',    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google_api',     re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { id: 'stripe_live',    re: /\bsk_live_[A-Za-z0-9]{24,}\b/ },
  { id: 'jwt_like',       re: /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/ },
  { id: 'private_key',    re: /-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----/ },
  { id: 'pg_conn_inline', re: /\bpostgres(?:ql)?:\/\/[^\s'"]*:[^\s'"@]+@[^\s'"]+/ },
];

function shouldSkipDir(name) {
  return IGNORE_DIRS.has(name) || name.startsWith('.');
}

function shouldSkipFile(path) {
  const base = path.split(sep).pop() || '';
  if (IGNORE_BASENAMES.has(base)) return true;
  for (const suf of IGNORE_FILE_SUFFIXES) if (base.endsWith(suf)) return true;
  return false;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) {
      if (shouldSkipDir(entry)) continue;
      yield* walk(full);
    } else if (s.isFile()) {
      // Skip binary-ish files by extension.
      if (/\.(png|jpe?g|gif|webp|avif|pdf|ico|woff2?|ttf|otf|mp4|mov|zip|gz|br)$/i.test(entry)) continue;
      yield full;
    }
  }
}

let findings = 0;
for (const file of walk(ROOT)) {
  if (shouldSkipFile(file)) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const { id, re } of PATTERNS) {
    const m = text.match(re);
    if (m) {
      findings++;
      const line = text.slice(0, m.index ?? 0).split('\n').length;
      const rel = relative(ROOT, file);
      // Redact the match itself; never echo secrets to stdout.
      console.error(`secret-scan: ${id} match in ${rel}:${line}`);
    }
  }
}

if (findings > 0) {
  console.error(`\nsecret-scan: ${findings} finding(s). Fix or add to ignore list.`);
  process.exit(1);
} else {
  console.log('secret-scan: clean');
}
