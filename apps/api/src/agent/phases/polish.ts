// apps/api/src/agent/phases/polish.ts — Phase C: Polish + verify subagent.
//
// Audits SEO, accessibility, performance, security, cross-page consistency.
// Auto-fixes safe items (alt text, noopener, copyright year, JSON-LD).
// Flags unsafe items (color contrast, broken links, hardcoded credentials).

import type { WorkspaceHandle } from '../../preview/workspace';

export interface AuditFinding {
  level:     'auto-fixed' | 'flag';
  category:  'seo' | 'a11y' | 'perf' | 'security' | 'consistency';
  page?:     string;
  line?:     number;
  message:   string;
  /** If auto-fixed, what was changed. */
  fix?:      string;
}

export interface PolishInput {
  projectSlug: string;
  niche:       string;
  ws:          WorkspaceHandle;
  /** Pages written by the executor. */
  pages:       string[];
}

export interface PolishResult {
  ok:        boolean;
  findings:  AuditFinding[];
  error?:    string;
}

export async function runPolish(input: PolishInput): Promise<PolishResult> {
  void input;
  return {
    ok:       false,
    findings: [],
    error:    'Polish not yet implemented (Step 2)',
  };
}
