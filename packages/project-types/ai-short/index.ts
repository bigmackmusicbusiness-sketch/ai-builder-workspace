// packages/project-types/ai-short/index.ts — AI Short / Reel / TikTok project type.
// 9:16 vertical, 15-60s, hyper-motion preset. Lowest credit cost, highest demand.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const aiShort: ProjectType = {
  id:          'ai-short',
  label:       'AI Short',
  description: 'Vertical short for TikTok / Reels / YouTube Shorts. 9:16, 15-60s, hyper-motion. Cheapest video format, fastest to generate.',
  icon:        '📱',

  scaffold(input: ScaffoldInput): FileTree {
    return {
      'README.md':
        `# ${input.projectName}\n\n` +
        `${input.description ?? 'AI-generated short.'}\n\n` +
        `Open the **Video Studio → Shorts** tab. Default 9:16 aspect, 30s duration. ` +
        `Generation uses Hailuo 02 by default (cheap, fast); switch to Sora 2 for ` +
        `top quality at premium cost.\n`,
    };
  },

  defaultVerificationMatrix: ['secretScan'],

  defaultApprovalPolicy: {
    // Shorts are cheap enough that final renders don't need approval.
    neverRequire: ['video.render.final'],
  },

  screens: ['files', 'preview'],
  agentInstructions: {
    systemPromptPrelude: 'types/ai-short.md',
    copyGuidance:
      '15-60s vertical. Hook in first 1.5s, single beat, payoff. Vertical safe zones.',
    securitySOPs: [
      'Trending audio licensing per platform (TikTok, Reels)',
      'Vertical safe zones (top 14% / bottom 18%)',
    ],
    multiPageStrategy: {
    },
    assetBudget: { images: 0, icons: 8 },
  },
};
