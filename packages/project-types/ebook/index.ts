// packages/project-types/ebook/index.ts — eBook Generator project type.
// AI-powered eBook creation: lead magnets, KDP novels, how-to guides.
// PDF + EPUB output with optional AI-generated covers.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const ebook: ProjectType = {
  id:          'ebook',
  label:       'eBook',
  description: 'AI-generated eBooks: lead magnets, KDP novels, how-to guides. PDF + EPUB with AI covers.',
  icon:        '📖',

  scaffold(input: ScaffoldInput): FileTree {
    return {
      'README.md': `# ${input.projectName}\n\n${input.description ?? 'eBook project.'}\n\nGenerate eBooks from the eBooks tab. Supports PDF, EPUB, and KDP bundle export.\n`,
    };
  },

  defaultVerificationMatrix: ['secretScan'],

  defaultApprovalPolicy: {
    alwaysApprove: ['ebook.export.kdp'],
  },

  screens: ['files', 'preview'],
  agentInstructions: {
    systemPromptPrelude: 'types/ebook.md',
    copyGuidance:
      'KDP-ready manuscript. Front matter (title, copyright, dedication, ToC, foreword). Back matter (about author, also-by, acknowledgments). Cover spec.',
    securitySOPs: [
      'NO <script> tags — PDFs and EPUB do not execute JS',
      'No external CDN refs',
    ],
    multiPageStrategy: {
      nicheManifestPath: 'types/ebook/niches/',
      detectFromPrompt:  true,
    },
    assetBudget: { images: 6, icons: 8 },
  },
};
