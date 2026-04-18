// apps/web/src/layout/TopBar/TopBar.tsx — single-row top bar.
// Project switcher · env badge · screen nav · search · profile. NOT a second nav system.
import { Link, useRouterState } from '@tanstack/react-router';
import { useShellStore } from '../../lib/store/shellStore';

const MOCK_PROJECT = { name: 'My First Project', env: 'dev' } as const;

/** Compact nav items that live in the top bar (secondary to the workspace modes). */
const NAV_ITEMS = [
  { to: '/',              label: 'Workspace'    },
  { to: '/projects',      label: 'Projects'     },
  { to: '/approvals',     label: 'Approvals'    },
  { to: '/runs',          label: 'Runs'         },
  { to: '/versions',      label: 'Versions'     },
  { to: '/assets',        label: 'Assets'       },
  { to: '/publish',       label: 'Publish'      },
  { to: '/integrations',  label: 'Integrations' },
  { to: '/database',      label: 'Database'     },
  { to: '/jobs',          label: 'Jobs'         },
  { to: '/env-secrets',   label: 'Secrets'      },
  { to: '/providers',     label: 'Providers'    },
  { to: '/onboarding',    label: 'Onboarding'   },
  { to: '/logs',          label: 'Logs'         },
  { to: '/templates',     label: 'Templates'    },
] as const;

export function TopBar() {
  const { collapsed, toggleCollapsed } = useShellStore();
  const routerState = useRouterState();
  const activePath = routerState.location.pathname;

  return (
    <header className="abw-shell__topbar" role="banner">
      {/* Collapse toggle — also triggered by Cmd/Ctrl+\ */}
      <button
        className="abw-topbar__collapse-btn"
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand left panel' : 'Collapse left panel'}
        aria-expanded={!collapsed}
        title={(collapsed ? 'Expand' : 'Collapse') + ' (Ctrl+\\)'}
      >
        {collapsed ? '›' : '‹'}
      </button>

      {/* Project switcher */}
      <button className="abw-topbar__project-switcher" aria-haspopup="listbox" aria-label="Switch project">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {MOCK_PROJECT.name}
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.625rem', flexShrink: 0 }}>▾</span>
      </button>

      {/* Env badge */}
      <EnvBadge env={MOCK_PROJECT.env} />

      {/* Screen navigation */}
      <nav className="abw-topbar__nav" aria-label="Section navigation">
        {NAV_ITEMS.map(({ to, label }) => {
          const isActive = to === '/' ? activePath === '/' : activePath.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`abw-topbar__nav-link${isActive ? ' abw-topbar__nav-link--active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Spacer pushes search + profile to the right */}
      <div className="abw-topbar__spacer" aria-hidden />

      {/* Global search trigger */}
      <button className="abw-topbar__search" aria-label="Search (Cmd+K)">
        <span aria-hidden style={{ fontSize: '0.75rem' }}>⌘</span>
        <span>Search…</span>
        <span aria-hidden style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--text-secondary)', flexShrink: 0 }}>⌘K</span>
      </button>

      {/* Settings + profile */}
      <Link
        to="/settings"
        style={{
          fontSize: '0.75rem', color: 'var(--text-secondary)', textDecoration: 'none',
          padding: '0 var(--space-1)',
          opacity: activePath === '/settings' ? 1 : 0.7,
        }}
        aria-label="App settings"
        title="Settings"
      >
        ⚙
      </Link>
      <ProfileAvatar />
    </header>
  );
}

function EnvBadge({ env }: { env: string }) {
  const cls = `abw-topbar__env-badge abw-topbar__env-badge--${env}`;
  const labels: Record<string, string> = { dev: 'Dev', staging: 'Staging', preview: 'Preview', production: 'Production' };
  return (
    <span className={cls} role="status" aria-label={`Environment: ${labels[env] ?? env}`}>
      {labels[env] ?? env}
    </span>
  );
}

function ProfileAvatar() {
  return (
    <button
      style={{
        width: 28, height: 28, borderRadius: '50%', border: 'none',
        background: 'var(--accent-500)', color: '#fff', cursor: 'pointer',
        fontSize: '0.75rem', fontWeight: 700, display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}
      aria-label="Profile menu"
      aria-haspopup="menu"
    >
      U
    </button>
  );
}
