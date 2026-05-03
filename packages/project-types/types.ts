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
  | 'ebook'
  | 'document'
  | 'email-composer'
  | 'music-studio'
  | 'ai-movie'
  | 'ai-commercial'
  | 'ai-short'
  | 'ai-music-video'
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

/** Default page entry for multi-page types (website, saas-app). */
export interface DefaultPageEntry {
  /** URL slug (e.g. "index", "about", "services"). */
  slug:     string;
  /** Page role hint for the planner (e.g. "hero+overview", "service-list"). */
  role:     string;
  /** If true, the planner must include this page even if the prompt doesn't mention it. */
  required: boolean;
}

/** Multi-page strategy for the planner subagent. */
export interface MultiPageStrategy {
  /** Default sitemap if no niche matches. */
  defaultPages?:        DefaultPageEntry[];
  /** Path to JSON manifest listing niches + keyword triggers (Tier 1 types). */
  nicheManifestPath?:   string;
  /** Whether to detect niche from the user's prompt vs. always use defaults. */
  detectFromPrompt?:    boolean;
}

/** Vetted color palette for niche-driven design choices. */
export interface ColorPalette {
  name:  string;
  /** Hex codes in role order: primary, surface, surface-tint, ink. */
  hexes: [string, string, string, string] | string[];
}

/** Per-type agent SOPs. Loaded into subagent system prompts at request time. */
export interface AgentInstructions {
  /** Path to type SOP markdown (relative to apps/api/src/agent/skills/types/). */
  systemPromptPrelude?: string;
  /** Inline copy guidance: tone, voice, SEO targets, length. */
  copyGuidance?:        string;
  /** Hard security rules enforced at write time + audited in polish phase. */
  securitySOPs?:        string[];
  /** How the planner should handle multi-page expansion. */
  multiPageStrategy?:   MultiPageStrategy;
  /** Niche → starter voice profile. */
  voiceTemplates?:      Record<string, string>;
  /** Niche → vetted palettes. */
  palettes?:            Record<string, ColorPalette[]>;
  /** Asset budget cap (images, icons) for the planner. Default: { images: 6, icons: 12 }. */
  assetBudget?:         { images?: number; icons?: number };
}

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
  /** Per-type agent SOPs. Optional — types without instructions use the default planner. */
  agentInstructions?: AgentInstructions;
}
