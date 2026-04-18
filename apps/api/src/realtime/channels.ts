// apps/api/src/realtime/channels.ts — Supabase Realtime broadcast helpers.
// Used by the orchestrator to push run events to the browser.
// Channel naming: `run:{runId}` — one channel per agent run.
// Events are broadcast to all subscribers (including the originating client).
import type { SupabaseClient } from '@supabase/supabase-js';

// Supabase client is injected to avoid top-level import (client init requires env).
let _supabase: SupabaseClient | null = null;

/** Inject the Supabase client (call once from server.ts after env is parsed). */
export function setRealtimeClient(client: SupabaseClient) {
  _supabase = client;
}

/** Channel name for a given run. */
export function runChannelName(runId: string): string {
  return `run:${runId}`;
}

/**
 * Broadcast a RunEvent to all subscribers on the run channel.
 * No-ops gracefully if the Supabase client is not configured
 * (e.g., in dev without SUPABASE_URL).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function broadcastRunEvent(runId: string, event: Record<string, any>): Promise<void> {
  if (!_supabase) return;
  try {
    const channel = _supabase.channel(runChannelName(runId));
    await channel.send({
      type:    'broadcast',
      event:   event.type,
      payload: event,
    });
  } catch (err: unknown) {
    // Non-fatal — log to stderr but don't crash the orchestrator
    process.stderr.write(`[realtime] broadcastRunEvent failed: ${String(err)}\n`);
  }
}

/**
 * Broadcast a raw payload to any named channel.
 * Used for non-run events (e.g., approval updates, file change notifications).
 */
export async function broadcastToChannel(
  channelName: string,
  eventName:   string,
  payload:     Record<string, unknown>,
): Promise<void> {
  if (!_supabase) return;
  try {
    const channel = _supabase.channel(channelName);
    await channel.send({ type: 'broadcast', event: eventName, payload });
  } catch {
    // Non-fatal
  }
}

/** Approval update channel — used by ApprovalsQueue to receive live badge counts. */
export function approvalChannelName(tenantId: string): string {
  return `approvals:${tenantId}`;
}
