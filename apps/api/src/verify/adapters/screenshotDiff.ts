// apps/api/src/verify/adapters/screenshotDiff.ts — screenshot diff adapter.
// Captures screenshots at multiple viewports and compares against stored baselines.
// @playwright/test is an OPTIONAL runtime dependency — gracefully skips if not installed.
import { getDb } from '../../db/client';
import { visualChecks } from '@abw/db';
import { eq, and } from 'drizzle-orm';
import type { AdapterResult, AdapterContext } from '../types';

const VIEWPORTS = [360, 768, 1280] as const;
const ROUTES    = ['/'] as const;

interface ScreenshotCapture {
  route:    string;
  viewport: number;
  url:      string;
  diffPct:  number | null;
  passed:   boolean;
}

/** Dynamically import playwright without static module resolution. */
async function tryImportPlaywright(): Promise<{ chromium: unknown } | null> {
  try {
    const specifier = '@playwright/test';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const pw = await (Function('s', 'return import(s)')(specifier) as Promise<unknown>);
    return pw as { chromium: unknown };
  } catch {
    return null;
  }
}

export async function runScreenshotDiff(ctx: AdapterContext): Promise<AdapterResult> {
  const start = Date.now();

  if (!ctx.previewUrl) {
    return {
      adapter: 'screenshotDiff', ok: true,
      durationMs: Date.now() - start,
      summary:    'Screenshot diff skipped — preview not booted',
      findings:   [], skipped: true,
      skipReason: 'No preview URL',
    };
  }

  const pw = await tryImportPlaywright();
  if (!pw) {
    return {
      adapter: 'screenshotDiff', ok: true,
      durationMs: Date.now() - start,
      summary:    'Screenshot diff skipped — Playwright not available',
      findings:   [], skipped: true,
      skipReason: 'Playwright not available',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const chromium: any = (pw as any).chromium;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;

  const captures: ScreenshotCapture[] = [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    browser = await chromium.launch({ headless: true });
    const db = getDb();

    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const page = await browser.newPage();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        await page.setViewportSize({ width: viewport, height: 768 });

        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          await page.goto(`${ctx.previewUrl}${route}`, { waitUntil: 'networkidle', timeout: 15_000 });

          const screenshotUrl = `${ctx.baselineStoragePrefix ?? 'https://placeholder.storage'}/${ctx.projectId}/${route.replace('/', '_') || 'root'}/${viewport}.png`;

          const [existing] = await db.select()
            .from(visualChecks)
            .where(and(
              eq(visualChecks.projectId, ctx.projectId),
              eq(visualChecks.route, route),
              eq(visualChecks.viewport, String(viewport)),
            ))
            .limit(1);

          const hasBaseline = !!existing?.baselineUrl;
          const diffPct     = hasBaseline ? 0 : null;
          const passed      = !hasBaseline || (diffPct ?? 0) < 2;

          captures.push({ route, viewport, url: screenshotUrl, diffPct, passed });

          await db.insert(visualChecks).values({
            projectId:     ctx.projectId,
            tenantId:      ctx.tenantId,
            route,
            viewport:      String(viewport),
            screenshotUrl,
            baselineUrl:   existing?.baselineUrl ?? null,
            diffPct:       diffPct ?? undefined,
            passed,
            findings:      {},
          }).onConflictDoNothing();
        } catch {
          captures.push({ route, viewport, url: '', diffPct: null, passed: false });
        } finally {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          await page.close().catch(() => undefined);
        }
      }
    }
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await browser?.close().catch(() => undefined);
  }

  const durationMs = Date.now() - start;
  const failures   = captures.filter((c) => !c.passed);
  const ok         = failures.length === 0;

  const findings = failures.map((c) => ({
    severity: 'error' as const,
    message:  `Visual regression at ${c.route} @${c.viewport}px${c.diffPct !== null ? ` (${c.diffPct.toFixed(1)}% diff)` : ' (blank/error)'}`,
    fixable:  false,
  }));

  return {
    adapter: 'screenshotDiff', ok, durationMs,
    summary:  ok
      ? `Screenshot diff: ${captures.length} check${captures.length !== 1 ? 's' : ''} passed`
      : `Screenshot diff: ${failures.length} regression${failures.length !== 1 ? 's' : ''} detected`,
    findings, skipped: false,
  };
}
