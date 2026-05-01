// apps/api/src/preview/eventBus.ts — in-memory pub/sub for preview events.
//
// Used by the preview SSE channel (/api/preview/watch/:slug) so that when a
// file changes anywhere in the API, the connected web client can hot-reload
// its iframe. Keyed by `${tenantId}:${slug}` so tenants are fully isolated.
//
// In-memory by design: a Coolify migration may swap this for Redis Pub/Sub,
// but the interface stays identical (subscribe / emit / unsubscribe).

export interface PreviewEvent {
  type:      'file-changed' | 'session-status';
  path?:     string;
  status?:   string;
  at:        number;     // timestamp
}

type Listener = (ev: PreviewEvent) => void;

const channels = new Map<string, Set<Listener>>();

function key(tenantId: string, slug: string): string {
  return `${tenantId}:${slug}`;
}

/** Subscribe to events for a given tenant/slug. Returns an unsubscribe fn. */
export function subscribe(tenantId: string, slug: string, listener: Listener): () => void {
  const k = key(tenantId, slug);
  let set = channels.get(k);
  if (!set) {
    set = new Set();
    channels.set(k, set);
  }
  set.add(listener);

  return () => {
    const cur = channels.get(k);
    if (!cur) return;
    cur.delete(listener);
    if (cur.size === 0) channels.delete(k);
  };
}

/** Emit a preview event to all subscribers of a slug. */
export function emit(tenantId: string, slug: string, ev: Omit<PreviewEvent, 'at'>): void {
  const set = channels.get(key(tenantId, slug));
  if (!set || set.size === 0) return;
  const enriched: PreviewEvent = { ...ev, at: Date.now() };
  for (const listener of set) {
    try {
      listener(enriched);
    } catch {
      // never let one bad listener take down the rest
    }
  }
}

/** Diagnostic: how many subscribers for a slug right now. */
export function listenerCount(tenantId: string, slug: string): number {
  return channels.get(key(tenantId, slug))?.size ?? 0;
}
