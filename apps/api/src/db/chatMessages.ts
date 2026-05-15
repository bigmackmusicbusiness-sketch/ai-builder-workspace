// apps/api/src/db/chatMessages.ts — shared chat_messages persistence.
//
// Both the IDE-driven /api/chat path and the SPS-driven runChatTurn flow
// write conversation turns to the same `chat_messages` table. Centralizing
// the SQL here keeps the two paths in sync and stops divergence (the jsonb
// double-encode bug that bit us in round 14.6 happened because a writer
// duplicated the INSERT and got the param shape wrong).
//
// Round 15.1 (2026-05-15): the IDE path previously did NOT persist chat
// messages — IDE-side conversation history lived ONLY in the SPA's
// localStorage. Different browser, cleared cache, new device = lost chat.
// Backend the DB is supposed to be the source of truth; this module makes
// that real for the IDE path too. Both writes (append) and reads (load)
// flow through this module.
//
// All write functions are error-tolerant: they log and swallow on failure
// rather than throwing, so a transient DB blip can't take down the chat
// pipeline. Persistence is best-effort. Caller still has the live in-memory
// history for the current turn; the DB write is for replay.

import type { ToolCall } from '@abw/providers';
import { getRawSql } from './client';

export interface DbChatMessage {
  role:          'user' | 'assistant' | 'tool' | 'system';
  content:       string | null;
  tool_calls:    ToolCall[] | string | null;
  tool_call_id:  string | null;
  metadata?:     Record<string, unknown> | null;
  created_at?:   string;
}

export interface AppendUserOpts {
  projectId:    string;
  tenantId:     string;
  content:      string;
  agentRunId?:  string | null;
}

export interface AppendAssistantOpts {
  projectId:    string;
  tenantId:     string;
  content:      string | null;
  toolCalls?:   ToolCall[] | null;
  agentRunId?:  string | null;
}

export interface AppendToolOpts {
  projectId:    string;
  tenantId:     string;
  content:      string;
  toolCallId:   string;
  toolName:     string;
  agentRunId?:  string | null;
}

/** INSERT a user message into chat_messages. Best-effort: logs on failure
 *  and returns false rather than throwing. */
export async function appendUserMessage(opts: AppendUserOpts): Promise<boolean> {
  try {
    const sql = getRawSql();
    await sql.unsafe(
      `INSERT INTO chat_messages (project_id, tenant_id, role, content, agent_run_id)
       VALUES ($1, $2, 'user', $3, $4)`,
      [opts.projectId, opts.tenantId, opts.content, opts.agentRunId ?? null],
    );
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[chatMessages] appendUserMessage failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** INSERT an assistant message. `toolCalls` is jsonb — passed via
 *  `sql.json(...)` with no `::jsonb` cast (round 14.6 double-encode fix). */
export async function appendAssistantMessage(opts: AppendAssistantOpts): Promise<boolean> {
  try {
    const sql = getRawSql();
    const tcParam = opts.toolCalls && opts.toolCalls.length > 0
      ? sql.json(opts.toolCalls as unknown as Parameters<typeof sql.json>[0])
      : null;
    await sql.unsafe(
      `INSERT INTO chat_messages (project_id, tenant_id, role, content, tool_calls, agent_run_id)
       VALUES ($1, $2, 'assistant', $3, $4, $5)`,
      [opts.projectId, opts.tenantId, opts.content, tcParam, opts.agentRunId ?? null],
    );
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[chatMessages] appendAssistantMessage failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** INSERT a tool result. metadata.tool_name lets the UI render the tool
 *  badge (e.g. "Read index.html") even after the run is long gone. */
export async function appendToolMessage(opts: AppendToolOpts): Promise<boolean> {
  try {
    const sql = getRawSql();
    await sql.unsafe(
      `INSERT INTO chat_messages (project_id, tenant_id, role, content, tool_call_id, agent_run_id, metadata)
       VALUES ($1, $2, 'tool', $3, $4, $5, $6)`,
      [
        opts.projectId,
        opts.tenantId,
        opts.content,
        opts.toolCallId,
        opts.agentRunId ?? null,
        sql.json({ tool_name: opts.toolName }),
      ],
    );
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[chatMessages] appendToolMessage failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Load every chat message for a project, oldest first. Caps at 500 rows
 *  to keep response bodies sane — pagination can be added later if we
 *  ever ship long-running multi-month conversations. */
export async function loadProjectMessages(projectId: string): Promise<DbChatMessage[]> {
  try {
    const rows = await getRawSql().unsafe(
      `SELECT role, content, tool_calls, tool_call_id, metadata, created_at
         FROM chat_messages
        WHERE project_id = $1
        ORDER BY created_at ASC
        LIMIT 500`,
      [projectId],
    ) as Array<DbChatMessage>;
    return rows;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[chatMessages] loadProjectMessages failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
