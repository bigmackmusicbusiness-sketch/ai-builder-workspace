// packages/project-types/ai-commercial/index.ts — AI Commercial project type.
// 30-60s product/brand spot using Higgsfield Marketing Studio presets
// (UGC, TV-spot, product-focused). Optional product image upload.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const aiCommercial: ProjectType = {
  id:          'ai-commercial',
  label:       'AI Commercial',
  description: 'Brand or product commercial. Marketing-Studio presets for UGC, TV-spot, or product showcase. Upload your product photo, drop a brief, ship.',
  icon:        '📺',

  scaffold(input: ScaffoldInput): FileTree {
    return {
      'README.md':
        `# ${input.projectName}\n\n` +
        `${input.description ?? 'AI-generated commercial.'}\n\n` +
        `Open the **Video Studio → Commercials** tab. Default duration 30s, aspect 16:9 ` +
        `(switch to 9:16 for social). Upload product imagery via Assets if you want it ` +
        `featured in the spot.\n`,
    };
  },

  defaultVerificationMatrix: ['secretScan'],

  defaultApprovalPolicy: {
    // Live brand/product spots — always treat the final render as gated so the
    // user reviews before it's used commercially.
    alwaysApprove: ['video.render.final'],
  },

  screens: ['files', 'preview'],
};
