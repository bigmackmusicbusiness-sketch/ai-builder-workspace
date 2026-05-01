// apps/api/src/lib/epub.ts — EPUB 3.0 generation via epub-gen-memory.
// Pure JS, no native deps. Returns an in-memory Buffer suitable for upload.

export interface EpubChapter {
  title:   string;
  content: string;   // HTML body content for the chapter
}

export interface EpubInput {
  title:       string;
  author:      string;
  description?: string;
  coverUrl?:   string;   // URL or data: URI for the front cover image
  language?:   string;   // default 'en'
  chapters:    EpubChapter[];
}

/**
 * Build an EPUB into a Buffer.
 * Uses epub-gen-memory, which streams XHTML + OPF + NAV + ZIP into memory.
 */
export async function renderEpub(input: EpubInput): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('epub-gen-memory');
  const epub = mod.default ?? mod.EPub ?? mod;

  const options = {
    title:         input.title,
    author:        input.author,
    description:   input.description ?? '',
    cover:         input.coverUrl,
    lang:          input.language ?? 'en',
    tocTitle:      'Contents',
    prependChapterTitles: true,
    css: `
      body { font-family: Georgia, serif; line-height: 1.6; font-size: 1.1em; }
      h1   { text-align: center; margin-top: 2em; font-size: 1.6em; }
      h2   { margin-top: 1.5em; }
      p    { text-indent: 1.5em; margin: 0 0 0.5em; text-align: justify; }
      p.first { text-indent: 0; }
      p.first::first-letter { font-size: 3em; float: left; line-height: 0.9; padding: 4px 6px 0 0; }
    `,
  };

  const chapters = input.chapters.map((c) => ({
    title:   c.title,
    content: c.content,
  }));

  // epub-gen-memory returns a Promise<Uint8Array|Buffer>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await epub(options, chapters);
  if (Buffer.isBuffer(result)) return result;
  if (result instanceof Uint8Array) return Buffer.from(result);
  if (result?.buffer)              return Buffer.from(result.buffer);
  throw new Error('EPUB builder returned unexpected result type');
}
