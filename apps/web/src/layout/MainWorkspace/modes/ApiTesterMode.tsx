// apps/web/src/layout/MainWorkspace/modes/ApiTesterMode.tsx — API Tester workspace mode.
// Wraps the ApiTester feature component inside the workspace mode shell.
import { usePreviewStore } from '../../../lib/store/previewStore';
import { ApiTester } from '../../../features/api-tester/ApiTester';

export function ApiTesterMode() {
  const { session } = usePreviewStore();
  // Use preview URL if a session is booted; otherwise default to localhost:3000
  const previewUrl = session?.previewUrl ?? 'http://localhost:3000';

  return (
    <div className="abw-mode abw-mode--api-tester">
      <div className="abw-mode__header">
        <h2 className="abw-mode__title">API Tester</h2>
        <p className="abw-mode__sub">
          Test your project&apos;s API endpoints.
          {session?.previewUrl ? (
            <span style={{ color: 'var(--success-500)', marginLeft: '0.5rem' }}>
              ● Using preview: <code style={{ fontSize: '0.75rem' }}>{session.previewUrl}</code>
            </span>
          ) : (
            <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
              Boot the preview to target the live preview URL.
            </span>
          )}
        </p>
      </div>
      <ApiTester previewUrl={previewUrl} />
    </div>
  );
}
