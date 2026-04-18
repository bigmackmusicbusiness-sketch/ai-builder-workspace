// apps/api/src/security/approvalMatrix.ts — server-side approval decision engine.
//
// CRITICAL: This is the only authoritative gate. UI bypass attempts go through
// routes that call checkApproval() before executing any sensitive action.
// No client-supplied field can skip this check.
//
// Rule: requiresApproval = true → caller MUST supply an existing approved
//       approvals row ID; the route validates it before proceeding.

import { getDb } from '../db/client';
import { approvals } from '@abw/db';
import { eq, and } from 'drizzle-orm';

// ── Action catalog ────────────────────────────────────────────────────────────

export type ApprovalAction =
  | 'deploy.production'
  | 'deploy.staging'
  | 'migration.apply.staging'
  | 'migration.apply.production'
  | 'migration.rollback.staging'
  | 'migration.rollback.production'
  | 'secret.create'
  | 'secret.rotate'
  | 'secret.delete'
  | 'integration.connect'
  | 'integration.reconnect'
  | 'integration.disconnect'
  | 'automation.run.live'        // browser automation against live customer accounts
  | 'automation.bulk'            // bulk outbound automation
  | 'delete.destructive'         // bulk deletes
  | 'rewrite.broad'              // file/line count above threshold
  | 'auth.model.change'          // auth / permission model modifications
  | 'publish.live'               // publish to a live public URL
  | 'schema.apply.production';

export type ApprovalEnvironment = 'dev' | 'staging' | 'preview' | 'production';

export interface ApprovalRequest {
  action:    ApprovalAction;
  env:       ApprovalEnvironment;
  tenantId:  string;
  projectId: string;
  requestedBy: string;
  /** Context about what this action would do (shown in approval bundle UI) */
  scope?: string;
  /** Scale indicators */
  scale?: {
    filesChanged?: number;
    linesChanged?: number;
    recordsAffected?: number;
  };
}

export interface ApprovalDecision {
  requiresApproval: boolean;
  reason:           string;
  /** When requiresApproval, the action description for the bundle UI */
  bundleSpec?: {
    action:      ApprovalAction;
    env:         ApprovalEnvironment;
    description: string;
    severity:    'info' | 'warning' | 'critical';
  };
}

// ── Decision matrix ───────────────────────────────────────────────────────────

// Configurable thresholds
const BROAD_REWRITE_FILES = 10;
const BROAD_REWRITE_LINES = 500;

export function checkApproval(req: ApprovalRequest): ApprovalDecision {
  const { action, env, scale } = req;

  // ── Always-required actions ────────────────────────────────────────────────

  if (action === 'deploy.production' || action === 'publish.live') {
    return {
      requiresApproval: true,
      reason: `Production deploy / live publish always requires approval`,
      bundleSpec: {
        action, env, severity: 'critical',
        description: `Deploy to production — irreversible without rollback`,
      },
    };
  }

  if (action === 'migration.apply.production' || action === 'schema.apply.production') {
    return {
      requiresApproval: true,
      reason: `Schema migrations on production always require approval`,
      bundleSpec: {
        action, env, severity: 'critical',
        description: `Apply migration to production database`,
      },
    };
  }

  if (action === 'migration.apply.staging' || action === 'migration.rollback.staging'
      || action === 'migration.rollback.production') {
    return {
      requiresApproval: true,
      reason: `Database migrations on staging/production require approval`,
      bundleSpec: {
        action, env, severity: 'warning',
        description: `Apply / rollback migration on ${env}`,
      },
    };
  }

  if (action === 'secret.create' || action === 'secret.rotate' || action === 'secret.delete') {
    if (env === 'production') {
      return {
        requiresApproval: true,
        reason: `Secret management on production requires approval`,
        bundleSpec: {
          action, env, severity: 'critical',
          description: `${action.split('.')[1]} secret in production environment`,
        },
      };
    }
    // Non-production secret changes are gate-free
  }

  if (action === 'integration.connect' || action === 'integration.reconnect'
      || action === 'integration.disconnect') {
    return {
      requiresApproval: true,
      reason: `Integration credential changes always require approval`,
      bundleSpec: {
        action, env, severity: 'warning',
        description: `${action.split('.')[1]} third-party integration`,
      },
    };
  }

  if (action === 'automation.run.live') {
    return {
      requiresApproval: true,
      reason: `Browser automation against live customer accounts always requires approval`,
      bundleSpec: {
        action, env, severity: 'critical',
        description: `Run browser automation on live customer account`,
      },
    };
  }

  if (action === 'automation.bulk') {
    return {
      requiresApproval: true,
      reason: `Bulk outbound automation always requires approval`,
      bundleSpec: {
        action, env, severity: 'warning',
        description: `Bulk automation run (${scale?.recordsAffected ?? 'many'} records)`,
      },
    };
  }

  if (action === 'auth.model.change') {
    return {
      requiresApproval: true,
      reason: `Auth / permission model changes always require approval`,
      bundleSpec: {
        action, env, severity: 'critical',
        description: `Modify authentication or permission model`,
      },
    };
  }

  if (action === 'delete.destructive') {
    return {
      requiresApproval: true,
      reason: `Destructive deletes require approval`,
      bundleSpec: {
        action, env, severity: 'warning',
        description: `Destructive delete (${scale?.recordsAffected ?? 'many'} records)`,
      },
    };
  }

  if (action === 'rewrite.broad') {
    const tooManyFiles = (scale?.filesChanged ?? 0) > BROAD_REWRITE_FILES;
    const tooManyLines = (scale?.linesChanged ?? 0) > BROAD_REWRITE_LINES;
    if (tooManyFiles || tooManyLines) {
      return {
        requiresApproval: true,
        reason: `Broad rewrite (${scale?.filesChanged ?? 0} files, ${scale?.linesChanged ?? 0} lines) exceeds threshold`,
        bundleSpec: {
          action, env, severity: 'warning',
          description: `Large rewrite: ${scale?.filesChanged ?? 0} files / ${scale?.linesChanged ?? 0} lines changed`,
        },
      };
    }
  }

  if (action === 'deploy.staging') {
    // Staging deploy is warning-level but does NOT require approval by default
    // Projects can opt-in via project policy (future: per-project policy table)
  }

  // ── Safe: no approval needed ───────────────────────────────────────────────
  return {
    requiresApproval: false,
    reason: 'Action is within allowed scope — no approval required',
  };
}

// ── Server-side approval validation ──────────────────────────────────────────

export interface ValidateApprovalResult {
  valid:   boolean;
  reason:  string;
  approval?: {
    id:         string;
    action:     string;
    status:     string;
    reviewedBy: string | null;
  };
}

/**
 * Validates that an approval row exists, belongs to this tenant/project,
 * and has status = 'approved'. Called by every route that requires approval.
 */
export async function validateApproval(
  approvalId: string,
  opts: { tenantId: string; projectId: string; action: ApprovalAction },
): Promise<ValidateApprovalResult> {
  const db = getDb();

  const [row] = await db.select()
    .from(approvals)
    .where(and(
      eq(approvals.id, approvalId),
      eq(approvals.tenantId, opts.tenantId),
    ))
    .limit(1);

  if (!row) {
    return { valid: false, reason: 'Approval record not found' };
  }

  if (row.projectId !== opts.projectId) {
    return { valid: false, reason: 'Approval belongs to a different project' };
  }

  if (row.action !== opts.action) {
    return { valid: false, reason: `Approval is for action '${row.action}', not '${opts.action}'` };
  }

  if (row.status !== 'approved') {
    return { valid: false, reason: `Approval status is '${row.status}' — must be 'approved'` };
  }

  if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
    return { valid: false, reason: 'Approval has expired' };
  }

  return {
    valid: true,
    reason: 'Approval valid',
    approval: {
      id:         row.id,
      action:     row.action,
      status:     row.status,
      reviewedBy: row.reviewedBy ?? null,
    },
  };
}
