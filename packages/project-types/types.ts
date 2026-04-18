// packages/project-types/types.ts — shared interfaces for project type registry.
// Each project type exports a ProjectType conforming to this interface.

/** All registered project type IDs. */
export type ProjectTypeId =
  | 'website'
  | 'landing-page'
  | 'dashboard'
  | 'internal-tool'
  | 'onboarding-flow'
  | 'automation-panel'
  | 'saas-app'
  | 'api-service'
  | 'full-stack-app'
  | 'blank';

/** A flat map of file path → file content to write when scaffolding. */
export type FileTree = Record<string, string>;

/** Input passed to scaffold() when creating a new project. */
export interface ScaffoldInput {
  projectName:   string;
  projectSlug:   string;
  description?:  string;
  /** Accent color hex, e.g. "#6366f1". Defaults to token default. */
  accentColor?:  string;
  /** For website: list of page slugs to scaffold. */
  pages?:        string[];
  /** For onboarding-flow: step titles. */
  steps?:        string[];
  /** For api-service / full-stack-app: service names. */
  services?:     string[];
  /** Extra type-specific configuration. */
  extra?:        Record<string, unknown>;
}

/** Verification adapters by name (must match verify pipeline). */
export type VerificationAdapter =
  | 'lint'
  | 'typecheck'
  | 'build'
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'secretScan'
  | 'depVuln'
  | 'migrationSmoke'
  | 'playwrightRuntime'
  | 'screenshotDiff';

/** Per-type approval policy overrides (layered on top of approvalMatrix defaults). */
export interface ApprovalPolicy {
  /** Actions that ALWAYS require approval for this type, regardless of env. */
  alwaysApprove?: string[];
  /** Actions that can proceed without approval even in staging. */
  neverRequire?:  string[];
  /** File-change thresholds for "broad rewrite" detection. */
  broadRewriteFiles?: number;
  broadRewriteLines?: number;
}

/** A workspace mode/screen ID a project type activates. */
export type WorkspaceScreen =
  | 'preview'
  | 'code'
  | 'files'
  | 'console'
  | 'tests'
  | 'visualqa'
  | 'split'
  | 'database'
  | 'jobs'
  | 'env-secrets'
  | 'providers'
  | 'approvals'
  | 'onboarding';

/** Full project type definition. */
export interface ProjectType {
  id:          ProjectTypeId;
  label:       string;
  description: string;
  icon:        string;
  /** Generate the initial file tree for a new project. */
  scaffold(input: ScaffoldInput): FileTree;
  /** Which verification adapters run by default for this type. */
  defaultVerificationMatrix: VerificationAdapter[];
  /** Approval policy overrides for this type. */
  defaultApprovalPolicy: ApprovalPolicy;
  /** Which workspace screens / modes are relevant. */
  screens: WorkspaceScreen[];
}
