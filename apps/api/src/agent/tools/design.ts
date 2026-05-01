// apps/api/src/agent/tools/design.ts — Huashu Design skill agent tool.
//
// Wraps the Huashu CLI (installed at apps/api/.skills/huashu-design/) so the agent
// can call it with a structured brief and receive a public asset URL back.
// On Coolify the skill folder is baked into the API Docker image at build time.
//
// Skill repo: https://github.com/alchaincyf/huashu-design
// License: free for personal use; commercial use requires authorization. We surface
// this notice in the API response so callers can route accordingly.
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { uploadBufferAsAsset } from '../../lib/assetUpload';
import { readFile } from 'node:fs/promises';

export const RunHuashuInput = z.object({
  brief:            z.string().min(8).max(4000),
  output_kind:      z.enum(['html_prototype', 'pptx', 'mp4', 'gif', 'png', 'svg', 'infographic']),
  style_direction:  z.string().max(400).optional(),
  pages_or_seconds: z.number().int().positive().max(60).optional(),
});

export const RunHuashuOutput = z.object({
  ok:        z.boolean(),
  kind:      z.string(),
  assetUrl:  z.string().optional(),
  assetId:   z.string().optional(),
  summary:   z.string(),
  notice:    z.string().optional(),
});

export type RunHuashuInputType  = z.infer<typeof RunHuashuInput>;
export type RunHuashuOutputType = z.infer<typeof RunHuashuOutput>;

// Where the skill lives at runtime. install-skills.mjs puts it here at boot.
const SKILL_DIR = resolve(process.cwd(), '.skills', 'huashu-design');

/** Map our output_kind into the Huashu CLI's deliverable type. */
function mapKind(kind: RunHuashuInputType['output_kind']): { entry: string; ext: string; mime: string } {
  switch (kind) {
    case 'html_prototype': return { entry: 'prototype.html', ext: 'html', mime: 'text/html' };
    case 'pptx':           return { entry: 'deck.pptx',      ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    case 'mp4':            return { entry: 'animation.mp4',  ext: 'mp4',  mime: 'video/mp4' };
    case 'gif':            return { entry: 'animation.gif',  ext: 'gif',  mime: 'image/gif' };
    case 'png':            return { entry: 'design.png',     ext: 'png',  mime: 'image/png' };
    case 'svg':            return { entry: 'design.svg',     ext: 'svg',  mime: 'image/svg+xml' };
    case 'infographic':    return { entry: 'infographic.png', ext: 'png', mime: 'image/png' };
  }
}

export async function runHuashu(
  input: RunHuashuInputType,
  ctx:   { tenantId: string; projectId?: string | null },
): Promise<RunHuashuOutputType> {
  // Skill-not-installed branch: don't crash the agent; degrade gracefully.
  if (!existsSync(SKILL_DIR)) {
    return {
      ok: false,
      kind: input.output_kind,
      summary: 'Huashu skill is not installed on this server. Run `node apps/api/scripts/install-skills.mjs` to install, then retry.',
    };
  }

  const { entry, ext, mime } = mapKind(input.output_kind);
  const outDir = `/tmp/huashu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Build the brief text the skill consumes via stdin or a temp file.
  const briefText = [
    `# Brief`,
    input.brief,
    input.style_direction ? `\n## Style direction\n${input.style_direction}` : '',
    input.pages_or_seconds ? `\n## Length\n${input.pages_or_seconds}` : '',
    `\n## Output\n${input.output_kind}`,
  ].filter(Boolean).join('\n');

  const child = spawn('node', [
    join(SKILL_DIR, 'scripts', 'run.mjs'),
    '--out', outDir,
    '--kind', input.output_kind,
  ], {
    cwd: SKILL_DIR,
    env: { ...process.env, HUASHU_BRIEF: briefText },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Capture stderr for error reporting; let stdout drain to /dev/null.
  let stderr = '';
  child.stderr?.on('data', (c) => { stderr += c.toString(); });

  const code: number = await new Promise((resolveExit) => {
    child.on('close', (c) => resolveExit(c ?? 1));
    child.on('error', () => resolveExit(1));
  });

  if (code !== 0) {
    return {
      ok: false,
      kind: input.output_kind,
      summary: `Huashu run failed (exit ${code}): ${stderr.slice(0, 240) || 'no stderr'}.`,
    };
  }

  const outFile = join(outDir, entry);
  if (!existsSync(outFile)) {
    return {
      ok: false,
      kind: input.output_kind,
      summary: `Huashu finished but did not produce expected output ${entry}.`,
    };
  }

  const buffer = await readFile(outFile);
  const upload = await uploadBufferAsAsset({
    tenantId:  ctx.tenantId,
    projectId: ctx.projectId ?? null,
    folder:    `designs/huashu`,
    filename:  `${Date.now()}.${ext}`,
    mimeType:  mime,
    buffer,
  });

  return {
    ok:       true,
    kind:     input.output_kind,
    assetUrl: upload.url,
    assetId:  upload.assetId,
    summary:  `Generated ${input.output_kind} (${(buffer.length / 1024).toFixed(1)} KB).`,
    notice:   'Huashu Design is free for personal use. For commercial deployment, contact alchaincyf for licensing.',
  };
}

export const designRunHuashuToolDefinition = {
  type: 'function' as const,
  function: {
    name:        'design_run_huashu',
    description: 'Generate a high-fidelity visual deliverable (prototype, slide deck, animation, infographic) using the Huashu Design skill. Use this when the user asks for designs, mockups, slides, presentations, prototypes, or animated explainers — NOT for production app code.',
    parameters: {
      type: 'object',
      properties: {
        brief: {
          type:        'string',
          description: 'Natural-language brief for the deliverable. Be specific about audience, intent, and style notes.',
        },
        output_kind: {
          type: 'string',
          enum: ['html_prototype', 'pptx', 'mp4', 'gif', 'png', 'svg', 'infographic'],
          description: 'The output format. html_prototype = interactive multi-screen demo; pptx = editable slide deck; mp4/gif = motion graphic; png/svg = static image; infographic = data-rich PNG.',
        },
        style_direction: {
          type:        'string',
          description: 'Optional style guidance — e.g. "editorial serif, muted earth tones" or "bold sans, neon accents".',
        },
        pages_or_seconds: {
          type:        'integer',
          description: 'For decks: slide count (3-30). For mp4/gif: duration in seconds (3-60). Ignored for static formats.',
        },
      },
      required: ['brief', 'output_kind'],
    },
  },
};
