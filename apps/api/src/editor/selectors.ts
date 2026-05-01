// apps/api/src/editor/selectors.ts — parse5 AST helpers for the Visual Editor.
// stampIds:     Walks every element in an HTML document and adds a unique
//               data-abw-id attribute so the editor runtime can address nodes.
// findNodeById: Locates a node by its data-abw-id value for mutation.
// @ts-nocheck — parse5 v7 AST types are complex; runtime correctness is tested separately.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { parse, serialize } from 'parse5';

// ── Internal walker ────────────────────────────────────────────────────────────

/**
 * Recursively walk a parse5 AST, calling `visit` on every Element node
 * (i.e. nodes that have attrs; #text, #comment, #document are skipped).
 */
function walkElements(node: ChildNode | Document, visit: (el: Element) => void): void {
  // Determine if this node is an Element (has attrs array)
  const el = node as Element;
  if (el.attrs !== undefined) {
    visit(el);
  }

  const withChildren = node as { childNodes?: ChildNode[] };
  if (withChildren.childNodes) {
    for (const child of withChildren.childNodes) {
      walkElements(child, visit);
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Stamp every element in a parsed HTML document with a unique `data-abw-id`
 * attribute (0-based integer counter, document order).
 * Returns the modified HTML string.
 */
export function stampIds(html: string): string {
  const doc = parse(html);
  let counter = 0;

  walkElements(doc, (el) => {
    // Skip non-content nodes (parse5 wraps #document-fragment etc.)
    if (!el.tagName) return;

    // Remove any pre-existing data-abw-id to ensure IDs are stable and unique
    // relative to the current parse (re-stamp on every serve).
    el.attrs = el.attrs.filter((a) => a.name !== 'data-abw-id');
    el.attrs.push({ name: 'data-abw-id', value: String(counter++) });
  });

  return serialize(doc);
}

/**
 * Find a node in a parse5 document by its `data-abw-id` attribute value.
 * Returns null if not found.
 */
export function findNodeById(doc: Document, id: string): Element | null {
  let found: Element | null = null;

  walkElements(doc, (el) => {
    if (found) return;
    const attr = el.attrs.find((a) => a.name === 'data-abw-id');
    if (attr?.value === id) {
      found = el;
    }
  });

  return found;
}

// ── Tree serialization for the UI element panel ─────────────────────────────

export interface ElementTreeNode {
  id:       string;      // data-abw-id (or '' for unstamped)
  tag:      string;
  text?:    string;      // up to 48 chars of directly-contained text
  classes?: string[];
  children: ElementTreeNode[];
}

/**
 * Build a JSON tree of the document's <body> subtree for the Element Tree sidebar.
 * Skips text and comment nodes; keeps only elements.
 */
export function buildTree(html: string): ElementTreeNode | null {
  const doc = parse(html);
  let body: Element | null = null;
  walkElements(doc, (el) => { if (!body && el.tagName === 'body') body = el; });
  if (!body) return null;

  function toTree(n: Element): ElementTreeNode {
    const idAttr  = n.attrs.find((a) => a.name === 'data-abw-id');
    const clsAttr = n.attrs.find((a) => a.name === 'class');
    const children: ElementTreeNode[] = [];
    let textBuf = '';
    const withKids = n as unknown as { childNodes?: ChildNode[] };
    for (const c of withKids.childNodes ?? []) {
      if ((c as { nodeName?: string }).nodeName === '#text') {
        textBuf += (c as unknown as { value?: string }).value ?? '';
      } else if ((c as Element).tagName) {
        children.push(toTree(c as Element));
      }
    }
    const text = textBuf.trim().slice(0, 48);
    const out: ElementTreeNode = {
      id:  idAttr?.value ?? '',
      tag: n.tagName ?? 'x',
      children,
    };
    if (text) out.text = text;
    if (clsAttr?.value) out.classes = clsAttr.value.split(/\s+/).filter(Boolean);
    return out;
  }

  return toTree(body);
}

/** Count total descendant elements beneath a node (for approval gate on deletes). */
export function countDescendants(el: Element): number {
  let n = 0;
  walkElements(el, () => { n++; });
  return n - 1; // exclude self
}

/** Get/set/remove attribute helpers exported for apply.ts. */
export function getAttr(el: Element, name: string): string | null {
  const a = el.attrs.find((x) => x.name === name);
  return a ? a.value : null;
}
export function setAttr(el: Element, name: string, value: string): void {
  const existing = el.attrs.find((x) => x.name === name);
  if (existing) existing.value = value;
  else el.attrs.push({ name, value });
}
export function removeAttrByName(el: Element, name: string): void {
  el.attrs = el.attrs.filter((x) => x.name !== name);
}

export { walkElements };
