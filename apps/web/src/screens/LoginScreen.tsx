// apps/web/src/screens/LoginScreen.tsx — full-page login screen.
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
      router.navigate({ to: '/' });
    }
  }

  return (
    <div className="abw-login">
      <div className="abw-login__card">
        {/* Brand */}
        <div className="abw-login__brand">
          <span className="abw-login__logo" aria-hidden="true">⬡</span>
          <span className="abw-login__wordmark">AI Builder</span>
        </div>

        <h1 className="abw-login__heading">Sign in</h1>
        <p className="abw-login__sub">Internal workspace — authorised users only.</p>

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
      </div>
    </div>
  );
}
