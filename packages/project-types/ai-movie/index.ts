// packages/project-types/ai-movie/index.ts — AI Movie project type.
// Long-form narrative video built scene-by-scene with Higgsfield Cinema Studio,
// Veo, or Sora. Optional voiceover from the music gen pipeline. 1-5 minute output.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const aiMovie: ProjectType = {
  id:          'ai-movie',
  label:       'AI Movie',
  description: 'Multi-scene narrative video. AI writes a script, generates each scene with Cinema Studio / Veo / Sora, stitches with crossfades and optional voiceover.',
  icon:        '🎞️',

  scaffold(input: ScaffoldInput): FileTree {
    return {
      'README.md':
        `# ${input.projectName}\n\n` +
        `${input.description ?? 'AI-generated movie project.'}\n\n` +
        `Open the **Video Studio → Movies** tab to create scenes and render the final cut. ` +
        `Heavy generation cost — premium models. Aspect ratio defaults to 16:9.\n`,
    };
  },

  defaultVerificationMatrix: ['secretScan'],

  defaultApprovalPolicy: {
    // Long renders + premium model use are credit-expensive — gate them.
    alwaysApprove: ['video.render.final', 'video.use_premium_model'],
  },

  screens: ['files', 'preview'],
  agentInstructions: {
    systemPromptPrelude: 'types/ai-movie.md',
    copyGuidance:
      'Long-form structure: act 1/2/3, scene boundaries, voiceover scripting, music cue sheet.',
    securitySOPs: [
      'No copyrighted music without license',
      'No likeness of real people without consent',
    ],
    multiPageStrategy: {
      nicheManifestPath: 'types/ai-movie/niches/',
      detectFromPrompt:  true,
    },
    assetBudget: { images: 0, icons: 8 },
  },
};
