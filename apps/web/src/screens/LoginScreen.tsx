// apps/web/src/screens/LoginScreen.tsx — full-page login screen.
// Two-column on ≥1024px: left brand panel, right sign-in card. Stacks on mobile.
// Uses Supabase email/password auth. Username field maps "melvin" → "melvin@abw.local".
import { useState, type FormEvent } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useAuthStore } from '../lib/store/authStore';

export function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  const signIn = useAuthStore((s) => s.signIn);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setBusy(true);
    setError(null);
    const result = await signIn(username.trim(), password);
    setBusy(false);

    if (result.error) {
      setError('Invalid username or password.');
    } else {
      // Post-login: land on the projects-as-dashboard, not the empty Workspace.
      router.navigate({ to: '/projects' });
    }
  }

  return (
    <div className="abw-login">
      {/* Brand panel — ambient violet wash, product mark, value prop */}
      <aside className="abw-login__brand-panel" aria-hidden>
        <div className="abw-login__brand-glow" />
        <div className="abw-login__brand-content">
          <div className="abw-login__brand-mark">
            <span className="abw-login__brand-hex">⬡</span>
            <span className="abw-login__brand-word">AI Builder</span>
          </div>

          <p className="abw-login__brand-tagline">
            Your private studio for shipping software, sites, and stories.
          </p>

          <ul className="abw-login__brand-bullets">
            <li><span className="abw-login__brand-dot" /> One agent, every surface</li>
            <li><span className="abw-login__brand-dot" /> Versioned, previewed, deployable</li>
            <li><span className="abw-login__brand-dot" /> Built for an internal team</li>
          </ul>

          <div className="abw-login__brand-footer">
            <span className="abw-login__brand-pill">Internal · authorised users only</span>
          </div>
        </div>
      </aside>

      {/* Sign-in panel */}
      <main className="abw-login__form-panel">
        <div className="abw-login__card">
          <div className="abw-login__card-mark" aria-hidden>
            <span className="abw-login__brand-hex">⬡</span>
            <span className="abw-login__brand-word">AI Builder</span>
          </div>

          <h1 className="abw-login__heading">Welcome back</h1>
          <p className="abw-login__sub">Sign in to continue to your workspace.</p>

          <form className="abw-login__form" onSubmit={handleSubmit} noValidate>
            <div className="abw-login__field">
              <label className="abw-login__label" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                className="abw-login__input"
                type="text"
                autoComplete="username"
                autoFocus
                placeholder="melvin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
                required
              />
            </div>

            <div className="abw-login__field">
              <label className="abw-login__label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="abw-login__input"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
            </div>

            {error && (
              <p className="abw-login__error" role="alert">
                {error}
              </p>
            )}

            <button
              className="abw-login__btn"
              type="submit"
              disabled={busy || !username.trim() || !password}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="abw-login__hint">
            Trouble signing in? Ask your workspace admin.
          </p>
        </div>
      </main>
    </div>
  );
}
