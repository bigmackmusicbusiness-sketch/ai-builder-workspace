// apps/api/tests/unit/tools-arg-recovery.test.ts
//
// Locks in the tool-arg recovery hardening shipped in be1101e + 192bb5d.
//
// Background: the IDE was breaking with "could not find path in args" during
// team testing on 2026-05-09. Root cause was a recovery loop in tools.ts that
// did literal `args[k]` lookup against a case-sensitive alias list — its
// comment claimed case-insensitive but the implementation wasn't. Fix wired
// up findArgString / findArgStringAllowEmpty helpers with case- AND
// separator-insensitive matching, plus BFS depth-2 wrapper unwrap and
// top-level array detection.
//
// These tests exercise the recovery via the public executeToolCall API, not
// the internal helpers — that way a future refactor that swaps the
// implementation can't silently regress behavior. We use read_file as the
// primary surface because it has the same recovery path as write_file but
// none of the gates (planning-doc gate, credential scan, env-file refusal)
// — keeping test setup simple. write_file gets a few smoke tests on
// non-gated paths.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
vi.hoisted(() => {
  process.env.SUPABASE_URL              ??= 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY         ??= 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
  process.env.SUPABASE_JWT_SECRET       ??= 'test-jwt-secret';
  process.env.VAULT_MASTER_KEY          ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  // Disable the OpenAI repair fallback so failures end at the heroic
  // recovery layer where we want to test, not after a network hop.
  process.env.OPENAI_REPAIR_ENABLED   = '0';
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeToolCall, type ToolContext } from '../../src/agent/tools';
import type { WorkspaceHandle } from '../../src/preview/workspace';

let tempDir: string;
let ctx: ToolContext;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'abw-tools-recovery-'));
  // A representative HTML fixture for read_file tests.
  await writeFile(join(tempDir, 'index.html'), '<!DOCTYPE html><html><body>hi</body></html>', 'utf8');
  await writeFile(join(tempDir, 'about.html'),  '<!DOCTYPE html><html><body>about</body></html>', 'utf8');
  await mkdir(join(tempDir, 'css'), { recursive: true });
  await writeFile(join(tempDir, 'css', 'site.css'), 'body{font-family:serif}', 'utf8');

  const ws: WorkspaceHandle = {
    tenantId:    'test-tenant',
    projectSlug: 'tools-recovery-fixture',
    rootDir:     tempDir,
  } as unknown as WorkspaceHandle;
  ctx = { ws };
});

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

// ── read_file: argument-shape resilience ──────────────────────────────────

describe('executeToolCall(read_file) recovers across model arg drift', () => {
  it('canonical schema: { path: "..." }', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ path: 'index.html' }));
    expect(r.ok).toBe(true);
    expect(r.result).toContain('<body>hi</body>');
  });

  it('alias key: filename', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ filename: 'index.html' }));
    expect(r.ok).toBe(true);
  });

  it('alias key (camelCase): filePath', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ filePath: 'index.html' }));
    expect(r.ok).toBe(true);
  });

  it('case drift: Path (capitalized) — round 1 bug surface', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ Path: 'index.html' }));
    expect(r.ok).toBe(true);
  });

  it('case drift: PATH (uppercase)', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ PATH: 'index.html' }));
    expect(r.ok).toBe(true);
  });

  it('separator drift: file_path (snake_case)', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ file_path: 'index.html' }));
    expect(r.ok).toBe(true);
  });

  it('separator drift: file-path (kebab-case)', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ 'file-path': 'index.html' }));
    expect(r.ok).toBe(true);
  });

  it('case + separator drift: File_Path (mixed)', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ File_Path: 'index.html' }));
    expect(r.ok).toBe(true);
  });

  it('alias drift: filepath (all lowercase) — caught by separator-insensitive match', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ filepath: 'index.html' }));
    expect(r.ok).toBe(true);
  });

  it('uncommon alias: pathname', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ pathname: 'index.html' }));
    expect(r.ok).toBe(true);
  });

  it('uncommon alias: target', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ target: 'index.html' }));
    expect(r.ok).toBe(true);
  });

  it('one-level wrapper: { args: { path: "..." } } — round 2 bug surface', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ args: { path: 'index.html' } }));
    expect(r.ok).toBe(true);
  });

  it('one-level wrapper with alias inside: { input: { filepath: "..." } }', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ input: { filepath: 'index.html' } }));
    expect(r.ok).toBe(true);
  });

  it('one-level wrapper: { parameters: { Path: "..." } }', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ parameters: { Path: 'index.html' } }));
    expect(r.ok).toBe(true);
  });

  it('top-level array: [{ path: "..." }] — round 2 bug surface', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify([{ path: 'index.html' }]));
    expect(r.ok).toBe(true);
  });

  it('returns structured error on truly empty args', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({}));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('no path in args');
    expect(r.result).toContain('Top-level keys received: [(empty)]');
  });

  it('returns structured error when args object lacks recognizable path field', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ unknown_key: 'x', other: 1 }));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('no path in args');
    expect(r.result).toContain('unknown_key');  // surfaces what was received
  });

  it('returns "file not found" (not parsing failure) when path resolves correctly but file is missing', async () => {
    const r = await executeToolCall(ctx, 'read_file', JSON.stringify({ path: 'does-not-exist.html' }));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('not found');
  });
});

// ── delete_file: same recovery surface, no destructive risk ─────────────────

describe('executeToolCall(delete_file) routes through the same recovery', () => {
  it('returns structured error on empty args (does not throw)', async () => {
    const r = await executeToolCall(ctx, 'delete_file', JSON.stringify({}));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('no path in args');
  });

  it('accepts case + separator drift', async () => {
    // Set up a file we can safely delete + re-create.
    await writeFile(join(tempDir, '_to-delete.html'), '<html></html>', 'utf8');
    const r = await executeToolCall(ctx, 'delete_file', JSON.stringify({ File_Path: '_to-delete.html' }));
    expect(r.ok).toBe(true);
  });

  it('accepts wrapper unwrap', async () => {
    await writeFile(join(tempDir, '_to-delete-2.html'), '<html></html>', 'utf8');
    const r = await executeToolCall(ctx, 'delete_file', JSON.stringify({ tool_input: { filename: '_to-delete-2.html' } }));
    expect(r.ok).toBe(true);
  });
});

// ── write_file smoke tests on non-gated paths (planning-doc gate doesn't fire) ──

describe('executeToolCall(write_file) recovers across drift on non-gated paths', () => {
  // Use a CSS path so the planning-doc gate (only fires for spec.md / readme.md / plan.md / todo.md / roadmap.md / notes.md) doesn't trigger.
  const CSS_CONTENT = 'body{margin:0}';

  it('canonical schema: { path, content }', async () => {
    const r = await executeToolCall(ctx, 'write_file', JSON.stringify({ path: 'styles-canonical.css', content: CSS_CONTENT }));
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('styles-canonical.css');
  });

  it('case + separator drift: { File_Path, file_content }', async () => {
    const r = await executeToolCall(ctx, 'write_file', JSON.stringify({ File_Path: 'styles-drift.css', file_content: CSS_CONTENT }));
    expect(r.ok).toBe(true);
  });

  it('one-level wrapper: { args: { path, content } }', async () => {
    const r = await executeToolCall(ctx, 'write_file', JSON.stringify({ args: { path: 'styles-wrapped.css', content: CSS_CONTENT } }));
    expect(r.ok).toBe(true);
  });

  it('mode 4 (key-IS-filename): { "styles-keymode.css": "..." }', async () => {
    const r = await executeToolCall(ctx, 'write_file', JSON.stringify({ 'styles-keymode.css': CSS_CONTENT }));
    expect(r.ok).toBe(true);
  });

  it('top-level array: [{ path, content }]', async () => {
    const r = await executeToolCall(ctx, 'write_file', JSON.stringify([{ path: 'styles-array.css', content: CSS_CONTENT }]));
    expect(r.ok).toBe(true);
  });

  it('returns structured retry instruction when path missing AND content missing', async () => {
    const r = await executeToolCall(ctx, 'write_file', JSON.stringify({}));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('could not find a path');
    // Error must be actionable: tells the model what shape to retry with.
    expect(r.result).toContain('"path"');
    expect(r.result).toContain('"content"');
  });
});

// ── Argument JSON edge cases ────────────────────────────────────────────────

describe('executeToolCall handles malformed argsJson gracefully', () => {
  it('empty argsJson string → behaves like empty object (structured "no path" error)', async () => {
    const r = await executeToolCall(ctx, 'read_file', '');
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('no path in args');
  });

  it('whitespace-only argsJson → behaves like empty object', async () => {
    const r = await executeToolCall(ctx, 'read_file', '   \n  ');
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('no path in args');
  });

  it('unparseable argsJson with recognizable quoted path → returns "Invalid tool arguments" with hint', async () => {
    // Missing closing brace; the best-effort regex pulls "index.html" out
    // of the malformed payload via /"path"\s*:\s*"([^"]+)"/ so the model
    // has a chance to retry sanely.
    const r = await executeToolCall(ctx, 'read_file', '{"path": "index.html"');
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('Invalid tool arguments');
    expect(r.summary).toContain('index.html');
  });

  it('unparseable argsJson without recognizable path → returns generic "Invalid tool arguments"', async () => {
    // No quoted "path"/"filename" key for the regex to grab — should still
    // return a structured error, just without a path hint in the summary.
    const r = await executeToolCall(ctx, 'read_file', 'not-json-at-all');
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('Invalid tool arguments');
  });
});
