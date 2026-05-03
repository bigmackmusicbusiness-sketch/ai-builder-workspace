// apps/api/src/agent/tools.ts — tool definitions + executors for the chat agent.
// The AI receives these tool schemas, emits tool_calls, and the server executes them
// against the project workspace (on-disk, tenant-scoped).
// Creative Suite tools: compose_email (sync), create_ebook / create_document /
// generate_music (fire-and-forget — insert row, background pipeline, return tracking ID).
import type { ToolDefinition, ImageGenResponse } from '@abw/providers';
import {
  writeWorkspaceFile, writeWorkspaceFileBuffer,
  readWorkspaceFile, listWorkspaceFiles, deleteWorkspaceFile,
  backupFileToStorage,
  type WorkspaceHandle,
} from '../preview/workspace';
import { getDb } from '../db/client';
import { ebooks, documents, musicTracks } from '@abw/db';
import { buildEmailHtml, type EmailStyle } from '../lib/emailRenderer';
import { renderHtmlToPdf } from '../lib/pdf';
import { uploadBufferAsAsset } from '../lib/assetUpload';
import { buildEbookHtml, buildEpubChapters, styleToTrim, type EbookStyle, type EbookChapter, type EbookRecord } from '../lib/ebookBuilder';
import { renderEpub } from '../lib/epub';
import { concatMp3WithCrossfade, mp3ToWav } from '../lib/ffmpeg';
import { buildZip } from '../lib/zipper';
import { vaultGet } from '../security/vault';
import { eq } from 'drizzle-orm';

// ── Unsplash fallback image URLs ─────────────────────────────────────────────
// When AI image generation is unavailable or fails, we pick a curated free
// Unsplash photo that matches the subject of the prompt.

const UNSPLASH_SUBJECTS: Array<{ keywords: string[]; url: string }> = [
  { keywords: ['tree', 'forest', 'oak', 'pine', 'nature', 'arborist', 'wood'],
    url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1200&q=80' },
  { keywords: ['removal', 'chainsaw', 'cutting', 'fell', 'logging'],
    url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80' },
  { keywords: ['stump', 'grinding', 'ground'],
    url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=80' },
  { keywords: ['storm', 'damage', 'emergency', 'fallen', 'hurricane'],
    url: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1200&q=80' },
  { keywords: ['trimming', 'pruning', 'branch', 'crew', 'worker', 'team'],
    url: 'https://images.unsplash.com/photo-1585621386284-3d90b91e1bb3?w=1200&q=80' },
  { keywords: ['house', 'home', 'yard', 'garden', 'suburban', 'backyard'],
    url: 'https://images.unsplash.com/photo-1464082354059-27db6ce50048?w=1200&q=80' },
  { keywords: ['hero', 'banner', 'background', 'landscape', 'sky'],
    url: 'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?w=1200&q=80' },
];
const UNSPLASH_DEFAULT = 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1200&q=80';

function unsplashFallback(prompt: string): string {
  const lower = prompt.toLowerCase();
  for (const { keywords, url } of UNSPLASH_SUBJECTS) {
    if (keywords.some((k) => lower.includes(k))) return url;
  }
  return UNSPLASH_DEFAULT;
}

// ── Creative Suite tool schemas (defined first; spread into AGENT_TOOLS below) ─

const CREATIVE_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'compose_email',
      description:
        'Compose a styled HTML email using AI and return it immediately. ' +
        'Returns the subject line, preview text, and full HTML ready to send or preview. ' +
        'Use when the user wants to draft a marketing email, welcome sequence, newsletter, etc.',
      parameters: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt:   { type: 'string', description: 'What the email should say / accomplish.' },
          style:    { type: 'string', enum: ['newsletter','welcome','promotional','transactional','announcement'], description: 'Visual style. Default: newsletter.' },
          fromName: { type: 'string', description: 'Sender display name (optional).' },
          footer:   { type: 'string', description: 'Footer text (e.g. unsubscribe notice, optional).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_ebook',
      description:
        'Start generating a full eBook (PDF + EPUB) in the background. ' +
        'Returns a tracking ID immediately — the user can check /ebooks to download when ready. ' +
        'Styles: lead_magnet, professional_business, how_to_guide, cookbook, academic, narrative_story, kdp_novel, picture_book.',
      parameters: {
        type: 'object',
        required: ['title', 'style'],
        properties: {
          title:           { type: 'string', description: 'eBook title.' },
          author:          { type: 'string', description: 'Author name. Default: Anonymous.' },
          style:           { type: 'string', enum: ['lead_magnet','professional_business','how_to_guide','cookbook','academic','narrative_story','kdp_novel','picture_book'] },
          topic:           { type: 'string', description: 'One-paragraph description of the book.' },
          audience:        { type: 'string', description: 'Target audience (optional).' },
          tone:            { type: 'string', description: 'Writing tone, e.g. warm, punchy (optional).' },
          chapterCount:    { type: 'number', description: 'Number of chapters (1–20). Default: 5.' },
          wordCountTarget: { type: 'number', description: 'Words per chapter (300–2000). Default: 800.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_document',
      description:
        'Generate a professional PDF document (proposal, case study, report, invoice, or pitch deck) in the background. ' +
        'Returns a tracking ID immediately — the user can check /documents to download when ready.',
      parameters: {
        type: 'object',
        required: ['title', 'docType'],
        properties: {
          title:       { type: 'string', description: 'Document title.' },
          docType:     { type: 'string', enum: ['business_proposal','case_study','project_report','invoice','pitch_deck'] },
          topic:       { type: 'string', description: 'Description of the document purpose/content.' },
          clientName:  { type: 'string', description: 'Client name (optional).' },
          companyName: { type: 'string', description: 'Company name (optional).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_music',
      description:
        'Generate an original music track (beat or cinematic) in the background. ' +
        'Returns a tracking ID immediately — the user can check /music to download MP3 and stems ZIP when ready.',
      parameters: {
        type: 'object',
        required: ['title', 'mode'],
        properties: {
          title:       { type: 'string', description: 'Track title.' },
          mode:        { type: 'string', enum: ['beat','cinematic'], description: '"beat" for rap/hip-hop; "cinematic" for score/ambient.' },
          prompt:      { type: 'string', description: 'Describe the sound, mood, instruments, or scene.' },
          durationSec: { type: 'number', description: 'Duration in seconds (30–300). Default: 60.' },
          bpm:         { type: 'number', description: 'Beats per minute for beats mode (optional).' },
          vibe:        { type: 'string', enum: ['trap','boom_bap','drill','lo_fi','west_coast','melodic'], description: 'Beat vibe (optional).' },
          mood:        { type: 'string', enum: ['heroic','tense','melancholy','uplifting','dark','romantic','mysterious'], description: 'Cinematic mood (optional).' },
        },
      },
    },
  },
];

// ── Base workspace tool schemas ───────────────────────────────────────────────

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write a file to the project workspace. Creates parent directories as needed. ' +
        'Use for creating or overwriting any source file (HTML, CSS, JS, JSON, etc.). ' +
        'Paths are relative to the project root (e.g. "index.html", "styles.css").',
      parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path:    { type: 'string', description: 'Path relative to project root (e.g. "index.html").' },
          content: { type: 'string', description: 'Full file content as a UTF-8 string.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read an existing file from the project workspace. Returns the full UTF-8 content ' +
        'or an error if the file does not exist. Use before modifying a file you have not seen.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Path relative to project root.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List all files in the project workspace. Returns an array of paths relative to the project root. ' +
        'Call this first when the user refers to "the project" and you do not know what exists yet.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file from the project workspace. No-op if the file does not exist.',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Path relative to project root.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gen_image',
      description:
        'Generate an image using AI (MiniMax image-01 model) and save it to the project workspace. ' +
        'Returns the file path to embed with <img src="/images/filename.jpg" alt="...">. ' +
        'Use for hero images, service photos, backgrounds, team photos, product shots, etc. ' +
        'Be detailed and specific in the prompt — include style, lighting, colors, and subject.',
      parameters: {
        type: 'object',
        required: ['prompt', 'filename'],
        properties: {
          prompt: {
            type: 'string',
            description:
              'Detailed image description. Example: "Professional arborist in safety gear trimming a large oak tree ' +
              'in a suburban backyard, golden hour lighting, photorealistic, high quality".',
          },
          filename: {
            type: 'string',
            description:
              'File name with .jpg or .png extension. Will be saved under /images/. ' +
              'Example: "hero-tree-removal.jpg".',
          },
        },
      },
    },
  },
  // ── Creative Suite tools (compose_email / create_ebook / create_document / generate_music)
  ...CREATIVE_TOOLS,
];

// ── Executor context ─────────────────────────────────────────────────────────

/** Context passed to each tool call execution. */
export interface ToolContext {
  ws: WorkspaceHandle;
  /** If provided, the gen_image tool can generate real images. */
  generateImage?: (prompt: string) => Promise<ImageGenResponse>;
  /** Tenant ID — required for Creative Suite tools. */
  tenantId?: string;
  /** Project ID to associate generated content with (optional). */
  projectId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /** LLM adapter — required for Creative Suite tools that call AI. */
  adapter?: any;
}

export interface ToolExecutionResult {
  ok:      boolean;
  summary: string;   // one-line summary for UI (e.g. "Wrote src/App.tsx (1.2 KB)")
  result:  string;   // full result fed back to the model
}

/**
 * Execute a single tool call against the workspace.
 * `argsJson` is the raw JSON string from the model.
 */
export async function executeToolCall(
  ctx:      ToolContext,
  name:     string,
  argsJson: string,
): Promise<ToolExecutionResult> {
  let args: Record<string, unknown>;
  try {
    args = argsJson.trim() ? JSON.parse(argsJson) as Record<string, unknown> : {};
  } catch (err) {
    // Best-effort: pull a "path" or "filename" out of the malformed JSON for a useful hint.
    const pathMatch = argsJson.match(/"(?:path|filename)"\s*:\s*"([^"]+)"/);
    const pathHint  = pathMatch ? ` (path: ${pathMatch[1]})` : '';
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      summary: `Invalid tool arguments for ${name}${pathHint}`,
      result:
        `Error: tool arguments were not valid JSON: ${msg}. ` +
        `Retry this file with a smaller content chunk and ensure backslashes, ` +
        `double-quotes, and newlines inside the "content" string are properly escaped (\\n, \\", \\\\).`,
    };
  }

  const { ws } = ctx;

  try {
    switch (name) {
      case 'write_file': {
        // Be lenient on arg names — MiniMax sometimes emits the call with
        // alias keys (filename / file / name / filePath / relPath) instead
        // of the schema-declared "path", and the resulting "path is required"
        // failure burns an iteration without telling the agent what to fix.
        // Accept any reasonable alias; only fail if NONE of them carry a value.
        const pathRaw =
          (args['path'] as string | undefined) ??
          (args['filename'] as string | undefined) ??
          (args['filePath'] as string | undefined) ??
          (args['file'] as string | undefined) ??
          (args['relPath'] as string | undefined) ??
          (args['name'] as string | undefined) ??
          '';
        const path    = String(pathRaw).trim();
        const content = String(args['content'] ?? args['body'] ?? args['text'] ?? '');
        if (!path) {
          return {
            ok: false,
            summary: 'write_file refused — path missing',
            result:
              'Error: "path" is required. The call had no path / filename / file / filePath / name. ' +
              'Retry with: write_file(path: "index.html", content: "<full HTML here>"). ' +
              'Use the EXACT key "path" — that is the schema name.',
          };
        }
        if (!content && content !== '') {
          return {
            ok: false,
            summary: `write_file refused — content missing for ${path}`,
            result:
              `Error: "content" is required. The call had no content / body / text. ` +
              `Retry with: write_file(path: "${path}", content: "<full file content here>").`,
          };
        }

        // Hard-gate planning-document writes when no index.html exists yet.
        // The model has been observed writing SPEC.md / README.md / plan.md
        // first and exhausting iteration budget before getting to actual
        // code, leaving the user with a project that won't render. Reject
        // those writes early so the agent's next tool call has to be the
        // site itself. Once index.html exists, planning docs are fine.
        const isPlanningDoc = /^(spec|readme|plan|todo|roadmap|notes?)\.md$/i.test(
          path.split(/[\\/]/).pop() ?? '',
        );
        if (isPlanningDoc) {
          const existing = await listWorkspaceFiles(ws);
          const hasEntry = existing.some((p) =>
            /\/(index\.html?|main\.tsx|main\.jsx)$/i.test(p),
          );
          if (!hasEntry) {
            return {
              ok: false,
              summary: `Refused to write ${path} — no index.html yet`,
              result:
                `Refused: ${path} is a planning doc but the workspace has no ` +
                `index.html or src/main.tsx yet. Per the agent rules, the FIRST ` +
                `file you write must be index.html (or src/main.tsx for a Vite SPA). ` +
                `Write that now, then come back to ${path} if you still need it.`,
            };
          }
        }

        const { bytes } = await writeWorkspaceFile(ws, path, content);
        // Fire-and-forget backup to Supabase Storage — survives server restarts
        backupFileToStorage(ws, path, content).catch(() => {});
        const kb = (bytes / 1024).toFixed(1);
        return {
          ok: true,
          summary: `Wrote ${path} (${kb} KB)`,
          result:  `File written: ${path} (${bytes} bytes)`,
        };
      }

      case 'read_file': {
        const path = String(args['path'] ?? '');
        if (!path) throw new Error('"path" is required');
        const content = await readWorkspaceFile(ws, path);
        if (content === null) {
          return {
            ok: false,
            summary: `Read failed: ${path} not found`,
            result:  `Error: file not found: ${path}`,
          };
        }
        // Cap result at 16KB to avoid blowing up context
        const truncated = content.length > 16_000;
        const out = truncated ? content.slice(0, 16_000) + '\n\n…[truncated]' : content;
        return {
          ok: true,
          summary: `Read ${path} (${content.length} bytes${truncated ? ', truncated' : ''})`,
          result:  out,
        };
      }

      case 'list_files': {
        const files = await listWorkspaceFiles(ws);
        return {
          ok: true,
          summary: `Listed ${files.length} file${files.length === 1 ? '' : 's'}`,
          result:  files.length === 0
            ? '(empty workspace)'
            : files.join('\n'),
        };
      }

      case 'delete_file': {
        const path = String(args['path'] ?? '');
        if (!path) throw new Error('"path" is required');
        await deleteWorkspaceFile(ws, path);
        return {
          ok: true,
          summary: `Deleted ${path}`,
          result:  `File deleted: ${path}`,
        };
      }

      case 'gen_image': {
        const prompt   = String(args['prompt'] ?? '');
        const filename = String(args['filename'] ?? 'image.jpg');
        if (!prompt) throw new Error('"prompt" is required');

        // Hard-gate: refuse image gen until index.html (or src/main.tsx)
        // exists. The model has been observed burning iteration budget on
        // 10+ image gens and never getting around to writing the actual
        // HTML — leaving the user with a folder of orphan JPGs and no
        // site. Force the order: HTML first, images second.
        {
          const existing = await listWorkspaceFiles(ws);
          const hasEntry = existing.some((p) =>
            /\/(index\.html?|main\.tsx|main\.jsx)$/i.test(p),
          );
          if (!hasEntry) {
            return {
              ok: false,
              summary: 'gen_image refused — no index.html yet',
              result:
                `Refused: write index.html FIRST (referencing /images/${filename}), ` +
                `then call gen_image. Order matters: the site must render ` +
                `even if image gen fails or hits credit limits. Once ` +
                `index.html exists this gate releases.`,
            };
          }
        }

        // Sanitize filename
        const safeName  = filename.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
        const hasExt    = /\.(jpg|jpeg|png)$/.test(safeName);
        const finalName = hasExt ? safeName : `${safeName}.jpg`;

        // ── Try AI generation first ───────────────────────────────────────────
        if (ctx.generateImage) {
          try {
            const { buffer, ext } = await ctx.generateImage(prompt);
            const actualName = finalName.replace(/\.[^.]+$/, `.${ext}`);
            const actualPath = `images/${actualName}`;
            const { bytes }  = await writeWorkspaceFileBuffer(ws, actualPath, buffer);
            const kb = (bytes / 1024).toFixed(0);
            return {
              ok: true,
              summary: `Generated /${actualPath} (${kb} KB)`,
              result:
                `AI image saved to /${actualPath} (${bytes} bytes). ` +
                `Embed with: <img src="/${actualPath}" alt="..." />`,
            };
          } catch (genErr) {
            // Fall through to Unsplash on any generation failure
            const reason = genErr instanceof Error ? genErr.message : String(genErr);
            // We'll note the fallback in the result so the model knows
            const fallbackUrl = unsplashFallback(prompt);
            return {
              ok: true,
              summary: `Image gen failed (${reason.slice(0, 60)}…) — using Unsplash photo`,
              result:
                `AI image generation failed: ${reason}. ` +
                `Use this free Unsplash photo URL instead: ${fallbackUrl}\n` +
                `Embed with: <img src="${fallbackUrl}" alt="..." loading="lazy" />`,
            };
          }
        }

        // ── No generator — return curated Unsplash URL ────────────────────────
        const fallbackUrl = unsplashFallback(prompt);
        return {
          ok: true,
          summary: `No image gen — using Unsplash photo`,
          result:
            `Image generation is not configured. ` +
            `Use this free Unsplash photo URL instead: ${fallbackUrl}\n` +
            `Embed with: <img src="${fallbackUrl}" alt="..." loading="lazy" />`,
        };
      }

      // ── compose_email (synchronous) ───────────────────────────────────────
      case 'compose_email': {
        if (!ctx.adapter) throw new Error('compose_email requires an LLM adapter in context');
        const emailStyle  = String(args['style'] ?? 'newsletter') as EmailStyle;
        const emailPrompt = String(args['prompt'] ?? '');
        const emailFrom   = args['fromName'] ? String(args['fromName']) : undefined;
        const emailFooter = args['footer']   ? String(args['footer'])   : undefined;
        if (!emailPrompt) throw new Error('"prompt" is required for compose_email');

        const styleGuide: Record<string, string> = {
          newsletter:    'Informative, warm, editorial. Lead with insight.',
          welcome:       'Friendly, clear, helpful. Name the next step.',
          promotional:   'Punchy, benefit-first, single CTA.',
          transactional: 'Terse, factual. Confirm what happened, next step.',
          announcement:  'Confident, ceremonial, concise. Lead with the news.',
        };
        const composeP = [
          `Compose a ${emailStyle} email.`,
          `Brief: ${emailPrompt}`,
          `Tone: ${styleGuide[emailStyle] ?? ''}`,
          '',
          'Return ONLY JSON: { "subject": "string", "previewText": "string", "bodyHtml": "string — ONLY <p><h2><h3><ul><li><strong><em><a> tags" }',
          'No markdown — JSON only.',
        ].join('\n');

        const res = await ctx.adapter.complete({ prompt: composeP, maxTokens: 2048, temperature: 0.75 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed = JSON.parse(res.text?.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim() ?? '{}') as any;
        const subject     = String(parsed['subject']     ?? 'Untitled');
        const previewText = String(parsed['previewText'] ?? '');
        const bodyHtml    = String(parsed['bodyHtml']    ?? '<p>No content generated.</p>');

        const fullHtml = buildEmailHtml({ style: emailStyle, subject, previewText, bodyHtml, fromName: emailFrom, footer: emailFooter });
        return {
          ok:      true,
          summary: `Composed ${emailStyle} email: "${subject}"`,
          result:  JSON.stringify({ subject, previewText, html: fullHtml }),
        };
      }

      // ── create_ebook (fire-and-forget background pipeline) ────────────────
      case 'create_ebook': {
        if (!ctx.tenantId || !ctx.adapter) throw new Error('create_ebook requires tenantId and adapter in context');
        const ebTitle    = String(args['title']          ?? 'Untitled');
        const ebStyle    = String(args['style']          ?? 'lead_magnet') as EbookStyle;
        const ebAuthor   = String(args['author']         ?? 'Anonymous');
        const ebTopic    = args['topic']    ? String(args['topic'])    : undefined;
        const ebAudience = args['audience'] ? String(args['audience']) : undefined;
        const ebTone     = args['tone']     ? String(args['tone'])     : undefined;
        const ebChapters = Number(args['chapterCount']    ?? 5);
        const ebWords    = Number(args['wordCountTarget'] ?? 800);

        const db = getDb();
        const [ebRow] = await db.insert(ebooks).values({
          tenantId:        ctx.tenantId,
          projectId:       ctx.projectId ?? null,
          title:           ebTitle,
          style:           ebStyle,
          topic:           ebTopic    ?? null,
          audience:        ebAudience ?? null,
          tone:            ebTone     ?? null,
          chapterCount:    ebChapters,
          wordCountTarget: ebWords,
          status:          'generating',
        }).returning();
        if (!ebRow) throw new Error('Failed to create ebook row');

        // ── Background pipeline (void — no await) ─────────────────────────────
        void (async () => {
          try {
            // Step 1: outline
            const outlinePromptText = [
              `You are outlining a ${ebStyle.replace(/_/g, ' ')} titled "${ebTitle}" by ${ebAuthor}.`,
              ebTopic    ? `Topic: ${ebTopic}`       : '',
              ebAudience ? `Audience: ${ebAudience}` : '',
              ebTone     ? `Tone: ${ebTone}`         : '',
              '',
              'Return ONLY JSON: { "chapters": [{ "title": "string", "summary": "string", "targetWords": number }], "frontMatter": { "copyright": "string", "dedication": "string" }, "backMatter": { "aboutAuthor": "string" } }',
              `Produce exactly ${ebChapters} chapters. Target ${ebWords} words per chapter. JSON only.`,
            ].filter(Boolean).join('\n');

            const outlineRes = await ctx.adapter.complete({ prompt: outlinePromptText, model: 'MiniMax-M2.7', maxTokens: 2048, temperature: 0.5 });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const outline = JSON.parse(outlineRes.text?.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim() ?? '{}') as any;
            await db.update(ebooks).set({ outline: outline as object, updatedAt: new Date() }).where(eq(ebooks.id, ebRow.id));

            // Step 2: chapters
            const chapters: EbookChapter[] = [];
            for (const oc of (outline['chapters'] ?? []).slice(0, ebChapters)) {
              const draftRes = await ctx.adapter.complete({
                prompt: `Write chapter "${oc['title']}" for "${ebTitle}". Chapter brief: ${oc['summary']}. Target: ${oc['targetWords'] ?? ebWords} words. Write the full prose chapter now.`,
                model: 'MiniMax-M2.7', maxTokens: 4096, temperature: 0.85,
              });
              chapters.push({ title: String(oc['title'] ?? ''), summary: String(oc['summary'] ?? ''), prose: String(draftRes.text ?? '') });
            }

            // Step 3: PDF
            const record: EbookRecord = { title: ebTitle, author: ebAuthor, style: ebStyle, chapters, frontMatter: outline['frontMatter'], backMatter: outline['backMatter'] };
            const html    = buildEbookHtml(record);
            const pdfBuf  = await renderHtmlToPdf({ html, format: styleToTrim(ebStyle) });
            const pdfUp   = await uploadBufferAsAsset({ tenantId: ctx.tenantId!, projectId: ctx.projectId ?? null, folder: `ebooks/${ebRow.id}`, filename: `${ebTitle.toLowerCase().replace(/\W+/g, '-').slice(0, 40)}.pdf`, mimeType: 'application/pdf', buffer: pdfBuf });

            // Step 4: EPUB (skip picture_book)
            let epubAssetId: string | undefined;
            if (ebStyle !== 'picture_book') {
              try {
                const epubBuf = await renderEpub({ title: ebTitle, author: ebAuthor, chapters: buildEpubChapters(record) });
                const epubUp  = await uploadBufferAsAsset({ tenantId: ctx.tenantId!, projectId: ctx.projectId ?? null, folder: `ebooks/${ebRow.id}`, filename: `${ebTitle.toLowerCase().replace(/\W+/g, '-').slice(0, 40)}.epub`, mimeType: 'application/epub+zip', buffer: epubBuf });
                epubAssetId = epubUp.assetId;
              } catch { /* best effort */ }
            }

            await db.update(ebooks).set({ status: 'ready', pdfAssetId: pdfUp.assetId, ...(epubAssetId ? { epubAssetId } : {}), outline: { ...outline, chapters: outline['chapters'].map((c: object, i: number) => ({ ...c, prose: chapters[i]?.prose })) } as object, updatedAt: new Date() }).where(eq(ebooks.id, ebRow.id));
          } catch (pipeErr) {
            await db.update(ebooks).set({ status: 'failed', error: String(pipeErr), updatedAt: new Date() }).where(eq(ebooks.id, ebRow.id)).catch(() => null);
          }
        })();

        return {
          ok:      true,
          summary: `Started eBook "${ebTitle}" (${ebStyle})`,
          result:  JSON.stringify({ ebookId: ebRow.id, status: 'generating', message: `eBook "${ebTitle}" is generating in the background. Open /ebooks to track progress and download PDF + EPUB when ready.` }),
        };
      }

      // ── create_document (fire-and-forget background pipeline) ─────────────
      case 'create_document': {
        if (!ctx.tenantId) throw new Error('create_document requires tenantId in context');
        const docTitle   = String(args['title']       ?? 'Untitled');
        const docType    = String(args['docType']     ?? 'business_proposal') as typeof documents.$inferInsert['docType'];
        const docTopic   = args['topic']       ? String(args['topic'])       : undefined;
        const docClient  = args['clientName']  ? String(args['clientName'])  : undefined;
        const docCompany = args['companyName'] ? String(args['companyName']) : undefined;

        const db = getDb();
        const [docRow] = await db.insert(documents).values({
          tenantId:  ctx.tenantId,
          projectId: ctx.projectId ?? null,
          title:     docTitle,
          docType,
          status:    'generating',
        }).returning();
        if (!docRow) throw new Error('Failed to create document row');

        void (async () => {
          try {
            if (!ctx.adapter) throw new Error('No adapter');
            const ctxLine = [docTopic ? `Topic: ${docTopic}` : '', docClient ? `Client: ${docClient}` : '', docCompany ? `Company: ${docCompany}` : ''].filter(Boolean).join('\n');
            const docPromptText = `Write a ${docType.replace(/_/g, ' ')} titled "${docTitle}". ${ctxLine}\n\nReturn ONLY JSON with a "sections" array: [{ "heading": "string", "body": "string" }]. JSON only.`;
            const docRes = await ctx.adapter.complete({ prompt: docPromptText, model: 'MiniMax-M2.7', maxTokens: 4096, temperature: 0.6 });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const structured = JSON.parse(docRes.text?.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim() ?? '{}') as any;

            const css = `* { box-sizing: border-box; } body { font-family: 'Helvetica Neue', sans-serif; color: #1a1a2e; line-height: 1.6; margin: 0; padding: 48px 56px; font-size: 11pt; } h1 { font-size: 26pt; margin: 0 0 8px; } h2 { font-size: 14pt; margin: 28px 0 10px; border-bottom: 2px solid #6c63ff; padding-bottom: 4px; } p { margin: 0 0 10px; } .cover { text-align: center; padding: 60px 0 40px; border-bottom: 1px solid #ddd; margin-bottom: 32px; } .meta { font-size: 9pt; color: #888; }`;
            const sections = Array.isArray(structured['sections']) ? structured['sections'] : [];
            const bodyHtml = `<div class="cover"><h1>${docTitle}</h1>${docClient ? `<div class="meta">Prepared for ${docClient}</div>` : ''}<div class="meta">${new Date().toLocaleDateString()}</div></div>${sections.map((s: { heading?: string; body?: string }) => `<h2>${String(s['heading'] ?? '')}</h2><p>${String(s['body'] ?? '').replace(/\n\n/g, '</p><p>')}</p>`).join('')}`;
            const docHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`;

            const pdfBuf = await renderHtmlToPdf({ html: docHtml, landscape: docType === 'pitch_deck', format: 'Letter' });
            const up = await uploadBufferAsAsset({ tenantId: ctx.tenantId!, projectId: ctx.projectId ?? null, folder: `documents/${docRow.id}`, filename: `${docTitle.toLowerCase().replace(/\W+/g, '-').slice(0, 40)}.pdf`, mimeType: 'application/pdf', buffer: pdfBuf });

            await db.update(documents).set({ status: 'ready', assetId: up.assetId, content: structured as object, updatedAt: new Date() }).where(eq(documents.id, docRow.id));
          } catch (pipeErr) {
            await db.update(documents).set({ status: 'failed', error: String(pipeErr), updatedAt: new Date() }).where(eq(documents.id, docRow.id)).catch(() => null);
          }
        })();

        return {
          ok:      true,
          summary: `Started document "${docTitle}" (${docType})`,
          result:  JSON.stringify({ documentId: docRow.id, status: 'generating', message: `Document "${docTitle}" is generating in the background. Open /documents to track progress and download the PDF when ready.` }),
        };
      }

      // ── generate_music (fire-and-forget background pipeline) ──────────────
      case 'generate_music': {
        if (!ctx.tenantId) throw new Error('generate_music requires tenantId in context');
        const musTitle   = String(args['title']   ?? 'Untitled Track');
        const musMode    = String(args['mode']    ?? 'beat') as 'beat' | 'cinematic';
        const musPrompt  = args['prompt']      ? String(args['prompt'])      : undefined;
        const musDur     = Number(args['durationSec'] ?? 60);
        const musBpm     = args['bpm']  ? Number(args['bpm'])  : undefined;
        const musVibe    = args['vibe'] ? String(args['vibe']) : undefined;
        const musMood    = args['mood'] ? String(args['mood']) : undefined;

        const db = getDb();
        const musInputs = { mode: musMode, vibe: musVibe, bpm: musBpm, mood: musMood, durationSec: musDur, prompt: musPrompt };
        const [musRow] = await db.insert(musicTracks).values({
          tenantId:    ctx.tenantId,
          projectId:   ctx.projectId ?? null,
          title:       musTitle,
          mode:        musMode,
          inputs:      musInputs as object,
          durationSec: musDur,
          bpm:         musBpm ?? null,
          status:      'generating',
        }).returning();
        if (!musRow) throw new Error('Failed to create music track row');

        void (async () => {
          try {
            // Build a music prompt
            const modeDesc = musMode === 'beat'
              ? `${musVibe ? musVibe + ' ' : ''}hip-hop beat${musBpm ? ` at ${musBpm} BPM` : ''}`
              : `${musMood ? musMood + ' ' : ''}cinematic score`;
            const fullPrompt = musPrompt ?? `${modeDesc} — ${musTitle}`;

            // Generate via MiniMax music-01
            const apiKey = await vaultGet({ name: 'MINIMAX_API_KEY', env: 'dev', tenantId: ctx.tenantId! });
            const segCount = Math.ceil(musDur / 60);
            const mp3Buffers: Buffer[] = [];

            for (let i = 0; i < segCount; i++) {
              const segDur = i === segCount - 1 ? musDur - i * 60 : 60;
              const musicRes = await fetch('https://api.minimaxi.chat/v1/music_generation', {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'music-01', prompt: fullPrompt, audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' } }),
                signal: AbortSignal.timeout(120_000),
              });
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const mjson = await musicRes.json() as any;
              const b64: string = mjson?.['data']?.['audio'] ?? mjson?.['audio'] ?? '';
              if (!b64) throw new Error('MiniMax music-01: no audio in response');
              mp3Buffers.push(Buffer.from(b64, 'base64'));
              void segDur; // used implicitly via segCount
            }

            const stitchedMp3 = mp3Buffers.length > 1 ? await concatMp3WithCrossfade(mp3Buffers) : mp3Buffers[0]!;
            const wavBuffer   = await mp3ToWav(stitchedMp3);

            const zipEntries = [
              { path: 'final.wav',     content: wavBuffer },
              { path: 'metadata.json', content: JSON.stringify({ title: musTitle, mode: musMode, durationSec: musDur, prompt: fullPrompt, generatedAt: new Date().toISOString() }, null, 2) },
            ];
            const zipBuf = await buildZip(zipEntries);

            const safeName = musTitle.toLowerCase().replace(/\W+/g, '-').slice(0, 40);
            const [mp3Up, zipUp] = await Promise.all([
              uploadBufferAsAsset({ tenantId: ctx.tenantId!, projectId: ctx.projectId ?? null, folder: `music/${musRow.id}`, filename: `${safeName}.mp3`, mimeType: 'audio/mpeg', buffer: stitchedMp3 }),
              uploadBufferAsAsset({ tenantId: ctx.tenantId!, projectId: ctx.projectId ?? null, folder: `music/${musRow.id}`, filename: `${safeName}-stems.zip`, mimeType: 'application/zip', buffer: zipBuf }),
            ]);

            await db.update(musicTracks).set({ status: 'ready', mp3AssetId: mp3Up.assetId, zipAssetId: zipUp.assetId, updatedAt: new Date() }).where(eq(musicTracks.id, musRow.id));
          } catch (pipeErr) {
            await db.update(musicTracks).set({ status: 'failed', error: String(pipeErr), updatedAt: new Date() }).where(eq(musicTracks.id, musRow.id)).catch(() => null);
          }
        })();

        return {
          ok:      true,
          summary: `Started music track "${musTitle}" (${musMode}, ${musDur}s)`,
          result:  JSON.stringify({ trackId: musRow.id, status: 'generating', message: `Track "${musTitle}" is generating in the background. Open /music to track progress and download MP3 when ready.` }),
        };
      }

      case 'design_run_huashu': {
        const { runHuashu, RunHuashuInput } = await import('./tools/design');
        const parsed = RunHuashuInput.safeParse(args);
        if (!parsed.success) {
          return { ok: false, summary: 'Invalid args for design_run_huashu', result: `Error: ${parsed.error.message}` };
        }
        if (!ctx.tenantId) {
          return { ok: false, summary: 'design_run_huashu needs tenant context', result: 'Error: missing tenantId.' };
        }
        const out = await runHuashu(parsed.data, { tenantId: ctx.tenantId, projectId: ctx.projectId });
        return {
          ok: out.ok,
          summary: out.summary,
          result:  JSON.stringify(out),
        };
      }

      case 'higgsfield_image':
      case 'higgsfield_video':
      case 'higgsfield_audio':
      case 'higgsfield_history': {
        if (!ctx.tenantId) {
          return { ok: false, summary: `${name} needs tenant context`, result: 'Error: missing tenantId.' };
        }

        // Same hard-gate as gen_image: refuse until index.html exists, so
        // the agent can't burn paid credits on assets for a site that
        // never gets written. History calls are a read-only catalogue
        // browse and don't need gating.
        if (name !== 'higgsfield_history') {
          const existing = await listWorkspaceFiles(ws);
          const hasEntry = existing.some((p) =>
            /\/(index\.html?|main\.tsx|main\.jsx)$/i.test(p),
          );
          if (!hasEntry) {
            return {
              ok: false,
              summary: `${name} refused — no index.html yet`,
              result:
                `Refused: write index.html FIRST (referencing the asset paths ` +
                `you plan to generate), then call ${name}. The site must ` +
                `render even if asset gen hits credit limits or model errors. ` +
                `Once index.html exists this gate releases.`,
            };
          }
        }
        const hf = await import('./tools/higgsfield');
        const hfCtx = { tenantId: ctx.tenantId, projectId: ctx.projectId, env: 'dev' };
        let out;
        if      (name === 'higgsfield_image')   out = await hf.execHiggsfieldImage(args, hfCtx);
        else if (name === 'higgsfield_video')   out = await hf.execHiggsfieldVideo(args, hfCtx);
        else if (name === 'higgsfield_audio')   out = await hf.execHiggsfieldAudio(args, hfCtx);
        else                                    out = await hf.execHiggsfieldHistory(args, hfCtx);
        return { ok: out.ok, summary: out.summary, result: out.result };
      }

      case 'video_summary':
      case 'video_list_clips':
      case 'video_cut_clip':
      case 'video_trim_clip':
      case 'video_delete_clip':
      case 'video_reorder_clips':
      case 'video_add_caption':
      case 'video_set_transition': {
        if (!ctx.tenantId) {
          return { ok: false, summary: `${name} needs tenant context`, result: 'Error: missing tenantId.' };
        }
        const ve = await import('./tools/video-edit');
        const out = await ve.execVideoEdit(name, args, { tenantId: ctx.tenantId });
        return { ok: out.ok, summary: out.summary, result: out.result };
      }

      default:
        return {
          ok: false,
          summary: `Unknown tool: ${name}`,
          result:  `Error: unknown tool "${name}". Available: ${AGENT_TOOLS.map((t) => t.function.name).join(', ')}`,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      summary: `${name} failed: ${msg}`,
      result:  `Error: ${msg}`,
    };
  }
}

// ── Capability-gated tool list ─────────────────────────────────────────────────
//
// The chat route calls this with the per-request feature flags. We return a
// filtered tool list so the model never sees tools the user hasn't opted in to.
// Higgsfield tools are added in Phase B (separate file); for now this function
// just handles the design (Huashu) case.

import { designRunHuashuToolDefinition } from './tools/design';
import { HIGGSFIELD_TOOL_DEFINITIONS } from './tools/higgsfield';
import { VIDEO_EDIT_TOOL_DEFINITIONS } from './tools/video-edit';

export interface GetToolsOpts {
  designSkillsEnabled?: boolean;
  higgsfieldEnabled?:   boolean;
  /** When the user is on the video editor screen, expose timeline ops. */
  videoEditEnabled?:    boolean;
}

export function getAgentTools(opts: GetToolsOpts = {}): ToolDefinition[] {
  const tools: ToolDefinition[] = [...AGENT_TOOLS];
  if (opts.designSkillsEnabled) tools.push(designRunHuashuToolDefinition as ToolDefinition);
  if (opts.higgsfieldEnabled)   tools.push(...HIGGSFIELD_TOOL_DEFINITIONS);
  if (opts.videoEditEnabled)    tools.push(...VIDEO_EDIT_TOOL_DEFINITIONS);
  return tools;
}
