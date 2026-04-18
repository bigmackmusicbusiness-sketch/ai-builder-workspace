// apps/api/src/verify/types.ts — shared types for all verify adapters.
// Each adapter returns an AdapterResult; pipeline aggregates into VerifyPipelineResult.

import type { VerificationAdapter, FindingSeverity } from '@abw/agent-core';

export interface AdapterFinding {
  severity:  FindingSeverity;
  file?:     string;
  line?:     number;
  column?:   number;
  message:   string;
  rule?:     string;
  fixable:   boolean;
}

export interface AdapterResult {
  adapter:    VerificationAdapter;
  ok:         boolean;
  durationMs: number;
  summary:    string;
  findings:   AdapterFinding[];
  skipped:    boolean;
  skipReason?: string;
}

export interface AdapterContext {
  projectId:   string;
  tenantId:    string;
  projectRoot: string;
  /** Pre-resolved preview URL if the session is booted */
  previewUrl?: string;
  /** Base URL for screenshot baseline comparisons (Supabase Storage prefix) */
  baselineStoragePrefix?: string;
}

export type AdapterName = VerificationAdapter;

export interface VerifyPipelineResult {
  results:  AdapterResult[];
  allGreen: boolean;
  /** Total wall-clock time across all adapters */
  totalMs:  number;
}
