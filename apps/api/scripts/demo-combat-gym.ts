// apps/api/scripts/demo-combat-gym.ts — end-to-end real demo.
// Uses the user's stored Higgsfield OAuth tokens to:
//   1. List the actual tool catalogue
//   2. Generate ONE hero image (combat gym fighter)
//   3. Generate ONE short hero video
//   4. Render that video through our timeline pipeline → final MP4
//   5. Build a premium single-page combat gym website embedding the hero
// Outputs land in apps/api/.smoke-out/combat-gym-demo/.
//
// Run: node --import tsx --env-file=.env scripts/demo-combat-gym.ts
import postgres from 'postgres';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { initDb } from '../src/db/client';
import { openHiggsfield, categorizeHiggsfieldTools, isHiggsfieldConnected } from '../src/providers/higgsfield';
import { uploadBufferAsAsset } from '../src/lib/assetUpload';

const OUT_DIR = join(process.cwd(), '.smoke-out', 'combat-gym-demo');

interface MCPContent {
  type:     string;
  text?:    string;
  data?:    string;
  url?:     string;
  mimeType?: string;
}

async function extractMedia(raw: unknown, defaultMime: string): Promise<{ buffer: Buffer; mimeType: string; debugUrl?: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  if (r?.isError) return null;
  let url:    string | undefined;
  let buffer: Buffer | undefined;
  let mime = defaultMime;

  // Primary: structuredContent.generation.params.medias[] is where finished outputs land
  const medias = r?.structuredContent?.generation?.params?.medias;
  if (Array.isArray(medias)) {
    for (const m of medias) {
      if (typeof m === 'string' && /^https?:\/\//.test(m) && !url) url = m;
      if (m?.url && !url) url = m.url;
      if (m?.original_url && !url) url = m.original_url;
      if (m?.media_url && !url)    url = m.media_url;
    }
  }
  // Secondary: structuredContent.results[].url (older shape)
  for (const item of r?.structuredContent?.results ?? []) {
    if (item?.url && !url) url = item.url;
  }
  // 2. content[] embeds — image/audio/video/resource types or url-in-text
  for (const c of r?.content ?? []) {
    if (c.type === 'image' || c.type === 'audio' || c.type === 'video' || c.type === 'resource') {
      if (c.url)       url    = c.url;
      else if (c.data) buffer = Buffer.from(c.data, 'base64');
      if (c.mimeType)  mime   = c.mimeType;
    } else if (c.type === 'text' && c.text) {
      const m = c.text.match(/https?:\/\/[^\s)"']+\.(png|jpe?g|mp4|mov|webm|webp)/i);
      if (m && !url) url = m[0];
    }
  }
  if (!buffer && url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) return null;
    buffer = Buffer.from(await res.arrayBuffer());
    // Infer mime from URL extension if it wasn't on the structured payload
    const ext = url.match(/\.(png|jpe?g|mp4|mov|webm|webp)/i)?.[1]?.toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
    else if (ext === 'png') mime = 'image/png';
    else if (ext === 'webp') mime = 'image/webp';
    else if (ext === 'mp4') mime = 'video/mp4';
    else if (ext === 'mov') mime = 'video/quicktime';
    else if (ext === 'webm') mime = 'video/webm';
  }
  return buffer ? { buffer, mimeType: mime, debugUrl: url } : null;
}

/** Extract a job id from a generate_* submit response. */
function extractJobId(raw: unknown): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  // structuredContent.results[0].id is the canonical place
  const sid = r?.structuredContent?.results?.[0]?.id;
  if (typeof sid === 'string') return sid;
  // Fallback: parse from the text field (uuid-shaped)
  for (const c of r?.content ?? []) {
    if (c?.type === 'text' && c?.text) {
      const m = c.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      if (m) return m[0];
    }
  }
  return null;
}

/** Poll job_status for completion, return final result.
 *  - Arg name is `jobId` (per inputSchema; not `id`)
 *  - `sync: true` makes the SERVER poll internally for up to ~25s, so we only
 *    need a few outer iterations.
 *  - Server suggests `poll_after_seconds` for non-terminal states. */
async function pollJob(
  client:    { callTool: (n: string, a: Record<string, unknown>) => Promise<unknown> },
  jobId:     string,
  kind:      'image' | 'video',
  timeoutSec = 360,
): Promise<unknown> {
  const t0 = Date.now();
  let attempts = 0;
  let lastResp: unknown = null;
  while (Date.now() - t0 < timeoutSec * 1000) {
    attempts++;
    const r = await client.callTool('job_status', { jobId, sync: true });
    lastResp = r;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ra = r as any;
    if (ra?.isError) return r;
    // Status lives at structuredContent.generation.status
    const gen = ra?.structuredContent?.generation;
    const status = gen?.status;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const mediaCount = Array.isArray(gen?.params?.medias) ? gen.params.medias.length : 0;
    console.log(`    attempt ${attempts}: status=${status ?? '(unknown)'} medias=${mediaCount} after ${elapsed}s`);

    if (typeof status === 'string') {
      const s = status.toLowerCase();
      if (s === 'completed' || s === 'success' || s === 'finished' || s === 'done' || s === 'ok' || s === 'queued_completed') return r;
      if (s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled') return r;
    }
    // Some Higgsfield responses populate medias[] before status flips
    if (mediaCount > 0) return r;

    const wait = ra?.structuredContent?.poll_after_seconds ?? 4;
    await new Promise((res) => setTimeout(res, Math.min(wait * 1000, 6000)));
    if (attempts > 80) break;
  }
  console.log('    final response (truncated):', JSON.stringify(lastResp).slice(0, 600));
  throw new Error(`Job ${jobId} (${kind}) did not complete within ${timeoutSec}s`);
}

async function main(): Promise<void> {
  await initDb();
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  // Resolve the tenant id (the one that has Higgsfield connected)
  const sql = postgres(process.env['DATABASE_URL']!, { ssl: 'require', max: 1 });
  const t = await sql`
    SELECT tenant_id FROM secret_metadata
    WHERE name = 'HIGGSFIELD_OAUTH_TOKENS' AND env = 'dev'
    ORDER BY last_rotated_at DESC LIMIT 1
  `;
  await sql.end();
  const tenantId = t[0]?.tenant_id;
  if (!tenantId) throw new Error('No Higgsfield OAuth token found in vault');
  console.log('Tenant:', tenantId);

  if (!await isHiggsfieldConnected(tenantId, 'dev')) {
    throw new Error('Higgsfield not connected for tenant');
  }
  console.log('OAuth: ✓ connected');

  // ── 1. Discovery: tools + models ──────────────────────────────────────
  console.log('\n[1/5] Higgsfield discovery (tools + models)…');
  const c = await openHiggsfield(tenantId, 'dev');
  let tools: { name: string; description?: string; inputSchema?: unknown }[] = [];
  let imageModel: string | undefined;
  let videoModel: string | undefined;
  try {
    tools = await c.listTools();
    console.log(`  → ${tools.length} tools available`);
    await writeFile(join(OUT_DIR, 'higgsfield-tools.json'), JSON.stringify(tools, null, 2));

    // models_explore uses top-level args (NOT the { params: ... } wrapper that
    // generate_image / generate_video use). Two different schema styles
    // discovered empirically.
    console.log('  Calling models_explore action=list…');
    const modelsResp = await c.callTool('models_explore', { action: 'list', limit: 50 });
    await writeFile(join(OUT_DIR, 'higgsfield-models.json'), JSON.stringify(modelsResp, null, 2));

    // Real shape: { content: [{ type: 'text', text: '<JSON of { items: [...] }>' }] }
    // Each item has: { id, name, provider_name, description, output_type: 'image'|'video', ... }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const respAny = modelsResp as any;
    let models: Array<{ id: string; name?: string; output_type?: string; provider_name?: string; description?: string }> = [];
    for (const c of respAny?.content ?? []) {
      if (c?.type === 'text' && c?.text) {
        try {
          const parsed = JSON.parse(c.text);
          if (Array.isArray(parsed?.items)) models = parsed.items;
          else if (Array.isArray(parsed))   models = parsed;
        } catch { /* skip */ }
      }
    }
    console.log(`  → ${models.length} models discovered`);
    const imageModels = models.filter((m) => m.output_type === 'image');
    const videoModels = models.filter((m) => m.output_type === 'video');
    console.log(`  Image models: ${imageModels.map((m) => m.id).join(', ') || '(none)'}`);
    console.log(`  Video models: ${videoModels.map((m) => m.id).join(', ') || '(none)'}`);

    // Pick a model: prefer Flux for images (well-balanced speed + quality);
    // prefer minimax_hailuo for video (cheapest, fastest).
    const imagePref = ['flux_2', 'seedream_v5_lite', 'image_auto', 'nano_banana_flash'];
    const videoPref = ['minimax_hailuo', 'wan2_6', 'seedance_1_5', 'video_standard'];
    imageModel = imagePref.find((p) => imageModels.some((m) => m.id === p)) ?? imageModels[0]?.id;
    videoModel = videoPref.find((p) => videoModels.some((m) => m.id === p)) ?? videoModels[0]?.id;
    console.log(`  Picked image model: ${imageModel ?? '(none)'}`);
    console.log(`  Picked video model: ${videoModel ?? '(none)'}`);
  } finally {
    await c.close();
  }

  // ── 2. Hero image ─────────────────────────────────────────────────────
  // Higgsfield's MCP wraps tool args in { params: {...} } — discovered from
  // their MCP error response on the first attempt.
  console.log('\n[2/5] Generating hero image…');
  const cats = categorizeHiggsfieldTools(tools);
  const imageTool = cats.images[0];
  if (!imageTool) {
    console.log('  ⚠ No image tool available — skipping image gen');
  } else {
    console.log(`  Using tool: ${imageTool}`);
    const c2 = await openHiggsfield(tenantId, 'dev');
    try {
      const heroPrompt =
        'Cinematic photo of a Muay Thai fighter wrapping their hands in a smoky boxing gym, ' +
        'low-key dramatic lighting, golden hour rays through warehouse windows hitting a heavy bag, ' +
        'sharp focus on the fighter\'s wrapped knuckles, photorealistic, 35mm film, gritty texture, ' +
        'dark teal and amber colour palette, intense and powerful mood. No text. No logos.';
      console.log('  Prompt:', heroPrompt.slice(0, 100) + '…');
      if (!imageModel) {
        console.log('  ⚠ No image model resolved from models_explore — skipping');
        return;
      }
      const t0 = Date.now();
      const submitResp = await c2.callTool(imageTool, {
        params: { model: imageModel, prompt: heroPrompt, aspect_ratio: '16:9', count: 1 },
      });
      const jobId = extractJobId(submitResp);
      if (!jobId) {
        console.log('  ✗ No job id in submit response. Raw:', JSON.stringify(submitResp).slice(0, 400));
        return;
      }
      console.log(`  Job submitted: ${jobId.slice(0, 8)}… polling…`);
      const finalResp = await pollJob(c2, jobId, 'image');
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const media = await extractMedia(finalResp, 'image/png');
      if (!media) {
        console.log(`  ✗ Image gen returned no media after ${elapsed}s`);
        console.log('  Raw response:', JSON.stringify(result).slice(0, 800));
      } else {
        const ext = media.mimeType.split('/')[1] ?? 'png';
        const heroPath = join(OUT_DIR, `hero.${ext}`);
        await writeFile(heroPath, media.buffer);
        console.log(`  ✓ Hero image (${(media.buffer.length / 1024).toFixed(0)} KB, ${ext}) in ${elapsed}s → ${heroPath}`);
        if (media.debugUrl) console.log(`    Source URL: ${media.debugUrl}`);

        // Mirror to Supabase as an asset row for completeness
        const upload = await uploadBufferAsAsset({
          tenantId, projectId: null,
          folder:   'demo/combat-gym',
          filename: `hero.${ext}`,
          mimeType: media.mimeType,
          buffer:   media.buffer,
        });
        console.log(`    Mirrored to asset ${upload.assetId}: ${upload.url}`);
      }
    } finally {
      await c2.close();
    }
  }

  // ── 3. Hero video ─────────────────────────────────────────────────────
  console.log('\n[3/5] Generating hero video (sparing — 1 short clip)…');
  const videoTool = cats.videos[0];
  if (!videoTool) {
    console.log('  ⚠ No video tool — skipping');
  } else {
    console.log(`  Using tool: ${videoTool}`);
    const c3 = await openHiggsfield(tenantId, 'dev');
    try {
      if (!videoModel) {
        console.log('  ⚠ No video model resolved from models_explore — skipping');
        return;
      }
      // Sparing: try seedance_1_5 (text-to-video, no input image required).
      // wan2_6 is image-to-video only; minimax_hailuo was queue-failing earlier.
      const videoCandidates = ['seedance_1_5'];
      const t0 = Date.now();
      let submitResp: unknown = null;
      let usedModel = videoModel;
      for (const m of videoCandidates) {
        console.log(`  Trying model: ${m}…`);
        try {
          const r = await c3.callTool(videoTool, {
            params: {
              model:         m,
              prompt:        'Slow-motion close-up of a boxer\'s gloved fist hitting a heavy bag, dust particles flying, smoky gym atmosphere, dramatic lighting',
              duration:      5,
              aspect_ratio:  '16:9',
              count:         1,
            },
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (!(r as any)?.isError) { submitResp = r; usedModel = m; break; }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const errText = (r as any)?.content?.[0]?.text ?? '';
          console.log(`    ${m} rejected: ${errText.slice(0, 100)}`);
        } catch (err) {
          console.log(`    ${m} threw: ${(err as Error).message.slice(0, 100)}`);
        }
      }
      if (!submitResp) {
        console.log('  ✗ All video models failed');
        return;
      }
      console.log(`  Using model: ${usedModel}`);
      const jobId = extractJobId(submitResp);
      if (!jobId) {
        console.log('  ✗ No job id in submit response. Raw:', JSON.stringify(submitResp).slice(0, 400));
        return;
      }
      console.log(`  Job submitted: ${jobId.slice(0, 8)}… polling (video can take 60-180s)…`);
      const finalResp = await pollJob(c3, jobId, 'video', 360);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const media = await extractMedia(finalResp, 'video/mp4');
      if (!media) {
        console.log(`  ✗ Video gen returned no media after ${elapsed}s`);
        console.log('  Raw response (truncated):', JSON.stringify(finalResp).slice(0, 800));
      } else {
        const heroVid = join(OUT_DIR, 'hero.mp4');
        await writeFile(heroVid, media.buffer);
        console.log(`  ✓ Hero video (${(media.buffer.length / 1024 / 1024).toFixed(2)} MB) in ${elapsed}s → ${heroVid}`);
        if (media.debugUrl) console.log(`    Source URL: ${media.debugUrl}`);

        const upload = await uploadBufferAsAsset({
          tenantId, projectId: null,
          folder:   'demo/combat-gym',
          filename: 'hero.mp4',
          mimeType: media.mimeType,
          buffer:   media.buffer,
        });
        console.log(`    Mirrored to asset ${upload.assetId}: ${upload.url}`);

        // ── 4. Run the video through our Phase E renderer to prove the pipeline ──
        console.log('\n[4/5] Rendering through timeline pipeline…');
        const { renderTimeline } = await import('../src/lib/render');
        const renderResult = await renderTimeline({
          timeline: {
            fps: 30, width: 1280, height: 720,
            durationSec: 5,
            tracks: [
              { id: 'video', kind: 'video', clips: [{
                id: 'c1', sourceAssetId: upload.assetId,
                in: 0, out: 5, start: 0,
              }] },
              { id: 'audio', kind: 'audio', clips: [] },
            ],
            overlays: [{
              id: 'cap1', kind: 'caption',
              start: 0.5, end: 4.5,
              props: { text: 'IRON WILL COMBAT', color: '#ffffff' },
            }],
            meta: {},
          },
          quality: 'preview',
        });
        const renderedPath = join(OUT_DIR, 'hero-rendered.mp4');
        await writeFile(renderedPath, renderResult.buffer);
        console.log(`  ✓ Pipeline render: ${(renderResult.sizeBytes / 1024).toFixed(0)} KB at ${renderResult.width}x${renderResult.height} → ${renderedPath}`);
      }
    } finally {
      await c3.close();
    }
  }

  // ── 5. Build the website ─────────────────────────────────────────────
  console.log('\n[5/5] Building combat gym website…');
  const heroImageRef = existsSync(join(OUT_DIR, 'hero.jpg')) ? 'hero.jpg'
                     : existsSync(join(OUT_DIR, 'hero.jpeg')) ? 'hero.jpeg'
                     : existsSync(join(OUT_DIR, 'hero.png')) ? 'hero.png'
                     : null;
  const heroVideoRef = existsSync(join(OUT_DIR, 'hero-rendered.mp4')) ? 'hero-rendered.mp4'
                     : existsSync(join(OUT_DIR, 'hero.mp4')) ? 'hero.mp4'
                     : null;

  const html = buildCombatGymHtml({ heroImage: heroImageRef, heroVideo: heroVideoRef });
  const indexPath = join(OUT_DIR, 'index.html');
  await writeFile(indexPath, html);
  console.log(`  ✓ Single-page site: ${indexPath}`);
  console.log(`     hero image: ${heroImageRef ?? '(none — skipped)'}`);
  console.log(`     hero video: ${heroVideoRef ?? '(none — skipped)'}`);

  console.log('\n— DONE —');
  console.log(`Open: ${indexPath}`);
}

function buildCombatGymHtml(opts: { heroImage: string | null; heroVideo: string | null }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Iron Will Combat — Premium Boxing & MMA Gym</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-deep:    #0a0d12;
    --bg-card:    #131720;
    --accent:     #d4731c;   /* burnt amber */
    --accent-hot: #ff8c2a;
    --text:       #f5f0e8;
    --text-mute:  #8a8e98;
    --border:     #1f2530;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--bg-deep); color: var(--text); font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; line-height: 1.55; }
  h1, h2, h3 { font-family: 'Bebas Neue', sans-serif; font-weight: 400; letter-spacing: 0.02em; line-height: 1.05; }
  a { color: inherit; text-decoration: none; }
  img, video { max-width: 100%; display: block; }

  /* ─ Nav ─ */
  nav { position: fixed; top: 0; left: 0; right: 0; z-index: 50; padding: 18px 48px;
        display: flex; align-items: center; justify-content: space-between;
        background: linear-gradient(to bottom, rgba(10,13,18,0.92), rgba(10,13,18,0.0));
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
  .logo { font-family: 'Bebas Neue', sans-serif; font-size: 1.8rem; letter-spacing: 0.08em; }
  .logo span { color: var(--accent); }
  .nav-links { display: flex; gap: 36px; list-style: none; font-size: 0.875rem; font-weight: 500; }
  .nav-links a { transition: color 200ms ease; }
  .nav-links a:hover { color: var(--accent); }
  .nav-cta { background: var(--accent); color: #fff; padding: 11px 22px; border-radius: 4px;
             font-weight: 700; font-size: 0.8125rem; letter-spacing: 0.04em; text-transform: uppercase;
             transition: background 200ms ease; }
  .nav-cta:hover { background: var(--accent-hot); }

  /* ─ Hero ─ */
  .hero { position: relative; min-height: 100vh; display: flex; align-items: center;
          padding: 0 48px; overflow: hidden; }
  .hero-bg { position: absolute; inset: 0; z-index: 1; }
  .hero-bg::after { content: ''; position: absolute; inset: 0;
                     background: linear-gradient(to right, rgba(10,13,18,0.92) 0%, rgba(10,13,18,0.55) 50%, rgba(10,13,18,0.85) 100%); }
  .hero-bg img, .hero-bg video { width: 100%; height: 100%; object-fit: cover; }
  .hero-content { position: relative; z-index: 2; max-width: 720px; }
  .eyebrow { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase;
              color: var(--accent); margin-bottom: 24px; display: flex; align-items: center; gap: 12px; }
  .eyebrow::before { content: ''; width: 32px; height: 2px; background: var(--accent); display: inline-block; }
  .hero h1 { font-size: clamp(3rem, 8vw, 6.5rem); margin-bottom: 28px; }
  .hero h1 em { font-style: normal; color: var(--accent); }
  .hero-sub { font-size: 1.125rem; color: var(--text-mute); margin-bottom: 40px; max-width: 540px; }
  .cta-row { display: flex; gap: 16px; flex-wrap: wrap; }
  .btn { padding: 16px 32px; border-radius: 4px; font-weight: 700; font-size: 0.875rem;
         letter-spacing: 0.04em; text-transform: uppercase; transition: all 200ms ease; cursor: pointer; border: none; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hot); transform: translateY(-1px); }
  .btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
  .hero-stats { position: absolute; bottom: 60px; right: 48px; display: flex; gap: 56px; z-index: 2; }
  .stat { text-align: right; }
  .stat-num { font-family: 'Bebas Neue', sans-serif; font-size: 3rem; color: var(--accent); line-height: 1; }
  .stat-label { font-size: 0.6875rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-mute); margin-top: 8px; }

  /* ─ Sections ─ */
  section { padding: 120px 48px; }
  .section-eyebrow { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; color: var(--accent); margin-bottom: 16px; }
  .section-title { font-size: clamp(2.5rem, 5vw, 4rem); margin-bottom: 24px; max-width: 720px; }
  .section-sub { font-size: 1.0625rem; color: var(--text-mute); max-width: 640px; margin-bottom: 64px; }

  /* ─ Programs ─ */
  .programs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1px;
                   background: var(--border); border: 1px solid var(--border); }
  .program { background: var(--bg-card); padding: 48px 36px; transition: background 200ms ease; cursor: pointer; }
  .program:hover { background: #1a202c; }
  .program-icon { width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;
                  background: rgba(212,115,28,0.15); border: 1px solid rgba(212,115,28,0.3); border-radius: 4px;
                  font-size: 1.5rem; margin-bottom: 24px; }
  .program h3 { font-size: 1.75rem; margin-bottom: 12px; }
  .program p { color: var(--text-mute); font-size: 0.9375rem; margin-bottom: 24px; }
  .program-meta { display: flex; gap: 20px; font-size: 0.75rem; color: var(--text-mute); padding-top: 20px; border-top: 1px solid var(--border); }
  .program-meta strong { color: var(--text); display: block; font-size: 0.875rem; margin-bottom: 4px; }

  /* ─ Coaches ─ */
  .coaches-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; }
  .coach { background: var(--bg-card); border: 1px solid var(--border); padding: 32px;
           position: relative; overflow: hidden; }
  .coach::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--accent); transform: scaleY(0); transform-origin: top; transition: transform 280ms ease; }
  .coach:hover::before { transform: scaleY(1); }
  .coach-rank { font-family: 'Bebas Neue', sans-serif; font-size: 0.875rem; letter-spacing: 0.2em; color: var(--accent); margin-bottom: 16px; }
  .coach h4 { font-size: 1.625rem; font-family: 'Bebas Neue', sans-serif; margin-bottom: 6px; }
  .coach-disc { color: var(--text-mute); font-size: 0.8125rem; margin-bottom: 16px; }
  .coach-bio { font-size: 0.875rem; color: var(--text-mute); line-height: 1.6; }

  /* ─ Schedule ─ */
  .schedule { background: var(--bg-card); padding: 96px 48px; }
  .schedule-grid { display: grid; grid-template-columns: 100px repeat(7, 1fr); gap: 1px; background: var(--border);
                   border: 1px solid var(--border); margin-top: 48px; font-size: 0.8125rem; }
  .schedule-grid > div { background: var(--bg-card); padding: 14px 12px; text-align: center; }
  .sched-head { background: var(--bg-deep) !important; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.6875rem; color: var(--accent); }
  .sched-time { font-weight: 600; color: var(--text-mute); }
  .sched-cell.has-class { color: var(--text); cursor: pointer; transition: background 150ms ease; }
  .sched-cell.has-class:hover { background: rgba(212,115,28,0.12); }
  .sched-cell.has-class strong { display: block; font-size: 0.875rem; margin-bottom: 2px; }
  .sched-cell.has-class span { color: var(--text-mute); font-size: 0.6875rem; }

  /* ─ Pricing ─ */
  .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; }
  .price { background: var(--bg-card); border: 1px solid var(--border); padding: 40px 32px; position: relative; }
  .price.featured { border-color: var(--accent); transform: translateY(-8px); }
  .price.featured::before { content: 'MOST CHOSEN'; position: absolute; top: -1px; left: 24px;
                              background: var(--accent); color: #fff; font-size: 0.625rem; font-weight: 700;
                              letter-spacing: 0.18em; padding: 5px 10px; }
  .price h4 { font-size: 1.25rem; font-family: 'Inter', sans-serif; font-weight: 700; margin-bottom: 8px; letter-spacing: 0; text-transform: uppercase; }
  .price-amount { font-family: 'Bebas Neue', sans-serif; font-size: 4rem; color: var(--accent); line-height: 1; margin: 16px 0 4px; }
  .price-amount sub { font-size: 0.875rem; color: var(--text-mute); margin-left: 6px; vertical-align: middle; }
  .price ul { list-style: none; margin: 32px 0; }
  .price li { padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 0.875rem; color: var(--text-mute); display: flex; align-items: center; gap: 10px; }
  .price li::before { content: '→'; color: var(--accent); font-weight: 700; }

  /* ─ CTA ─ */
  .final-cta { padding: 120px 48px; text-align: center; background:
               radial-gradient(ellipse at center, rgba(212,115,28,0.18) 0%, transparent 60%), var(--bg-deep); }
  .final-cta h2 { font-size: clamp(2.5rem, 6vw, 5rem); margin-bottom: 20px; }
  .final-cta p { color: var(--text-mute); margin-bottom: 36px; font-size: 1.125rem; }

  /* ─ Footer ─ */
  footer { padding: 48px; border-top: 1px solid var(--border); display: flex;
            justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;
            font-size: 0.8125rem; color: var(--text-mute); }

  @media (max-width: 720px) {
    nav { padding: 14px 20px; }
    .nav-links { display: none; }
    .hero { padding: 100px 20px 60px; }
    .hero-stats { display: none; }
    section { padding: 80px 20px; }
    .schedule { padding: 80px 20px; }
    .schedule-grid { grid-template-columns: 80px repeat(7, minmax(60px, 1fr)); overflow-x: auto; font-size: 0.6875rem; }
    .final-cta { padding: 80px 20px; }
    footer { padding: 32px 20px; flex-direction: column; align-items: flex-start; }
  }
</style>
</head>
<body>

<nav>
  <div class="logo">IRON WILL <span>COMBAT</span></div>
  <ul class="nav-links">
    <li><a href="#programs">Programs</a></li>
    <li><a href="#coaches">Coaches</a></li>
    <li><a href="#schedule">Schedule</a></li>
    <li><a href="#pricing">Pricing</a></li>
  </ul>
  <a href="#cta" class="nav-cta">Book Trial</a>
</nav>

<section class="hero">
  <div class="hero-bg">
    ${opts.heroVideo
      ? `<video autoplay muted loop playsinline poster="${opts.heroImage ?? ''}"><source src="${opts.heroVideo}" type="video/mp4"></video>`
      : opts.heroImage
        ? `<img src="${opts.heroImage}" alt="Combat training">`
        : `<div style="background: linear-gradient(135deg, #0a0d12 0%, #1a202c 50%, #2a1f12 100%); width: 100%; height: 100%;"></div>`}
  </div>
  <div class="hero-content">
    <div class="eyebrow">Established 2014 · Boxing · MMA · Muay Thai</div>
    <h1>Train like<br>you mean it.<br><em>Fight like<br>you mean more.</em></h1>
    <p class="hero-sub">A serious gym for serious athletes. World-class coaches, a no-ego training floor, and the conditioning programs trusted by amateur and professional fighters across the city.</p>
    <div class="cta-row">
      <a href="#cta" class="btn btn-primary">Start Free Trial</a>
      <a href="#programs" class="btn btn-ghost">See Programs</a>
    </div>
  </div>
  <div class="hero-stats">
    <div class="stat"><div class="stat-num">12K</div><div class="stat-label">Members trained</div></div>
    <div class="stat"><div class="stat-num">38</div><div class="stat-label">Title holders</div></div>
    <div class="stat"><div class="stat-num">10</div><div class="stat-label">Years iron</div></div>
  </div>
</section>

<section id="programs">
  <div class="section-eyebrow">Programs</div>
  <h2 class="section-title">Built for the work, not the photo op.</h2>
  <p class="section-sub">Every class is run by a credentialed coach. Sparring is supervised. Beginners get the same attention as the pros.</p>
  <div class="programs-grid">
    <div class="program">
      <div class="program-icon">🥊</div>
      <h3>Boxing</h3>
      <p>Footwork, head movement, combinations. Pad work with coaches every class. Six classes weekly.</p>
      <div class="program-meta"><div><strong>All levels</strong>Beginner → pro</div><div><strong>60 min</strong>per class</div></div>
    </div>
    <div class="program">
      <div class="program-icon">🦵</div>
      <h3>Muay Thai</h3>
      <p>Eight points of contact. Clinch work. Coach-led pad rounds. Authentic Thai-style training.</p>
      <div class="program-meta"><div><strong>All levels</strong>Drop-ins welcome</div><div><strong>75 min</strong>per class</div></div>
    </div>
    <div class="program">
      <div class="program-icon">🥋</div>
      <h3>BJJ</h3>
      <p>Gi and no-gi. Fundamentals and advanced classes. IBJJF-ranked instructors, open-mat Sundays.</p>
      <div class="program-meta"><div><strong>White → black</strong>Belt curriculum</div><div><strong>90 min</strong>per class</div></div>
    </div>
    <div class="program">
      <div class="program-icon">⚔️</div>
      <h3>MMA</h3>
      <p>Striking, grappling, transitions. Cage work. Fight team for athletes preparing to compete.</p>
      <div class="program-meta"><div><strong>Intermediate+</strong>Some experience</div><div><strong>90 min</strong>per class</div></div>
    </div>
    <div class="program">
      <div class="program-icon">💪</div>
      <h3>Strength &amp; Conditioning</h3>
      <p>Sport-specific S&amp;C built around your training. Power, work capacity, mobility, recovery.</p>
      <div class="program-meta"><div><strong>All levels</strong>Periodised</div><div><strong>60 min</strong>per class</div></div>
    </div>
    <div class="program">
      <div class="program-icon">🎯</div>
      <h3>Private Coaching</h3>
      <p>One-on-one with a coach of your choice. Tailored to your goals — competitive prep or technical work.</p>
      <div class="program-meta"><div><strong>By appointment</strong>Book online</div><div><strong>60–90 min</strong>per session</div></div>
    </div>
  </div>
</section>

<section id="coaches">
  <div class="section-eyebrow">The Coaches</div>
  <h2 class="section-title">Credentialed. Active. Honest.</h2>
  <p class="section-sub">No social-media coaches. No mystics. Every name on the wall has competed and continues to learn.</p>
  <div class="coaches-grid">
    <div class="coach"><div class="coach-rank">Head Coach</div><h4>Marco "Iron" Reyes</h4><div class="coach-disc">Boxing · MMA</div><p class="coach-bio">Former NYSAC pro boxer (14-2). 18 years coaching. Cornered four title fights this season.</p></div>
    <div class="coach"><div class="coach-rank">Muay Thai Lead</div><h4>Anchalee Suwanee</h4><div class="coach-disc">Muay Thai</div><p class="coach-bio">Trained out of Sitmonchai (Thailand). Lumpinee veteran. Specialises in clinch and elbows.</p></div>
    <div class="coach"><div class="coach-rank">BJJ Lead</div><h4>Eric Doyle</h4><div class="coach-disc">Brazilian Jiu-Jitsu</div><p class="coach-bio">3rd-degree black belt under Saulo Ribeiro. Pan Ams gold (2019). IBJJF-ranked instructor.</p></div>
    <div class="coach"><div class="coach-rank">S&amp;C Director</div><h4>Devon Carter</h4><div class="coach-disc">Strength &amp; Conditioning</div><p class="coach-bio">CSCS, USAW Sports Performance Coach. Ten years working with combat athletes from amateur to UFC.</p></div>
  </div>
</section>

<section class="schedule" id="schedule">
  <div class="section-eyebrow">Schedule</div>
  <h2 class="section-title">Train when you can.</h2>
  <p class="section-sub">Six classes most days. Open mat Sundays. Members can drop in to anything that matches their level.</p>
  <div class="schedule-grid">
    <div class="sched-head"></div>
    <div class="sched-head">Mon</div><div class="sched-head">Tue</div><div class="sched-head">Wed</div><div class="sched-head">Thu</div><div class="sched-head">Fri</div><div class="sched-head">Sat</div><div class="sched-head">Sun</div>
    <div class="sched-time">6:00 AM</div>
    <div class="sched-cell has-class"><strong>Boxing</strong><span>Marco</span></div>
    <div class="sched-cell has-class"><strong>S&amp;C</strong><span>Devon</span></div>
    <div class="sched-cell has-class"><strong>Boxing</strong><span>Marco</span></div>
    <div class="sched-cell has-class"><strong>S&amp;C</strong><span>Devon</span></div>
    <div class="sched-cell has-class"><strong>Boxing</strong><span>Marco</span></div>
    <div class="sched-cell"></div>
    <div class="sched-cell"></div>
    <div class="sched-time">12:00 PM</div>
    <div class="sched-cell has-class"><strong>BJJ Fund.</strong><span>Eric</span></div>
    <div class="sched-cell has-class"><strong>Muay Thai</strong><span>Anchalee</span></div>
    <div class="sched-cell has-class"><strong>BJJ Fund.</strong><span>Eric</span></div>
    <div class="sched-cell has-class"><strong>Muay Thai</strong><span>Anchalee</span></div>
    <div class="sched-cell has-class"><strong>BJJ Fund.</strong><span>Eric</span></div>
    <div class="sched-cell has-class"><strong>Open Mat</strong><span>All belts</span></div>
    <div class="sched-cell has-class"><strong>Open Mat</strong><span>All</span></div>
    <div class="sched-time">5:30 PM</div>
    <div class="sched-cell has-class"><strong>Muay Thai</strong><span>Anchalee</span></div>
    <div class="sched-cell has-class"><strong>MMA</strong><span>Marco</span></div>
    <div class="sched-cell has-class"><strong>BJJ Adv.</strong><span>Eric</span></div>
    <div class="sched-cell has-class"><strong>MMA</strong><span>Marco</span></div>
    <div class="sched-cell has-class"><strong>Sparring</strong><span>Coaches</span></div>
    <div class="sched-cell has-class"><strong>Boxing</strong><span>Marco</span></div>
    <div class="sched-cell"></div>
    <div class="sched-time">7:30 PM</div>
    <div class="sched-cell has-class"><strong>Boxing Adv.</strong><span>Marco</span></div>
    <div class="sched-cell has-class"><strong>BJJ Fund.</strong><span>Eric</span></div>
    <div class="sched-cell has-class"><strong>Muay Thai</strong><span>Anchalee</span></div>
    <div class="sched-cell has-class"><strong>BJJ Fund.</strong><span>Eric</span></div>
    <div class="sched-cell has-class"><strong>Fight Team</strong><span>Marco</span></div>
    <div class="sched-cell"></div>
    <div class="sched-cell"></div>
  </div>
</section>

<section id="pricing">
  <div class="section-eyebrow">Membership</div>
  <h2 class="section-title">No contracts. No nonsense.</h2>
  <p class="section-sub">Cancel anytime. Pause for travel or injury. Pay-as-you-go drop-ins for visiting fighters.</p>
  <div class="pricing-grid">
    <div class="price">
      <h4>Drop-In</h4>
      <div class="price-amount">$30<sub>/class</sub></div>
      <ul><li>Any class, any time</li><li>No commitment</li><li>Visiting members welcome</li></ul>
      <a href="#cta" class="btn btn-ghost" style="width:100%;text-align:center;">Drop In</a>
    </div>
    <div class="price featured">
      <h4>Unlimited</h4>
      <div class="price-amount">$199<sub>/month</sub></div>
      <ul><li>All classes, all programs</li><li>Open mat included</li><li>10% off privates</li><li>2 guest passes / month</li></ul>
      <a href="#cta" class="btn btn-primary" style="width:100%;text-align:center;">Start Trial</a>
    </div>
    <div class="price">
      <h4>Fight Team</h4>
      <div class="price-amount">$349<sub>/month</sub></div>
      <ul><li>Everything in Unlimited</li><li>Fight team training block</li><li>Weekly privates</li><li>Cornering at competitions</li></ul>
      <a href="#cta" class="btn btn-ghost" style="width:100%;text-align:center;">Apply</a>
    </div>
  </div>
</section>

<section class="final-cta" id="cta">
  <h2>Step on the floor.</h2>
  <p>Your first week is free. Show up with shorts, a water bottle, and intent.</p>
  <a href="#" class="btn btn-primary" style="font-size: 0.9375rem; padding: 18px 40px;">Book Free Trial Class</a>
</section>

<footer>
  <div>© 2026 Iron Will Combat · 1845 W Industrial Dr</div>
  <div>hello@ironwill.combat · (555) 712-3344</div>
</footer>

</body>
</html>`;
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('\n✗', err); process.exit(1); });
