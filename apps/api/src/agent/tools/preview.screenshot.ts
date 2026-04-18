// apps/api/src/agent/tools/preview.screenshot.ts — capture a screenshot via Playwright.
// Uploads to Supabase Storage; returns the public URL.
// Allowed roles: visual.
import type { z } from 'zod';
import { PreviewScreenshotInput, PreviewScreenshotOutput } from '@abw/agent-core';
import { getSession } from '../../preview/sessionManager';

export type PreviewScreenshotInputType  = z.infer<typeof PreviewScreenshotInput>;
export type PreviewScreenshotOutputType = z.infer<typeof PreviewScreenshotOutput>;

export async function previewScreenshot(
  input: PreviewScreenshotInputType,
): Promise<PreviewScreenshotOutputType> {
  const session = getSession(input.sessionId);
  if (!session) throw new Error(`preview.screenshot: session not found: ${input.sessionId}`);
  if (session.status !== 'booted') {
    throw new Error(`preview.screenshot: session is ${session.status}, expected 'booted'`);
  }

  // Step 10 wires the real Playwright capture + Supabase Storage upload.
  // Stub: return a placeholder URL with route + viewport encoded.
  const encoded = encodeURIComponent(`${input.route}@${input.viewport}`);
  const screenshotUrl = `https://placeholder.storage/screenshots/${input.sessionId}/${encoded}.png`;

  return {
    screenshotUrl,
    route:         input.route,
    viewport:      input.viewport,
    capturedAt:    new Date().toISOString(),
    consoleErrors: 0,
  };
}
