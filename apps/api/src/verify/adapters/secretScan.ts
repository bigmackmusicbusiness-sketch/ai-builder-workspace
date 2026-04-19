// apps/api/src/verify/adapters/secretScan.ts — secret scan adapter.
// Walks the project root file-by-file and runs patterns from packages/security.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { scanLines, IGNORE_PATHS } from '@abw/security';
import type { AdapterResult, AdapterContext } from '../types';

const MAX_FILE_BYTES = 1_024 * 1_024;  // skip files > 1 MB
const MAX_FILES      = 5_000;

function walk(dir: string, files: string[] = []): string[] {
  if (files.length >= MAX_FILES) return files;

  let entries: string[];
  try { entries = readdirSync(dir); } catch { return files; }

  for (const entry of entries) {
    if (files.length >= MAX_FILES) break;
    const full = path.join(dir, entry);
    if (IGNORE_PATHS.some((re) => re.test(full.replace(/\\/g, '/')))) continue;

    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      walk(full, files);
    } else if (stat.isFile() && stat.size <= MAX_FILE_BYTES) {
      files.push(full);
    }
  }

  return files;
}

export function runSecretScan(ctx: AdapterContext): AdapterResult {
  const start = Date.now();

  try {
    const allFiles = walk(ctx.projectRoot);
    const allFindings: ReturnType<typeof scanLines> = [];

    for (const filePath of allFiles) {
      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      const lines    = content.split('\n');
      const findings = scanLines(filePath, lines);
      allFindings.push(...findings);
    }

    const durationMs = Date.now() - start;
    const ok         = allFindings.length === 0;

    const adapterFindings = allFindings.map((f) => ({
      severity: 'error' as const,
      file:     path.relative(ctx.projectRoot, f.file),
      line:     f.line,
      message:  `${f.description} — matched: ${f.match}`,
      rule:     f.patternId,
      fixable:  false,
    }));

    return {
      adapter: 'secretScan', ok, durationMs,
      summary:  ok
        ? `Secret scan clean (${allFiles.length} files scanned)`
        : `Secret scan: ${allFindings.length} potential secret${allFindings.length !== 1 ? 's' : ''} found`,
      findings: adapterFindings,
      skipped:  false,
    };
  } catch (err: unknown) {
    return {
      adapter: 'secretScan', ok: false,
      durationMs: Date.now() - start,
      summary:    `Secret scan error: ${err instanceof Error ? err.message : String(err)}`,
      findings: [], skipped: false,
    };
  }
}
