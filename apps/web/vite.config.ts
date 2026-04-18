// apps/web/vite.config.ts — Vite config for the workspace UI.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: { port: 5175, strictPort: false },
  preview: { port: 5174 },
  resolve: {
    alias: {
      '@abw/ui': fileURLToPath(new URL('../../packages/ui/index.ts', import.meta.url)),
      '@abw/shared': fileURLToPath(new URL('../../packages/shared/index.ts', import.meta.url)),
      '@abw/project-types': fileURLToPath(new URL('../../packages/project-types/index.ts', import.meta.url)),
      // CSS-only alias: used in @import inside .css files (avoids path-with-spaces issues on Windows)
      '@ui-styles': fileURLToPath(new URL('../../packages/ui/styles', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
  },
});
