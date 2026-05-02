// apps/web/src/layout/LeftPanel/MarkdownContent.tsx
// Renders chat message content as GitHub-flavored markdown with syntax-highlighted
// code blocks and a copy button. Plain-text fallback when content has no markdown.
//
// Also splits out reasoning-model `<think>...</think>` blocks into collapsible
// "Thinking…" details elements so they don't dominate the chat UI as raw text.
// (react-markdown escapes raw HTML by default, so we do the split in JS and feed
// only the prose segments to ReactMarkdown — no rehype-raw needed.)
import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

interface MarkdownContentProps {
  content: string;
  /** True when this is a streaming assistant message — we still parse markdown but disable code copy. */
  streaming?: boolean;
}

/**
 * Quick check: does the content contain anything markdown-y? If not, render as plain
 * text to avoid the cost of remark/rehype parsing (chat messages are frequent).
 */
function looksLikeMarkdown(s: string): boolean {
  return /(```|`[^`]|^#{1,6}\s|\*\*|__|^\s*[-*+]\s|^\s*\d+\.\s|\[[^\]]+\]\([^)]+\))/m.test(s);
}

/** A run of message content — either prose to feed to ReactMarkdown, or a
 *  reasoning block to render as a collapsible details element. */
type Segment =
  | { type: 'text';  body: string }
  | { type: 'think'; body: string; streaming: boolean };

/**
 * Walk `content` and split out any <think>…</think> blocks. Streaming SSE deltas
 * may yield an opening tag with no closing tag yet — in that case mark the tail
 * `streaming: true` so we render a "Thinking…" placeholder without dumping the
 * raw chain-of-thought into the UI.
 */
function splitThinkBlocks(content: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < content.length) {
    const open = content.indexOf('<think>', i);
    if (open === -1) {
      if (i < content.length) out.push({ type: 'text', body: content.slice(i) });
      break;
    }
    if (open > i) out.push({ type: 'text', body: content.slice(i, open) });
    const bodyStart = open + '<think>'.length;
    const close = content.indexOf('</think>', bodyStart);
    if (close === -1) {
      // Unclosed — still streaming. Capture body but mark partial.
      out.push({ type: 'think', body: content.slice(bodyStart), streaming: true });
      break;
    }
    out.push({ type: 'think', body: content.slice(bodyStart, close), streaming: false });
    i = close + '</think>'.length;
  }
  return out;
}

export function MarkdownContent({ content, streaming = false }: MarkdownContentProps) {
  const segments = useMemo(() => splitThinkBlocks(content), [content]);

  // Fast path: zero think blocks AND no markdown → return original plain-text span
  // unchanged (preserves whitespace; no React element churn).
  if (segments.length === 1 && segments[0]!.type === 'text' && !looksLikeMarkdown(segments[0]!.body)) {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{segments[0]!.body}</span>;
  }

  return (
    <div className="abw-md">
      {segments.map((seg, idx) =>
        seg.type === 'think' ? (
          <ThinkBlock key={idx} body={seg.body} streaming={seg.streaming} />
        ) : (
          <TextSegment key={idx} body={seg.body} streaming={streaming} />
        ),
      )}
    </div>
  );
}

/** Prose segment: markdown if it looks markdown-y, plain text otherwise. */
function TextSegment({ body, streaming }: { body: string; streaming: boolean }) {
  if (!body) return null;
  if (!looksLikeMarkdown(body)) {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{body}</span>;
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        // Code blocks get a header with language + copy. Inline code is just styled.
        pre: ({ children }) => <CodeBlock streaming={streaming}>{children}</CodeBlock>,
        code: ({ className, children, ...rest }) => (
          <code className={className} {...rest}>{children}</code>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
        ),
      }}
    >
      {body}
    </ReactMarkdown>
  );
}

/** Collapsible reasoning block. Default-closed when complete, open with a pulse
 *  while still streaming so the user sees progress. */
function ThinkBlock({ body, streaming }: { body: string; streaming: boolean }) {
  return (
    <details className="abw-md__think" open={streaming}>
      <summary>
        {streaming ? <span className="abw-md__think-pulse">Thinking…</span> : 'Thinking'}
      </summary>
      <div className="abw-md__think-body">
        <span style={{ whiteSpace: 'pre-wrap' }}>{body}</span>
      </div>
    </details>
  );
}

function CodeBlock({ children, streaming }: { children: React.ReactNode; streaming: boolean }) {
  const [copied, setCopied] = useState(false);

  // Pull lang + raw text from the inner <code> element for the copy button
  const { lang, raw } = useMemo(() => {
    let lang = '';
    let raw  = '';
    const inner = Array.isArray(children) ? children[0] : children;
    if (inner && typeof inner === 'object' && 'props' in inner) {
      const props = (inner as { props: { className?: string; children?: React.ReactNode } }).props;
      const m = /language-(\w+)/.exec(props.className ?? '');
      lang = m?.[1] ?? '';
      raw  = typeof props.children === 'string'
        ? props.children
        : Array.isArray(props.children)
          ? props.children.filter((c) => typeof c === 'string').join('')
          : '';
    }
    return { lang, raw };
  }, [children]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="abw-md__codeblock">
      <div className="abw-md__codeblock-header">
        <span className="abw-md__codeblock-lang">{lang || 'code'}</span>
        {!streaming && raw && (
          <button
            type="button"
            className="abw-md__codeblock-copy"
            onClick={handleCopy}
            aria-label="Copy code"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        )}
      </div>
      <pre>{children}</pre>
    </div>
  );
}
