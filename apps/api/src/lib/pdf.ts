// apps/api/src/lib/pdf.ts — HTML → PDF rendering via headless Chromium.
// Works on Railway/Linux containers using @sparticuz/chromium (~45 MB bundled binary).
// Always closes the browser in finally — no pool, because hijacked SSE streams
// can be cancelled mid-render and a leaked browser would pile up.
//
// Cold start: 2–4s. Mitigated by SSE progress events upstream.

// Types declared locally so the module still typechecks when puppeteer isn't installed yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Browser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page    = any;

export interface PdfOptions {
  html:       string;
  format?:    'A4' | 'Letter' | '6x9' | '8.5x8.5' | '7x10' | '8.5x11';
  margin?:    { top?: string; right?: string; bottom?: string; left?: string };
  printBackground?: boolean;
  /** Landscape orientation (e.g. pitch decks). */
  landscape?: boolean;
  /** Enable CSS Paged Media running headers/footers. */
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
}

/** Map a custom trim key to width/height in inches for Puppeteer. */
function trimToSize(format: string | undefined): { width?: string; height?: string; format?: string } {
  switch (format) {
    case '6x9':     return { width: '6in',   height: '9in'   };
    case '8.5x8.5': return { width: '8.5in', height: '8.5in' };
    case '7x10':    return { width: '7in',   height: '10in'  };
    case '8.5x11':  return { width: '8.5in', height: '11in'  };
    case 'A4':      return { format: 'A4'      };
    case 'Letter':  return { format: 'Letter'  };
    default:        return { format: 'Letter'  };
  }
}

/**
 * Find a usable Chrome/Chromium executable across platforms.
 *
 * On Linux (Railway/prod): use @sparticuz/chromium's bundled binary (~45 MB).
 * On Windows/macOS (local dev): @sparticuz ships a Linux ELF that can't run, so
 * fall back to the user's installed Chrome / Chrome Canary / Edge.
 *
 * If `PUPPETEER_EXECUTABLE_PATH` is set in the environment, it always wins —
 * lets you pin a specific browser without code changes.
 */
async function findExecutable(): Promise<string> {
  const override = process.env['PUPPETEER_EXECUTABLE_PATH'];
  if (override) return override;

  if (process.platform === 'linux') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — external for esbuild; resolved at runtime
    const chromium = (await import('@sparticuz/chromium')).default;
    return chromium.executablePath();
  }

  const fs = await import('node:fs');
  const candidates: string[] = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        `${process.env['LOCALAPPDATA'] ?? ''}/Google/Chrome/Application/chrome.exe`,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      ]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(
    'No Chrome/Chromium executable found. Install Google Chrome, or set PUPPETEER_EXECUTABLE_PATH.',
  );
}

async function launch(): Promise<Browser> {
  // Dynamic import so the module still loads (for tests/typecheck) when the
  // heavy native deps are not yet installed.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const puppeteer = await import('puppeteer-core'); // eslint-disable-line @typescript-eslint/no-explicit-any

  // Pull @sparticuz args only on Linux. On dev OSes we use sensible defaults.
  let chromiumArgs: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let defaultViewport: any = { width: 1280, height: 720 };
  if (process.platform === 'linux') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const chromium = (await import('@sparticuz/chromium')).default; // eslint-disable-line @typescript-eslint/no-explicit-any
    chromiumArgs    = chromium.args;
    defaultViewport = chromium.defaultViewport;
  }

  const executablePath = await findExecutable();

  return puppeteer.launch({
    args: [
      ...chromiumArgs,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--font-render-hinting=none',
    ],
    defaultViewport,
    executablePath,
    headless: true,
  });
}

/** Render HTML to a PDF Buffer. */
export async function renderHtmlToPdf(opts: PdfOptions): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    browser = await launch();
    const page: Page = await browser.newPage();

    // Block external resources we don't need (keep images + fonts + stylesheets).
    await page.setRequestInterception(true);
    page.on('request', (req: { resourceType: () => string; abort: () => void; continue: () => void }) => {
      const rt = req.resourceType();
      if (rt === 'media' || rt === 'websocket' || rt === 'eventsource') return req.abort();
      return req.continue();
    });

    await page.setContent(opts.html, { waitUntil: 'networkidle0', timeout: 30_000 });

    const sz = trimToSize(opts.format);
    const pdfOpts: Record<string, unknown> = {
      printBackground: opts.printBackground ?? true,
      margin: opts.margin ?? { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' },
      landscape: !!opts.landscape,
      displayHeaderFooter: !!opts.displayHeaderFooter,
    };
    if (sz.format) pdfOpts['format'] = sz.format;
    if (sz.width)  pdfOpts['width']  = sz.width;
    if (sz.height) pdfOpts['height'] = sz.height;
    if (opts.headerTemplate) pdfOpts['headerTemplate'] = opts.headerTemplate;
    if (opts.footerTemplate) pdfOpts['footerTemplate'] = opts.footerTemplate;

    const pdfUint8: Uint8Array = await page.pdf(pdfOpts);
    return Buffer.from(pdfUint8);
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}
