// packages/project-types/index.ts — project-type registry + scaffolding API.
// Each project type is independently defined and exports a ProjectType object.
// The registry allows look-up by ID and provides a flat list for UIs.
export type { ProjectTypeId, FileTree, ScaffoldInput, ProjectType, VerificationAdapter, ApprovalPolicy, WorkspaceScreen } from './types';

import { blank }          from './blank/index';
import { website }        from './website/index';
import { landingPage }    from './landing-page/index';
import { dashboard }      from './dashboard/index';
import { internalTool }   from './internal-tool/index';
import { onboardingFlow } from './onboarding-flow/index';
import { automationPanel } from './automation-panel/index';
import { saasApp }        from './saas-app/index';
import { apiService }     from './api-service/index';
import { fullStackApp }   from './full-stack-app/index';
import { ebook }          from './ebook/index';
import { document as documentStudio } from './document/index';
import { emailComposer }  from './email-composer/index';
import { musicStudio }    from './music-studio/index';
import { aiMovie }        from './ai-movie/index';
import { aiCommercial }   from './ai-commercial/index';
import { aiShort }        from './ai-short/index';
import { aiMusicVideo }   from './ai-music-video/index';

import type { ProjectType, ProjectTypeId } from './types';

// ---------------------------------------------------------------------------
// Registry — source of truth for all project types
// ---------------------------------------------------------------------------

const REGISTRY = new Map<ProjectTypeId, ProjectType>([
  ['blank',             blank],
  ['website',           website],
  ['landing-page',      landingPage],
  ['dashboard',         dashboard],
  ['internal-tool',     internalTool],
  ['onboarding-flow',   onboardingFlow],
  ['automation-panel',  automationPanel],
  ['saas-app',          saasApp],
  ['api-service',       apiService],
  ['full-stack-app',    fullStackApp],
  ['ebook',             ebook],
  ['document',          documentStudio],
  ['email-composer',    emailComposer],
  ['music-studio',      musicStudio],
  ['ai-movie',          aiMovie],
  ['ai-commercial',     aiCommercial],
  ['ai-short',          aiShort],
  ['ai-music-video',    aiMusicVideo],
]);

/** Return all registered project types as an ordered array. */
export function listProjectTypes(): ProjectType[] {
  return [
    // ── Web & App projects ───────────────────────────
    website,
    landingPage,
    dashboard,
    saasApp,
    fullStackApp,
    apiService,
    internalTool,
    onboardingFlow,
    automationPanel,
    // ── Creative Suite ───────────────────────────────
    ebook,
    documentStudio,
    emailComposer,
    musicStudio,
    // ── Video Suite ──────────────────────────────────
    aiMovie,
    aiCommercial,
    aiShort,
    aiMusicVideo,
    // ── Blank ────────────────────────────────────────
    blank,
  ];
}

/** Retrieve a project type by ID. Throws if unknown. */
export function getProjectType(id: ProjectTypeId): ProjectType {
  const pt = REGISTRY.get(id);
  if (!pt) throw new Error(`Unknown project type: ${id}`);
  return pt;
}

/** Safely look up a project type — returns null if unknown (use in UI). */
export function findProjectType(id: string): ProjectType | null {
  return REGISTRY.get(id as ProjectTypeId) ?? null;
}

/** Generate the initial file tree for a new project of the given type. */
export function scaffold(
  typeId: ProjectTypeId,
  input: Parameters<ProjectType['scaffold']>[0],
): ReturnType<ProjectType['scaffold']> {
  return getProjectType(typeId).scaffold(input);
}

// Re-export individual types for direct import convenience
export { blank, website, landingPage, dashboard, internalTool };
export { onboardingFlow, automationPanel, saasApp, apiService, fullStackApp };
export { ebook, emailComposer, musicStudio };
export { documentStudio as document };
export { aiMovie, aiCommercial, aiShort, aiMusicVideo };
