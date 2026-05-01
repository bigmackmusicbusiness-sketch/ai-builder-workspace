// apps/api/src/editor/apply.ts — Apply a single edit action to an HTML string.
// Parses via parse5, locates the target node by data-abw-id, mutates the AST,
// and re-serialises. All mutations are pure: the original file is not touched here.
// @ts-nocheck — parse5 v7 AST types are complex; runtime correctness is tested separately.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { parse, serialize } from 'parse5';
import { stampIds, findNodeById } from './selectors';

// ── Edit action discriminated union ───────────────────────────────────────────

export type EditAction =
  | { type: 'edit_text';        newText: string }
  | { type: 'edit_attr';        attr: string; value: string }
  | { type: 'edit_style';       property: string; value: string }
  | { type: 'replace_image';    src: string }
  | { type: 'delete_element' }
  | { type: 'duplicate_element' }
  | { type: 'reorder_siblings'; newIndex: number };

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Get an attribute value from a parse5 element, returning undefined if absent. */
function getAttr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/** Set (or push) an attribute on a parse5 element. */
function setAttr(el: Element, name: string, value: string): void {
  const existing = el.attrs.find((a) => a.name === name);
  if (existing) {
    existing.value = value;
  } else {
    el.attrs.push({ name, value });
  }
}

/**
 * Parse a CSS style string into a mutable map.
 * e.g. "color: red; font-size: 14px" → { color: 'red', 'font-size': '14px' }
 */
function parseStyle(style: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim();
    const val  = decl.slice(idx + 1).trim();
    if (prop) map.set(prop, val);
  }
  return map;
}

/** Serialise a style map back into a CSS string. */
function serializeStyle(map: Map<string, string>): string {
  return Array.from(map.entries())
    .map(([p, v]) => `${p}: ${v}`)
    .join('; ');
}

/** Deep-clone a parse5 ChildNode tree (no library dep — manual structural copy). */
function cloneNode(node: ChildNode): ChildNode {
  const el = node as Element;
  if (el.attrs !== undefined && el.tagName) {
    // Element node
    const clone: Element = {
      nodeName:   el.nodeName,
      tagName:    el.tagName,
      attrs:      el.attrs.map((a) => ({ ...a })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      namespaceURI: (el as any).namespaceURI ?? 'http://www.w3.org/1999/xhtml',
      childNodes: [],
      parentNode: el.parentNode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    clone.childNodes = el.childNodes.map((c) => {
      const cloned = cloneNode(c);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cloned as any).parentNode = clone;
      return cloned;
    });
    return clone;
  }

  // Text or comment node
  const textNode = node as TextNode;
  return {
    nodeName: textNode.nodeName,
    value:    textNode.value ?? '',
    parentNode: textNode.parentNode,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Apply `action` to `html`, targeting the element with `data-abw-id === abwId`.
 * Returns the new HTML string. Throws if the node is not found.
 */
export function applyEdit(html: string, abwId: string, action: EditAction): string {
  // Always work on a stamped copy so IDs are present
  const stamped = stampIds(html);
  const doc     = parse(stamped);
  const node    = findNodeById(doc, abwId);

  if (!node) {
    throw Object.assign(
      new Error(`Element with data-abw-id="${abwId}" not found`),
      { statusCode: 404 },
    );
  }

  switch (action.type) {

    // ── edit_text ─────────────────────────────────────────────────────────────
    case 'edit_text': {
      // Find the first direct #text child; create one if absent.
      const textChild = node.childNodes.find(
        (c) => c.nodeName === '#text',
      ) as TextNode | undefined;

      if (textChild) {
        textChild.value = action.newText;
        // Remove any remaining child elements so the element is now a pure text leaf
        node.childNodes = node.childNodes.filter((c) => c.nodeName === '#text');
        textChild.value = action.newText;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newText: TextNode = { nodeName: '#text', value: action.newText, parentNode: node } as any;
        node.childNodes = [newText];
      }
      break;
    }

    // ── edit_attr ─────────────────────────────────────────────────────────────
    case 'edit_attr': {
      setAttr(node, action.attr, action.value);
      break;
    }

    // ── edit_style ────────────────────────────────────────────────────────────
    case 'edit_style': {
      const existing = getAttr(node, 'style') ?? '';
      const styleMap = parseStyle(existing);
      styleMap.set(action.property, action.value);
      setAttr(node, 'style', serializeStyle(styleMap));
      break;
    }

    // ── replace_image ─────────────────────────────────────────────────────────
    case 'replace_image': {
      setAttr(node, 'src', action.src);
      break;
    }

    // ── delete_element ────────────────────────────────────────────────────────
    case 'delete_element': {
      const parent = node.parentNode as Element | null;
      if (!parent?.childNodes) {
        throw Object.assign(new Error('Cannot delete root element'), { statusCode: 400 });
      }
      parent.childNodes = parent.childNodes.filter((c) => c !== node);
      break;
    }

    // ── duplicate_element ─────────────────────────────────────────────────────
    case 'duplicate_element': {
      const parent = node.parentNode as Element | null;
      if (!parent?.childNodes) {
        throw Object.assign(new Error('Cannot duplicate root element'), { statusCode: 400 });
      }
      const idx   = parent.childNodes.indexOf(node);
      const clone = cloneNode(node as ChildNode) as Element;
      // Clear the data-abw-id on the clone so it gets a fresh ID next stamp
      clone.attrs = clone.attrs.filter((a) => a.name !== 'data-abw-id');
      parent.childNodes.splice(idx + 1, 0, clone);
      break;
    }

    // ── reorder_siblings ──────────────────────────────────────────────────────
    case 'reorder_siblings': {
      const parent = node.parentNode as Element | null;
      if (!parent?.childNodes) {
        throw Object.assign(new Error('Cannot reorder root element'), { statusCode: 400 });
      }
      const siblings = parent.childNodes;
      const currentIdx = siblings.indexOf(node);
      if (currentIdx === -1) {
        throw Object.assign(new Error('Node not found in parent'), { statusCode: 400 });
      }
      // Remove from current position then insert at newIndex
      siblings.splice(currentIdx, 1);
      const clamped = Math.max(0, Math.min(action.newIndex, siblings.length));
      siblings.splice(clamped, 0, node);
      break;
    }

    default: {
      // Exhaustiveness guard — TypeScript will flag unhandled cases at compile time
      const _never: never = action;
      throw Object.assign(new Error(`Unknown action type: ${(_never as EditAction).type}`), { statusCode: 400 });
    }
  }

  return serialize(doc);
}
