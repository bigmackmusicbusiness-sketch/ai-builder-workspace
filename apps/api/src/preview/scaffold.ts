// apps/api/src/preview/scaffold.ts — writes a minimal Hello World React project
// to a temp directory so the bundler has real files to resolve.
// Used in local dev when no project files exist on disk yet.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export async function scaffoldHelloWorld(projectSlug: string): Promise<string> {
  const dir = join(tmpdir(), `abw-preview-${projectSlug}-${randomUUID()}`);
  await mkdir(join(dir, 'src'), { recursive: true });

  await writeFile(join(dir, 'src', 'main.tsx'), `
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <div style={{
      fontFamily: 'system-ui, sans-serif',
      maxWidth: 640,
      margin: '80px auto',
      padding: '0 24px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>
        ${projectSlug}
      </h1>
      <p style={{ color: '#666', fontSize: 16, lineHeight: 1.6 }}>
        Your project is live in the preview sandbox.<br/>
        Ask the AI to build something and it will appear here.
      </p>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
`.trimStart());

  return dir;
}
