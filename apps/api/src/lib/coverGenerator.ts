// apps/api/src/lib/coverGenerator.ts — AI cover generation pipeline.
// MiniMax image-01 → 3 background variants → typography overlay via Puppeteer → cover PDF/PNG.

import type { ProviderAdapter } from '@abw/providers';
import { renderHtmlToPdf } from './pdf';

export interface CoverSpec {
  title:     string;
  subtitle?: string;
  author:    string;
  genre?:    string;
  tone?:     string;
  userGuidance?: string;  // free-form hint from the user
}

/** Build the prompt for MiniMax image-01 to generate a cover background. */
function coverPrompt(spec: CoverSpec): string {
  const bits = [
    `Book cover art for "${spec.title}"`,
    spec.genre ? `in the ${spec.genre.replace('_', ' ')} genre` : '',
    spec.tone ? `with a ${spec.tone} mood` : '',
    'vertical portrait orientation, 2:3 aspect ratio',
    'cinematic lighting, high contrast, rich color',
    'no text, no typography, no letters — artwork only',
    spec.userGuidance ?? '',
  ].filter(Boolean);
  return bits.join('. ');
}

/** Render the title/author typography as an HTML overlay on the generated cover image. */
function overlayHtml(spec: CoverSpec, imageDataUri: string): string {
  return `<!doctype html>
<html>
<head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=EB+Garamond:wght@400;600&family=Oswald:wght@400;600&family=Playfair+Display:wght@400;700&display=swap');
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
  .cover {
    width: 1600px;
    height: 2560px;
    background-image: url('${imageDataUri}');
    background-size: cover;
    background-position: center;
    position: relative;
    font-family: 'Playfair Display', serif;
    color: #fff;
    text-shadow: 0 4px 20px rgba(0,0,0,0.85);
  }
  .gradient {
    position: absolute; inset: 0;
    background: linear-gradient(to bottom,
      rgba(0,0,0,0.55) 0%,
      rgba(0,0,0,0.1) 40%,
      rgba(0,0,0,0.1) 60%,
      rgba(0,0,0,0.75) 100%);
  }
  .title {
    position: absolute; top: 12%; left: 8%; right: 8%;
    font-size: 140px; font-weight: 700; line-height: 1.05;
    letter-spacing: -0.01em; text-align: center;
  }
  .subtitle {
    position: absolute; top: 36%; left: 12%; right: 12%;
    font-size: 48px; font-style: italic; text-align: center; opacity: 0.95;
  }
  .author {
    position: absolute; bottom: 7%; left: 0; right: 0;
    font-size: 64px; text-align: center; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase;
  }
</style>
</head>
<body>
<div class="cover">
  <div class="gradient"></div>
  <div class="title">${escapeHtml(spec.title)}</div>
  ${spec.subtitle ? `<div class="subtitle">${escapeHtml(spec.subtitle)}</div>` : ''}
  <div class="author">${escapeHtml(spec.author)}</div>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

/**
 * Generate N cover variants: image-01 background + Puppeteer typography overlay.
 * Returns an array of final cover PNG/PDF buffers (one per variant).
 */
export async function generateCoverVariants(
  adapter: ProviderAdapter,
  spec:    CoverSpec,
  count:   number = 3,
  signal?: AbortSignal,
): Promise<{ imageBuf: Buffer; overlaidPdf: Buffer }[]> {
  if (!adapter.generateImage) {
    throw new Error('Current provider does not support image generation');
  }

  const prompt = coverPrompt(spec);
  const results: { imageBuf: Buffer; overlaidPdf: Buffer }[] = [];

  for (let i = 0; i < count; i++) {
    const { buffer, ext } = await adapter.generateImage({
      prompt: `${prompt} (variant ${i + 1})`,
      size:   '1024x1536',
      ...(signal ? { signal } : {}),
    });

    // Embed as data URI so Puppeteer doesn't need network access
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;

    const overlaidPdf = await renderHtmlToPdf({
      html:  overlayHtml(spec, dataUri),
      format: '6x9',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
    });

    results.push({ imageBuf: buffer, overlaidPdf });
  }

  return results;
}
