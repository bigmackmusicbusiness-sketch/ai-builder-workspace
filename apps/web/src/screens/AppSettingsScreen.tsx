// apps/web/src/screens/AppSettingsScreen.tsx — workspace-wide app settings.
// Theme, default provider, language preferences, danger zone (delete tenant data).
export function AppSettingsScreen() {
  return (
    <div className="abw-screen">
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Settings</h1>
          <p className="abw-screen__sub">Workspace configuration, defaults, and account settings.</p>
        </div>
      </div>

      <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

        {/* General */}
        <section aria-labelledby="settings-general">
          <h2 id="settings-general" style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: 'var(--space-4)' }}>General</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label className="abw-field-label" htmlFor="settings-theme">Theme</label>
              <select id="settings-theme" className="abw-select">
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
            <div>
              <label className="abw-field-label" htmlFor="settings-default-env">Default environment</label>
              <select id="settings-default-env" className="abw-select">
                <option value="dev">Dev</option>
                <option value="staging">Staging</option>
                <option value="preview">Preview</option>
              </select>
            </div>
          </div>
        </section>

        {/* Default provider */}
        <section aria-labelledby="settings-provider">
          <h2 id="settings-provider" style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Default Provider</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label className="abw-field-label" htmlFor="settings-provider-select">Provider</label>
              <select id="settings-provider-select" className="abw-select">
                <option value="ollama">Ollama (local)</option>
                <option value="minimax">MiniMax 2.7</option>
              </select>
            </div>
            <div>
              <label className="abw-field-label" htmlFor="settings-model-select">Default model</label>
              <input id="settings-model-select" className="abw-input" type="text" defaultValue="llama3" />
            </div>
            <div className="abw-banner abw-banner--info">
              The model selector in the left panel overrides this default per run. Fallback is OFF by default — enable it per project in project settings.
            </div>
          </div>
        </section>

        {/* Danger zone */}
        <section aria-labelledby="settings-danger">
          <h2 id="settings-danger" style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: 'var(--space-4)', color: 'var(--error-500)' }}>Danger zone</h2>
          <div className="abw-card" style={{ borderColor: 'var(--error-300)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Delete all workspace data</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  Permanently deletes all projects, files, secrets, runs, and configurations for this workspace.
                </div>
              </div>
              <button className="abw-btn abw-btn--destructive" aria-label="Delete all workspace data">Delete workspace</button>
            </div>
          </div>
        </section>

        {/* Save */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button className="abw-btn abw-btn--ghost">Cancel</button>
          <button className="abw-btn abw-btn--primary">Save settings</button>
        </div>
      </div>
    </div>
  );
}
