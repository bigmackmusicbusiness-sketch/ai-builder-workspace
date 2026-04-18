// apps/api/src/security/audit.ts — append-only audit log writer.
// Every sensitive action calls audit.write(). Values are never included.
// Before/after state is represented as SHA-256 hashes only.
import { createHash } from 'node:crypto';
import { getDb } from '../db/client';
import { auditEvents } from '@abw/db';

export interface AuditEvent {
  tenantId:   string;
  actor?:     string;      // user UUID
  action:     string;      // 'deploy.production' | 'secret.rotate' | ...
  target?:    string;      // table or resource name
  targetId?:  string;
  env?:       string;
  before?:    unknown;     // will be hashed, never stored raw
  after?:     unknown;     // will be hashed, never stored raw
  approvalId?: string;
  runId?:     string;
  ip?:        string;
  ua?:        string;
}

export function hashState(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
}

export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  const db = getDb();
  await db.insert(auditEvents).values({
    tenantId:   event.tenantId,
    actor:      event.actor ?? null,
    action:     event.action,
    target:     event.target ?? null,
    targetId:   event.targetId ?? null,
    env:        event.env ?? null,
    beforeHash: event.before !== undefined ? hashState(event.before) : null,
    afterHash:  event.after  !== undefined ? hashState(event.after)  : null,
    approvalId: event.approvalId ?? null,
    runId:      event.runId ?? null,
    ip:         event.ip ?? null,
    ua:         event.ua ?? null,
  });
}
