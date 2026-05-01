// packages/project-types/email-composer/index.ts — Email Composer project type.
// AI-powered HTML email builder with live preview and send-test via Resend/SendGrid.
import type { ProjectType, ScaffoldInput, FileTree } from '../types';

export const emailComposer: ProjectType = {
  id:          'email-composer',
  label:       'Email Composer',
  description: 'AI-powered HTML email builder with live preview and one-click send-test.',
  icon:        '✉️',

  scaffold(input: ScaffoldInput): FileTree {
    return {
      'README.md': `# ${input.projectName}\n\n${input.description ?? 'Email Composer project.'}\n\nCompose and preview emails from the Email tab. Send test emails via Resend or SendGrid.\n`,
    };
  },

  defaultVerificationMatrix: ['secretScan'],

  defaultApprovalPolicy: {
    alwaysApprove: ['email.send'],
  },

  screens: ['preview', 'files'],
};
