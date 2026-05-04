// packages/project-types/blank/index.ts — Blank project type.
// Empty scaffold; user drives everything. Minimal verification matrix.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const blank: ProjectType = {
  id:          'blank',
  label:       'Blank',
  description: 'Start from scratch. No files pre-generated.',
  icon:        '⬜',

  scaffold(input: ScaffoldInput): FileTree {
    return {
      'README.md': `# ${input.projectName}\n\n${input.description ?? 'Blank project.'}\n`,
    };
  },

  defaultVerificationMatrix: ['lint', 'typecheck', 'secretScan'],

  defaultApprovalPolicy: {},

  screens: ['preview', 'code', 'files', 'console', 'tests'],
  agentInstructions: {
    systemPromptPrelude: 'types/blank.md',
    copyGuidance:
      'Generic. Asks ONE clarifying question via human_flags if brief is ambiguous. Otherwise infers minimum viable scaffold.',
    securitySOPs: [
      'No hardcoded credentials',
      'rel="noopener" on outbound _blank links',
    ],
    multiPageStrategy: {
    },
    assetBudget: { images: 2, icons: 8 },
  },
};
