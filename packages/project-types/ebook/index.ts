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
};
