// packages/project-types/music-studio/index.ts — Music Studio project type.
// AI beat and cinematic music generation with stem separation and WAV/MP3 export.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const musicStudio: ProjectType = {
  id:          'music-studio',
  label:       'Music Studio',
  description: 'AI beat and cinematic music generation. Stem separation, WAV/MP3 + ZIP export.',
  icon:        '🎵',

  scaffold(input: ScaffoldInput): FileTree {
    return {
      'README.md': `# ${input.projectName}\n\n${input.description ?? 'Music Studio project.'}\n\nGenerate beats and cinematic tracks from the Music tab. Downloads include MP3 preview + WAV stems ZIP.\n`,
    };
  },

  defaultVerificationMatrix: ['secretScan'],

  defaultApprovalPolicy: {
    alwaysApprove: ['music.generate.long'],
  },

  screens: ['files', 'preview'],
};
