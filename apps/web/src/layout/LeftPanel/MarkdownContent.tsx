// apps/web/src/layout/LeftPanel/MarkdownContent.tsx
// Renders chat message content as GitHub-flavored markdown with syntax-highlighted
// code blocks and a copy button. Plain-text fallback when content has no markdown.
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

export function MarkdownContent({ content, streaming = false }: MarkdownContentProps) {
  const isMd = useMemo(() => looksLikeMarkdown(content), [content]);

  if (!isMd) {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>;
  }

  return (
    <div className="abw-md">
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
        {content}
      </ReactMarkdown>
    </div>
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
