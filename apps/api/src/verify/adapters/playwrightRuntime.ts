// apps/api/src/verify/adapters/playwrightRuntime.ts — Playwright runtime boot + console scrape.
// Boots Chromium headless, navigates to the preview URL, collects console errors.
// @playwright/test is an OPTIONAL runtime dependency — gracefully skips if not installed.
import type { AdapterResult, AdapterContext } from '../types';

interface ConsoleLine {
  type: string;
  text: string;
}

/** Dynamically import playwright without static module resolution. */
async function tryImportPlaywright(): Promise<{ chromium: unknown } | null> {
  try {
    // Use indirect dynamic import to avoid compile-time module resolution
    const specifier = '@playwright/test';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const pw = await (Function('s', 'return import(s)')(specifier) as Promise<unknown>);
    return pw as { chromium: unknown };
  } catch {
    return null;
  }
}

export async function runPlaywrightRuntime(ctx: AdapterContext): Promise<AdapterResult> {
  const start = Date.now();

  if (!ctx.previewUrl) {
    return {
      adapter: 'playwrightRuntime', ok: true,
      durationMs: Date.now() - start,
      summary:    'Playwright runtime skipped — preview not booted',
      findings:   [], skipped: true,
      skipReason: 'No preview URL',
    };
  }

  const pw = await tryImportPlaywright();
  if (!pw) {
    return {
      adapter: 'playwrightRuntime', ok: true,
      durationMs: Date.now() - start,
      summary:    'Playwright runtime skipped — @playwright/test not installed',
      findings:   [], skipped: true,
      skipReason: 'Playwright not available',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const chromium: any = (pw as any).chromium;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    browser = await chromium.launch({ headless: true });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    const page = await browser.newPage();
    const consoleLines: ConsoleLine[] = [];
    const networkFails: string[]      = [];
    let   blankScreen                 = false;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    page.on('console', (msg: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const m = msg as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      consoleLines.push({ type: String(m.type()), text: String(m.text()) });
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    page.on('requestfailed', (req: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const r = req as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      networkFails.push(`${String(r.method())} ${String(r.url())}: ${String(r.failure()?.errorText ?? 'unknown')}`);
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const response = await page.goto(ctx.previewUrl, {
      waitUntil: 'networkidle',
      timeout:   15_000,
    }).catch(() => null);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const bodyText: string = await page.evaluate(
      () => (document.body?.innerText?.trim() ?? ''),
    ).catch(() => '');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    if (!bodyText && (response as any)?.status() !== 204) {
      blankScreen = true;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const hasOverflow: boolean = await page.evaluate(() => {
      const vw = window.innerWidth;
      return Array.from(document.querySelectorAll('*')).some((el) => {
        const rect = el.getBoundingClientRect();
        return rect.right > vw + 5;
      });
    }).catch(() => false);

    const durationMs    = Date.now() - start;
    const consoleErrors = consoleLines.filter((l) => l.type === 'error');
    const ok            = consoleErrors.length === 0 && !blankScreen && networkFails.length === 0;

    const findings = [
      ...consoleErrors.map((l) => ({
        severity: 'error' as const,
        message:  `Console error: ${l.text.slice(0, 500)}`,
        fixable:  false,
      })),
      ...networkFails.slice(0, 5).map((msg) => ({
        severity: 'warning' as const,
        message:  `Network fail: ${msg}`,
        fixable:  false,
      })),
      ...(blankScreen ? [{ severity: 'error' as const, message: 'Blank screen detected at /', fixable: false }] : []),
      ...(hasOverflow ? [{ severity: 'warning' as const, message: 'Horizontal overflow detected at /', fixable: false }] : []),
    ];

    return {
      adapter: 'playwrightRuntime', ok, durationMs,
      summary:  ok
        ? `Runtime OK — page loaded at ${ctx.previewUrl}`
        : `Runtime issues: ${consoleErrors.length} console error${consoleErrors.length !== 1 ? 's' : ''}${blankScreen ? ', blank screen' : ''}`,
      findings, skipped: false,
    };
  } catch (err: unknown) {
    return {
      adapter: 'playwrightRuntime', ok: false,
      durationMs: Date.now() - start,
      summary:    `Playwright runtime error: ${err instanceof Error ? err.message : String(err)}`,
      findings: [], skipped: false,
    };
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await browser?.close().catch(() => undefined);
  }
}
