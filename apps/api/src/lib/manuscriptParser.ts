// apps/api/src/lib/manuscriptParser.ts — split user-provided manuscript into chapters.
// Used by POST /api/ebooks/format (the "I have my own text, just make it pretty" mode).
//
// The output shape matches `EbookChapter` from ebookBuilder.ts so buildEbookHtml() can
// consume it directly with no transformation.

import type { EbookChapter } from './ebookBuilder';

export type ChapterDelimiter = 'heading' | 'double_newline' | 'triple_newline' | 'manual';

/**
 * Parse a manuscript into chapters using the chosen delimiter strategy.
 *
 * - `heading` (recommended): finds Markdown headings (`# Chapter 1`, `## ...`) or the
 *   literal phrase "Chapter N" / "Chapter N:" / "CHAPTER N" at the start of a line.
 *   The line becomes the chapter title; everything until the next heading is prose.
 * - `double_newline`: split on `\n\n+`. Each block becomes its own chapter; first
 *   non-empty line of each block is treated as the title if it's < 80 chars.
 * - `triple_newline`: split on `\n{3,}`. Useful when the user separates chapters with
 *   bigger gaps and uses double-newlines for paragraphs inside a chapter.
 * - `manual`: split on the literal token `___CHAPTER___` (case-insensitive, on its
 *   own line). The next non-empty line after each token is the title.
 *
 * If the parser cannot find any chapter breaks, the entire manuscript is returned as a
 * single chapter titled "Chapter 1".
 */
export function parseManuscript(
  manuscript: string,
  delimiter: ChapterDelimiter,
): EbookChapter[] {
  const text = manuscript.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  switch (delimiter) {
    case 'heading':         return parseByHeading(text);
    case 'double_newline':  return parseByBlocks(text, /\n\n+/);
    case 'triple_newline':  return parseByBlocks(text, /\n{3,}/);
    case 'manual':          return parseByManualToken(text);
    default:                return parseByHeading(text);
  }
}

/** Quick chapter-count preview for the UI. Same logic as parseManuscript but cheap. */
export function previewChapterCount(
  manuscript: string,
  delimiter: ChapterDelimiter,
): number {
  return parseManuscript(manuscript, delimiter).length;
}

// ── Internal: heading-based parser ────────────────────────────────────────────

const HEADING_RE = /^(?:#{1,6}\s+.+|(?:chapter|prologue|epilogue|part)\s+[ivxlcdm0-9]+(?:\s*[:.\-—]\s*.*)?)\s*$/im;

function parseByHeading(text: string): EbookChapter[] {
  const lines = text.split('\n');
  const chapters: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (HEADING_RE.test(line)) {
      // Strip leading # marks for the title
      const title = line.replace(/^#{1,6}\s*/, '').trim();
      if (current) chapters.push(current);
      current = { title, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      // Content before the first heading — start an untitled chapter
      current = { title: 'Introduction', lines: [line] };
    }
  }
  if (current) chapters.push(current);

  if (chapters.length === 0) {
    return [{ title: 'Chapter 1', prose: text }];
  }

  return chapters
    .map((c) => ({
      title: c.title,
      prose: c.lines.join('\n').trim(),
    }))
    .filter((c) => c.prose.length > 0);
}

// ── Internal: block-based parser (double/triple newline) ──────────────────────

function parseByBlocks(text: string, splitRe: RegExp): EbookChapter[] {
  const blocks = text.split(splitRe).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) return [];
  if (blocks.length === 1) return [{ title: 'Chapter 1', prose: blocks[0]! }];

  return blocks.map((block, i) => {
    const lines = block.split('\n');
    const firstLine = lines[0]?.trim() ?? '';
    // If first line looks like a title (short, no period inside), use it as the chapter title
    const looksLikeTitle =
      firstLine.length > 0 &&
      firstLine.length < 80 &&
      !firstLine.match(/[.!?]\s/) &&
      lines.length > 1;

    if (looksLikeTitle) {
      return {
        title: firstLine.replace(/^#{1,6}\s*/, ''),
        prose: lines.slice(1).join('\n').trim(),
      };
    }
    return { title: `Chapter ${i + 1}`, prose: block };
  });
}

// ── Internal: manual-marker parser ────────────────────────────────────────────

function parseByManualToken(text: string): EbookChapter[] {
  const TOKEN = /^___CHAPTER___\s*$/im;
  const segments = text.split(TOKEN).map((s) => s.trim()).filter(Boolean);

  if (segments.length === 0) {
    return [{ title: 'Chapter 1', prose: text }];
  }

  return segments.map((seg, i) => {
    const lines = seg.split('\n');
    const firstLine = lines[0]?.trim() ?? '';
    const looksLikeTitle = firstLine.length > 0 && firstLine.length < 100 && lines.length > 1;
    if (looksLikeTitle) {
      return {
        title: firstLine.replace(/^#{1,6}\s*/, ''),
        prose: lines.slice(1).join('\n').trim(),
      };
    }
    return { title: `Chapter ${i + 1}`, prose: seg };
  });
}
