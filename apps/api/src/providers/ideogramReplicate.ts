// apps/api/src/providers/ideogramReplicate.ts — Replicate-hosted Ideogram v2 inpaint.
//
// One job: take an image + a binary mask + a replacement-text prompt, return
// a new image with the masked region rewritten as the new text. Used by the
// Ads Studio image editor's "AI edit text" button.
//
// Cost: ~$0.08 per call at 1024×1024 (Replicate pricing as of 2026-05).
// The chat-side toggle (runStore.aiEditEnabled) gates whether the SPA
// surfaces the button; this provider is only ever called when the toggle
// is on AND the user clicked.
//
// API surface:
//   aiEditText({ imageBuffer, maskBuffer, replacementText, replicateToken })
//     → { url: string }   // public URL of the inpainted image hosted by Replicate
//
// The caller is expected to download the URL into our Supabase Storage as
// a new asset (the existing assets-upload helper does this).
//
// Token: caller fetches via vaultGet({ name: 'REPLICATE_API_TOKEN', ... })
// and passes it in. Mirrors providers/replicate.ts (separateStems pattern).

interface ReplicateRunResponse {
  id:     string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: unknown;
  error?:  string;
}

const IDEOGRAM_INPAINT_MODEL = 'ideogram-ai/ideogram-v2';

export interface AiEditInput {
  /** PNG/JPEG bytes of the source image. */
  imageBuffer:     Buffer;
  /** PNG bytes of a binary mask: WHITE pixels mark the region to rewrite,
   *  black pixels are preserved. Must be the same dimensions as imageBuffer. */
  maskBuffer:      Buffer;
  /** The literal text to replace the masked region with — Ideogram is told
   *  to render this exact string in a font that matches the surrounding
   *  visual style. Keep short (under ~30 chars) for best fidelity. */
  replacementText: string;
  /** Replicate API token, fetched from vault by the route handler. */
  replicateToken:  string;
}

export interface AiEditResult {
  /** Public URL of the inpainted image as hosted by Replicate. The caller
   *  is responsible for fetching + saving as an asset. */
  url:            string;
  /** Replicate prediction id (for traceback). */
  predictionId:   string;
}

/**
 * Run Ideogram v2 inpaint via Replicate. Polls the prediction endpoint
 * until completion (Replicate inpaints take ~5-15s typically). Throws on
 * failure; the route layer wraps this into a 502 response.
 */
export async function aiEditText(input: AiEditInput): Promise<AiEditResult> {
  const token = input.replicateToken;
  if (!token) throw new Error('REPLICATE_API_TOKEN not set in vault');

  // Replicate accepts data URIs for image+mask up to ~10 MB each; that's
  // well within our needs (1080×1920 PNGs are ~1-3 MB).
  const imageDataUri = `data:image/png;base64,${input.imageBuffer.toString('base64')}`;
  const maskDataUri  = `data:image/png;base64,${input.maskBuffer.toString('base64')}`;

  const prompt = `the text reads: "${input.replacementText.replace(/"/g, '\\"')}"`;

  // Step 1 — start prediction
  const startRes = await fetch('https://api.replicate.com/v1/predictions', {
    method:  'POST',
    headers: {
      'Authorization': `Token ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      version: IDEOGRAM_INPAINT_MODEL,
      input: {
        image:  imageDataUri,
        mask:   maskDataUri,
        prompt,
        magic_prompt_option: 'Off',  // we want the literal text, not creative interpretation
      },
    }),
  });
  if (!startRes.ok) {
    const detail = await startRes.text();
    throw new Error(`Replicate start failed (${startRes.status}): ${detail.slice(0, 200)}`);
  }
  const startBody = await startRes.json() as ReplicateRunResponse;

  // Step 2 — poll until done. Replicate has a streaming endpoint but the
  // poll-and-wait flow is simpler and the latency budget is fine for a
  // single ad-edit click.
  const deadline = Date.now() + 60_000;
  let prediction = startBody;
  while (Date.now() < deadline) {
    if (prediction.status === 'succeeded' || prediction.status === 'failed' || prediction.status === 'canceled') break;
    await sleep(1000);
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { 'Authorization': `Token ${token}` },
    });
    if (!pollRes.ok) throw new Error(`Replicate poll failed (${pollRes.status})`);
    prediction = await pollRes.json() as ReplicateRunResponse;
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(`Replicate inpaint ${prediction.status}: ${prediction.error ?? 'unknown error'}`);
  }

  // Output shape: usually a string URL or array of URLs depending on the model.
  const url = Array.isArray(prediction.output) ? String(prediction.output[0] ?? '') : String(prediction.output ?? '');
  if (!url) throw new Error('Replicate succeeded but returned no output URL');

  return { url, predictionId: prediction.id };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
