// apps/api/src/agent/tools/shell.exec.ts — sandboxed shell command execution.
// Restricted to an allowlist of safe commands. Never has access to vault env vars.
// Allowed roles: builder, runtime, fixer.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { z } from 'zod';
import { ShellExecInput, ShellExecOutput } from '@abw/agent-core';

export type ShellExecInputType  = z.infer<typeof ShellExecInput>;
export type ShellExecOutputType = z.infer<typeof ShellExecOutput>;

// Commands the agent may execute. Anything not in this list is rejected.
const ALLOWED_COMMANDS = new Set([
  'pnpm', 'npm', 'npx', 'node', 'tsc', 'eslint', 'prettier',
  'vite', 'vitest', 'playwright', 'drizzle-kit',
  'echo', 'cat', 'ls', 'pwd', 'mkdir', 'cp', 'mv', 'rm',
  'curl', 'wget', 'git',
]);

// Environment variables that must never be forwarded to agent subprocesses
const BLOCKED_ENV_KEYS = new Set([
  'VAULT_MASTER_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CF_API_TOKEN',
  'UPSTASH_QSTASH_TOKEN', 'UPSTASH_REDIS_REST_TOKEN',
  'MINIMAX_API_KEY', 'DATABASE_URL',
]);

export async function shellExec(
  input: ShellExecInputType,
  ctx: { projectRoot: string },
): Promise<ShellExecOutputType> {
  if (!ALLOWED_COMMANDS.has(input.command)) {
    throw Object.assign(
      new Error(`shell.exec: command '${input.command}' is not in the allowlist`),
      { code: 'COMMAND_NOT_ALLOWED' },
    );
  }

  // Resolve working directory safely
  const cwd = resolve(ctx.projectRoot, input.cwd);
  if (!cwd.startsWith(resolve(ctx.projectRoot))) {
    throw new Error(`shell.exec: cwd path traversal blocked: ${input.cwd}`);
  }

  // Build safe env — start from a clean env (no inherited vars) plus safe subset
  const safeEnv: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    NODE_ENV: 'development',
  };
  for (const [k, v] of Object.entries(input.env)) {
    if (!BLOCKED_ENV_KEYS.has(k)) safeEnv[k] = v;
  }

  const start = Date.now();

  return new Promise<ShellExecOutputType>((resolve, reject) => {
    const proc = spawn(input.command, input.args, {
      cwd,
      env: safeEnv,
      shell: false,  // never shell=true — avoids injection
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`shell.exec: command timed out after ${input.timeoutMs}ms`));
    }, input.timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      resolve({ stdout, stderr, exitCode: code ?? 1, durationMs });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
