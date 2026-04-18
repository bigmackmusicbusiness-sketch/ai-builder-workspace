// apps/api/src/verify/pipeline.ts — verification matrix orchestrator.
// Runs the selected set of adapters for a project and returns structured results.
// Adapters run sequentially so logs stay readable; parallelise if needed later.

import { runLint }               from './adapters/lint';
import { runTypecheck }          from './adapters/typecheck';
import { runBuild }              from './adapters/build';
import { runUnit }               from './adapters/unit';
import { runIntegration }        from './adapters/integration';
import { runE2e }                from './adapters/e2e';
import { runSecretScan }         from './adapters/secretScan';
import { runDepVuln }            from './adapters/depVuln';
import { runMigrationSmoke }     from './adapters/migrationSmoke';
import { runPlaywrightRuntime }  from './adapters/playwrightRuntime';
import { runScreenshotDiff }     from './adapters/screenshotDiff';

import type { AdapterName, AdapterContext, AdapterResult, VerifyPipelineResult } from './types';

// ── Runner registry ───────────────────────────────────────────────────────────

const ADAPTER_RUNNERS: Record<AdapterName, (ctx: AdapterContext) => Promise<AdapterResult> | AdapterResult> = {
  lint:               runLint,
  typecheck:          runTypecheck,
  build:              runBuild,
  unit:               runUnit,
  integration:        runIntegration,
  e2e:                runE2e,
  secretScan:         runSecretScan,
  depVuln:            runDepVuln,
  migrationSmoke:     runMigrationSmoke,
  playwrightRuntime:  runPlaywrightRuntime,
  screenshotDiff:     runScreenshotDiff,
};

// ── Default adapter sets per task type ────────────────────────────────────────

export const DEFAULT_ADAPTERS: AdapterName[] = [
  'lint', 'typecheck', 'build', 'unit', 'secretScan',
];

export const FULL_ADAPTERS: AdapterName[] = [
  'lint', 'typecheck', 'build', 'unit', 'integration',
  'e2e', 'secretScan', 'depVuln', 'migrationSmoke',
  'playwrightRuntime', 'screenshotDiff',
];

// ── Pipeline runner ───────────────────────────────────────────────────────────

export interface RunPipelineOptions {
  adapters:    AdapterName[];
  projectId:   string;
  tenantId:    string;
  projectRoot: string;
  previewUrl?: string;
  baselineStoragePrefix?: string;
  /** Called after each adapter completes */
  onResult?:   (result: AdapterResult) => void;
}

export async function runPipeline(opts: RunPipelineOptions): Promise<VerifyPipelineResult> {
  const ctx: AdapterContext = {
    projectId:             opts.projectId,
    tenantId:              opts.tenantId,
    projectRoot:           opts.projectRoot,
    previewUrl:            opts.previewUrl,
    baselineStoragePrefix: opts.baselineStoragePrefix,
  };

  const results: AdapterResult[] = [];
  const totalStart = Date.now();

  for (const adapterName of opts.adapters) {
    const runner = ADAPTER_RUNNERS[adapterName];
    if (!runner) {
      const skipped: AdapterResult = {
        adapter:    adapterName,
        ok:         true,
        durationMs: 0,
        summary:    `Unknown adapter: ${adapterName}`,
        findings:   [],
        skipped:    true,
        skipReason: 'No runner registered',
      };
      results.push(skipped);
      opts.onResult?.(skipped);
      continue;
    }

    let result: AdapterResult;
    try {
      result = await Promise.resolve(runner(ctx));
    } catch (err: unknown) {
      result = {
        adapter:    adapterName,
        ok:         false,
        durationMs: 0,
        summary:    `Adapter threw: ${err instanceof Error ? err.message : String(err)}`,
        findings:   [],
        skipped:    false,
      };
    }

    results.push(result);
    opts.onResult?.(result);
  }

  const allGreen = results.every((r) => r.ok || r.skipped);
  const totalMs  = Date.now() - totalStart;

  return { results, allGreen, totalMs };
}

// ── Convenience re-export of types ───────────────────────────────────────────

export type { AdapterResult, AdapterContext, VerifyPipelineResult, AdapterName };
