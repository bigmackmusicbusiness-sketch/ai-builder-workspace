// packages/project-types/ai-music-video/index.ts — AI Music Video project type.
// Generates or imports a music track, beat-detects, generates scenes synced
// to drops. 1-3 min output. Custom flow — Higgsfield doesn't ship a music-video
// preset, so we orchestrate it ourselves on top of their video models.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const aiMusicVideo: ProjectType = {
  id:          'ai-music-video',
  label:       'AI Music Video',
  description: 'Music video synced to a track. Beat-detection drives scene cuts; AI generates visuals matching mood + lyrics. Bring your own track or generate one.',
  icon:        '🎵',

  scaffold(input: ScaffoldInput): FileTree {
    return {
      'README.md':
        `# ${input.projectName}\n\n` +
        `${input.description ?? 'AI-generated music video.'}\n\n` +
        `Open the **Video Studio → Music Videos** tab. Either generate a track from ` +
        `a prompt or upload your own MP3/WAV. The pipeline detects beats, generates ` +
        `scenes synced to drops, and stitches the final cut.\n`,
    };
  },

  defaultVerificationMatrix: ['secretScan'],

  defaultApprovalPolicy: {
    // Multi-minute renders chew through credits — gate the final.
    alwaysApprove: ['video.render.final'],
  },

  screens: ['files', 'preview'],
  agentInstructions: {
    systemPromptPrelude: 'types/ai-music-video.md',
    copyGuidance:
      'Sync-to-beat patterns. Visual energy curve. Lyric overlays optional. Multi-scene structure.',
    securitySOPs: [
      'Music license required',
      'Lyric attribution required',
    ],
    multiPageStrategy: {
      nicheManifestPath: 'types/ai-music-video/niches/',
      detectFromPrompt:  true,
    },
    assetBudget: { images: 0, icons: 8 },
  },
};
