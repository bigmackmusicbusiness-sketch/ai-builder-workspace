// apps/api/src/lib/ebookBuilder.ts — assemble full HTML for eBook styles.
// Each style has its own stylesheet. Produces a self-contained HTML doc with:
//   cover page → front matter (novels) → TOC → chapters → back matter (novels)

export type EbookStyle =
  | 'professional_business' | 'lead_magnet' | 'narrative_story' | 'how_to_guide'
  | 'academic' | 'cookbook' | 'kdp_novel' | 'picture_book';

export interface EbookChapter {
  title: string;
  summary?: string;
  prose: string;        // already humanized; may contain paragraph breaks
  heroImageUrl?: string; // lead_magnet / picture_book only
}

export interface EbookFrontMatter {
  copyright?:  string;
  dedication?: string;
  foreword?:   string;
}

export interface EbookBackMatter {
  aboutAuthor?: string;
  alsoBy?:      string[];
}

export interface EbookRecord {
  title:        string;
  subtitle?:    string;
  author:       string;
  style:        EbookStyle;
  genre?:       string;
  chapters:     EbookChapter[];
  coverUrl?:    string;
  frontMatter?: EbookFrontMatter;
  backMatter?:  EbookBackMatter;
}

/** Get PDF trim/format for a style. Consumed by pdf.ts via `{ format }`. */
export function styleToTrim(style: EbookStyle):
  'A4' | 'Letter' | '6x9' | '8.5x8.5' | '7x10' | '8.5x11' {
  switch (style) {
    case 'kdp_novel':         return '6x9';
    case 'narrative_story':   return '6x9';
    case 'professional_business': return '6x9';
    case 'academic':          return '6x9';
    case 'cookbook':          return '7x10';
    case 'picture_book':      return '8.5x8.5';
    case 'lead_magnet':
    case 'how_to_guide':
    default:                  return '8.5x11';
  }
}

interface StyleCss { cover: string; chapter: string; globals: string }

// Shared baseline applied on top of every style. Sets readable defaults
// (line-height, paragraph rhythm, page rules) so that even a sparse style
// like `professional_business` produces a polished result.
const SHARED_GLOBALS = `
  @page { margin: 0.85in; }
  html, body { margin: 0; padding: 0; }
  body { line-height: 1.6; font-size: 11.5pt; }
  h1, h2, h3 { page-break-after: avoid; }
  p   { margin: 0 0 0.7em; orphans: 3; widows: 3; }
  ul, ol { margin: 0 0 0.7em 1.5em; }
  blockquote { margin: 1em 1.5em; font-style: italic; color: #444; }
  figure { margin: 1.5em 0; text-align: center; }
  figure img { max-width: 100%; max-height: 60vh; }
  .chapter-page { page-break-before: always; padding: 0; }
  .chapter-num  { display: block; font-size: 0.75em; letter-spacing: 0.25em; text-transform: uppercase; opacity: 0.6; margin-bottom: 0.6em; }
  .chapter-title{ display: block; font-weight: 600; }
`;

const STYLES: Record<EbookStyle, StyleCss> = {
  professional_business: {
    globals: `body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a2e; }
              h1 { color:#e94560; border-bottom: 2px solid #e94560; padding-bottom: 0.4em; margin: 0 0 1.2em; font-size: 1.9em; }`,
    cover:   `background: linear-gradient(180deg,#1a1a2e 0%,#16213e 100%); color:#fff; text-align:center; padding: 35% 12% 20%; border-bottom: 6px solid #e94560;`,
    chapter: `p { text-align: justify; }`,
  },
  lead_magnet: {
    globals: `body { font-family: 'Inter', Arial, sans-serif; color: #1a1a2e; }
              h1 { color: #fff; background: linear-gradient(90deg,#6c63ff,#ff6584); padding: 22px 28px; border-radius: 10px; margin: 0 0 1.4em; font-size: 1.8em; }
              h2 { color: #6c63ff; margin: 1.4em 0 0.6em; }`,
    cover:   `background: linear-gradient(135deg,#6c63ff 0%,#ff6584 100%); color:#fff; padding: 30% 10%; text-align:center;`,
    chapter: `.callout { background:#f3f0ff; border-left:4px solid #6c63ff; padding:16px 20px; margin:1.4em 0; border-radius: 4px; }`,
  },
  narrative_story: {
    globals: `body { font-family: 'EB Garamond', Palatino, 'Book Antiqua', Georgia, serif; color:#2c1810; background:#faf6ef; font-size: 12pt; }
              h1 { text-align:center; font-weight:400; letter-spacing:0.05em; font-size: 1.6em; margin: 2.5em 0 1.5em; }
              p { text-indent: 1.5em; text-align: justify; }
              p.first { text-indent: 0; }
              p.first::first-letter { font-size: 4em; float:left; line-height: 0.9; padding: 0.05em 0.1em 0 0; color:#7a3a1c; font-weight: 500; }
              .scene-break { text-align: center; margin: 2em 0; letter-spacing: 1.2em; opacity: 0.6; }`,
    cover:   `background:#faf6ef; color:#2c1810; padding: 35% 12% 25%; text-align:center; border: 12px double #2c1810;`,
    chapter: ``,
  },
  how_to_guide: {
    globals: `body { font-family: 'Source Sans Pro', Arial, sans-serif; color:#1a1a2e; }
              h1 { color:#0f4c75; border-bottom: 3px solid #1b9aaa; padding-bottom: 0.4em; margin: 0 0 1em; font-size: 1.9em; }
              h2 { color:#1b9aaa; margin: 1.5em 0 0.5em; }`,
    cover:   `background:linear-gradient(160deg,#0f4c75 0%,#1b9aaa 100%); color:#fff; padding: 30% 10%; text-align:center;`,
    chapter: `.step { counter-increment:step; background:#ecf4fb; border-radius:8px; padding:18px 22px; margin:1.2em 0; }
              .step::before { content: 'Step ' counter(step) ': '; font-weight:700; color:#1b9aaa; }`,
  },
  academic: {
    globals: `body { font-family: 'Times New Roman', Times, serif; color:#000; font-size: 12pt; line-height: 1.7; }
              @page { @top-center { content: string(book-title); font-size: 9pt; color: #555; } @bottom-center { content: counter(page); font-size: 9pt; } }
              h1 { string-set: book-title content(); text-align:center; text-transform:uppercase; letter-spacing:0.1em; font-weight:400; font-size: 1.4em; margin: 0 0 2em; }
              p { text-indent: 2em; text-align: justify; }`,
    cover:   `background:#fff; color:#000; padding: 30% 10%; text-align:center; border: 2px solid #000;`,
    chapter: ``,
  },
  cookbook: {
    globals: `body { font-family: 'Lato', Arial, sans-serif; color:#3a2015; background:#fbf3e2; }
              h1 { color:#c84b31; font-weight: 700; margin: 0 0 1em; font-size: 2em; }
              h2 { color:#c84b31; margin: 1.4em 0 0.5em; }`,
    cover:   `background:#c84b31; color:#fbf3e2; padding: 30% 10%; text-align:center;`,
    chapter: `.recipe { background:#fff; border:2px solid #c84b31; border-radius:10px; padding:22px 26px; margin:1.4em 0; box-shadow: 0 2px 8px rgba(200,75,49,0.08); }`,
  },
  kdp_novel: {
    globals: `body { font-family: 'EB Garamond', Garamond, 'Times New Roman', serif; font-size: 11pt; line-height: 1.5; color: #000; }
              @page { margin: 0.75in 0.75in 0.75in 0.875in; @top-center { content: string(book-title); font-size: 9pt; font-style: italic; color: #555; } @bottom-center { content: counter(page); font-size: 9pt; } }
              h1 { page-break-before: always; text-align:center; font-weight: 400; font-size: 1.6em; margin-top: 2in; margin-bottom: 1em; letter-spacing: 0.08em; string-set: book-title content(); }
              p { text-indent: 1.5em; text-align: justify; margin: 0 0 0.2em; orphans: 3; widows: 3; }
              p.first { text-indent: 0; }
              p.first::first-letter { font-size: 3.2em; float: left; line-height: 0.85; padding: 4px 8px 0 0; font-weight: 500; }
              .scene-break { text-align: center; margin: 1.5em 0; letter-spacing: 0.8em; }`,
    cover:   `background: radial-gradient(ellipse at center,#1a1a2a 0%,#0a0a14 100%); color:#f5e6c8; padding: 30% 10% 18%; text-align:center; font-family: 'EB Garamond', serif; border-top: 6px solid #c9a050; border-bottom: 6px solid #c9a050;`,
    chapter: ``,
  },
  picture_book: {
    globals: `body { font-family: 'Comfortaa', Avenir, Arial, sans-serif; color:#1a1a2e; margin:0; }`,
    cover:   `padding:0; height:100vh; background-size:cover; background-position:center;`,
    chapter: `.spread { page-break-after: always; min-height: 100vh; display:flex; align-items:center; justify-content:center; flex-direction:column; padding: 5%; }
              .spread img { max-width: 100%; max-height: 80vh; }
              .caption { font-size: 1.3em; padding: 18px 32px; text-align:center; line-height: 1.4; }`,
  },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

function paragraphs(prose: string, isNovel: boolean): string {
  const paras = prose.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paras
    .map((p, i) => {
      const cls = isNovel && i === 0 ? ' class="first"' : '';
      return `<p${cls}>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');
}

/** Build a full HTML document ready for Puppeteer PDF rendering. */
export function buildEbookHtml(record: EbookRecord): string {
  const cssKey = record.style;
  const css = STYLES[cssKey] ?? STYLES.professional_business;
  const isNovel = record.style === 'kdp_novel' || record.style === 'narrative_story';
  const isPictureBook = record.style === 'picture_book';

  const googleFonts =
    `<link rel="preconnect" href="https://fonts.googleapis.com">` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600&family=Inter:wght@400;600;700&family=Lato:wght@400;700&family=Source+Sans+Pro:wght@400;700&family=Comfortaa:wght@400;700&display=swap" rel="stylesheet">`;

  const coverBg = isPictureBook && record.coverUrl
    ? `background-image:url('${record.coverUrl}');`
    : '';

  const coverPage = isPictureBook && record.coverUrl
    ? `<section class="cover" style="${css.cover}${coverBg}"></section>`
    : `<section class="cover" style="${css.cover}">
         ${record.coverUrl
           ? `<figure style="margin: 0 auto 2em; max-width: 70%;"><img src="${record.coverUrl}" style="max-width: 100%; max-height: 50vh; box-shadow: 0 8px 24px rgba(0,0,0,0.35);" alt="" /></figure>`
           : ''}
         <h1 style="font-size: 2.6em; font-weight: 600; margin: 0 0 0.4em; line-height: 1.15;">${escapeHtml(record.title)}</h1>
         ${record.subtitle ? `<p style="font-size: 1.1em; margin: 0 0 2.5em; opacity: 0.85; font-style: italic;">${escapeHtml(record.subtitle)}</p>` : '<div style="margin-bottom: 2.5em;"></div>'}
         <p style="margin: 0; letter-spacing: 0.3em; font-size: 0.85em; text-transform: uppercase;">${escapeHtml(record.author)}</p>
       </section>`;

  // Front matter (novels only)
  let frontMatter = '';
  if (isNovel && record.frontMatter) {
    const fm = record.frontMatter;
    if (fm.copyright) {
      frontMatter += `<section style="page-break-before:always; padding:40% 15%; text-align:center; font-size:0.85em; color:#444;">${escapeHtml(fm.copyright)}</section>`;
    }
    if (fm.dedication) {
      frontMatter += `<section style="page-break-before:always; padding:40% 15%; text-align:center; font-style:italic;">${escapeHtml(fm.dedication)}</section>`;
    }
    if (fm.foreword) {
      frontMatter += `<section style="page-break-before:always; padding:20% 10%;"><h2 style="text-align:center;">Foreword</h2><p>${escapeHtml(fm.foreword).replace(/\n\n/g, '</p><p>')}</p></section>`;
    }
  }

  // TOC — clean, with leader dots between title and page (visual-only; PDF can't compute true page numbers without paged.js)
  const tocItems = record.chapters
    .map((c, i) => `
      <li style="display: flex; align-items: baseline; gap: 0.6em; margin: 0.4em 0;">
        <span>${i + 1}.</span>
        <span style="flex: 1 1 auto;">${escapeHtml(c.title)}</span>
        <span style="flex: 0 0 auto; opacity: 0.5; letter-spacing: 0.3em; overflow: hidden; max-width: 30%;">. . . . . . . . . . . . . . . . . . . . . . . . . . .</span>
      </li>`)
    .join('');
  const toc = isPictureBook ? '' : `<section style="page-break-before: always; padding: 8% 10%;">
    <h2 style="text-align:center; font-weight: 400; letter-spacing: 0.15em; text-transform: uppercase; font-size: 1.2em; margin-bottom: 2em;">Contents</h2>
    <ol style="list-style: none; padding: 0; margin: 0;">${tocItems}</ol>
  </section>`;

  // Chapters
  const chapterHtml = record.chapters
    .map((c, i) => {
      const hero = c.heroImageUrl
        ? `<figure><img src="${c.heroImageUrl}" alt="${escapeHtml(c.title)}" /></figure>`
        : '';

      if (isPictureBook) {
        return `<section class="spread">
          ${hero}
          <div class="caption">${escapeHtml(c.title)}</div>
          ${paragraphs(c.prose, false)}
        </section>`;
      }

      // Novels (kdp_novel, narrative_story) get the cleaner inline title
      // (their CSS already styles h1 for chapter pages with margin-top: 2in etc).
      // Non-novel styles get the more visual two-line title with "CHAPTER N" eyebrow.
      const titleBlock = isNovel
        ? `<h1>${escapeHtml(c.title)}</h1>`
        : `<h1>
             <span class="chapter-num">Chapter ${i + 1}</span>
             <span class="chapter-title">${escapeHtml(c.title)}</span>
           </h1>`;

      return `<section class="chapter-page">
        ${titleBlock}
        ${hero}
        ${paragraphs(c.prose, isNovel)}
      </section>`;
    })
    .join('\n');

  // Back matter (novels)
  let backMatter = '';
  if (isNovel && record.backMatter) {
    const bm = record.backMatter;
    if (bm.aboutAuthor) {
      backMatter += `<section style="page-break-before:always; padding:15% 12%;"><h2 style="text-align:center;">About the Author</h2><p>${escapeHtml(bm.aboutAuthor).replace(/\n\n/g, '</p><p>')}</p></section>`;
    }
    if (bm.alsoBy?.length) {
      backMatter += `<section style="page-break-before:always; padding:15% 12%; text-align:center;"><h2>Also by ${escapeHtml(record.author)}</h2><ul style="list-style:none; padding:0; font-style:italic;">${bm.alsoBy.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul></section>`;
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(record.title)}</title>
${googleFonts}
<style>
  * { box-sizing: border-box; }
  ${SHARED_GLOBALS}
  ${css.globals}
  ${css.chapter}
  section { page-break-inside: auto; }
  /* Non-novel chapter pages need internal padding (novels handle margins via @page) */
  ${isNovel || isPictureBook ? '' : '.chapter-page { padding: 1.5in 0.85in 1in; }'}
</style>
</head>
<body>
${coverPage}
${frontMatter}
${toc}
${chapterHtml}
${backMatter}
</body>
</html>`;
}

/** Build chapters in EPUB format (simple semantic HTML, no page breaks). */
export function buildEpubChapters(record: EbookRecord): { title: string; content: string }[] {
  const isNovel = record.style === 'kdp_novel' || record.style === 'narrative_story';
  return record.chapters.map((c) => {
    const hero = c.heroImageUrl ? `<figure><img src="${c.heroImageUrl}" alt="${escapeHtml(c.title)}"/></figure>` : '';
    return {
      title: c.title,
      content: `${hero}${paragraphs(c.prose, isNovel)}`,
    };
  });
}
