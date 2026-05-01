// packages/project-types/document/index.ts — Document Studio project type.
// AI-generated professional documents: proposals, case studies, pitch decks, invoices.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const document: ProjectType = {
  id:          'document',
  label:       'Document Studio',
  description: 'AI-generated professional docs: proposals, case studies, pitch decks, and invoices.',
  icon:        '📄',

  scaffold(input: ScaffoldInput): FileTree {
    return {
      'README.md': `# ${input.projectName}\n\n${input.description ?? 'Document Studio project.'}\n\nGenerate documents from the Documents tab. Supports business proposals, case studies, project reports, invoices, and pitch decks.\n`,
    };
  },

  defaultVerificationMatrix: ['secretScan'],

  defaultApprovalPolicy: {},

  screens: ['files', 'preview'],
};
