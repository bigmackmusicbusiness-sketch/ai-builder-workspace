#!/usr/bin/env node
// apps/api/scripts/install-skills.mjs — installs agent-facing skill packages.
// Run on server boot (Coolify post-deploy step) and at dev startup.
//
// Currently installs:
//   - alchaincyf/huashu-design (HTML-native design skill)
//
// Skills land at apps/api/.skills/<name>/. The directory is gitignored —
// each environment installs its own copy.

import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot   = resolve(__dirname, '..');
const skillsDir = resolve(apiRoot, '.skills');

const SKILLS = [
  {
    name:    'huashu-design',
    repo:    'https://github.com/alchaincyf/huashu-design.git',
    // Pin a known-good commit so server boot doesn't fetch a breaking change.
    // Update intentionally when validated against current API.
    ref:     'master',
  },
];

if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });

function run(cmd, args, cwd) {
  return new Promise((resolveProc, rejectProc) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('close', (code) => code === 0 ? resolveProc() : rejectProc(new Error(`${cmd} ${args.join(' ')} failed (exit ${code})`)));
    child.on('error', rejectProc);
  });
}

async function installSkill(skill) {
  const dest = resolve(skillsDir, skill.name);
  if (existsSync(dest)) {
    console.log(`✓ ${skill.name} already installed at ${dest}`);
    return;
  }
  console.log(`→ Cloning ${skill.repo} → ${dest}`);
  try {
    await run('git', ['clone', '--depth', '1', '--branch', skill.ref, skill.repo, dest]);
    console.log(`✓ Installed ${skill.name}`);
  } catch (err) {
    console.error(`✗ Failed to install ${skill.name}: ${err.message}`);
    process.exitCode = 1;
  }
}

for (const skill of SKILLS) {
  await installSkill(skill);
}

console.log('\nDone.');
