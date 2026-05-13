// apps/web/src/layout/TopBar/TopBar.tsx — mode-aware top bar.
// Browse mode (no project open) → primary nav + project switcher.
// Builder mode (a project is open) → logo (exits) + project name + env pill +
// ▲ Publish + ⚙ + profile. Publish lives here (NOT in primary nav) because it's
// a per-project action: you can only publish the project you're working in.
// The settings gear and profile are reachable in BOTH modes.
import { useEffect, useRef, useState } from 'react';
import { Link, useRouter, useRouterState } from '@tanstack/react-router';
import { useShellStore } from '../../lib/store/shellStore';
import { useProjectStore } from '../../lib/store/projectStore';
import { useAuthStore } from '../../lib/store/authStore';

/** Primary nav items shown in BROWSE mode. The Workspace tab is gone — it's
 *  implicit when you click into a project. Publish was removed in May 2026:
 *  it's a per-project action so it lives as a button inside builder mode
 *  instead of a top-level nav item that forced users to pick a project. */
const NAV_ITEMS = [
  { to: '/projects',  label: 'Projects'   },
  { to: '/templates', label: 'Templates'  },
  { to: '/create',    label: 'Create'     },
  { to: '/video',     label: 'Video'      },
  { to: '/ads',       label: 'Ads'        },
  { to: '/approvals', label: 'Approvals'  },
] as const;

/** Routes that always render the BROWSE topbar shape, even if a project is
 *  currently selected. Visiting these screens means the user is browsing —
 *  the project context lives in the store and gets re-applied when they go
 *  back to /.
 *
 *  `/publish` is intentionally NOT in this list: it's a per-project surface
 *  reached from the in-builder ▲ Publish button, so the topbar keeps the
 *  project crumb + chat panel context while the rep manages targets. */
const BROWSE_ROUTE_PREFIXES = [
  '/projects',
  '/templates',
  '/create',
  '/ads',
  '/approvals',
  '/integrations',
  '/env-secrets',
  '/database',
  '/assets',
  '/versions',
  '/runs',
  '/logs',
  '/jobs',
  '/onboarding',
  '/settings',
] as const;

/** Operational + admin surfaces — reachable via the gear menu, not primary nav. */
const SETTINGS_ITEMS = [
  { to: '/integrations', label: 'Integrations' },
  { to: '/env-secrets',  label: 'Env secrets'   },
  { to: '/database',     label: 'Database'      },
  { to: '/assets',       label: 'Assets'        },
  { to: '/versions',     label: 'Versions'      },
  { to: '/runs',         label: 'Agent runs'    },
  { to: '/logs',         label: 'Logs & health' },
  { to: '/jobs',         label: 'Jobs & queues' },
  { to: '/onboarding',   label: 'Onboarding'    },
  { to: '/settings',     label: 'App settings'  },
] as const;

export function TopBar() {
  const { collapsed, toggleCollapsed } = useShellStore();
  const { currentProjectId, projects, setCurrentProject } = useProjectStore();
  const routerState = useRouterState();
  const router      = useRouter();
  const activePath  = routerState.location.pathname;

  const activeProject  = currentProjectId !== 'global' ? projects[currentProjectId] : null;
  // Exact match — NOT startsWith — because `/projects` is a browse route
  // (the project list) but `/projects/$slug` is a per-project IDE landing
  // (round 13, SPS iframe-handoff target) that needs the builder topbar.
  // A prefix match would wrongly bucket project detail as a browse route.
  const isBrowseRoute  = BROWSE_ROUTE_PREFIXES.some((p) => activePath === p);
  // Builder mode = a project is selected AND we're NOT on a browse-mode route.
  // /projects, /templates, settings screens etc. always show browse-mode topbar
  // even if a project is in the store.
  const isBuilderMode  = Boolean(activeProject) && !isBrowseRoute;
  const activeEnv      = activeProject?.env ?? 'dev';

  function handleLogoClick() {
    if (isBuilderMode) {
      // Exit builder: clear current project + navigate back to projects dashboard.
      setCurrentProject('global');
      void router.navigate({ to: '/projects' });
    } else {
      void router.navigate({ to: '/projects' });
    }
  }

  return (
    <header
      className={`abw-shell__topbar${isBuilderMode ? ' abw-shell__topbar--builder' : ''}`}
      role="banner"
    >
      {/* Collapse toggle (only useful in builder mode where the chat panel exists) */}
      {isBuilderMode && (
        <button
          className="abw-topbar__collapse-btn"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand left panel' : 'Collapse left panel'}
          aria-expanded={!collapsed}
          title={(collapsed ? 'Expand' : 'Collapse') + ' (Ctrl+\\)'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      )}

      {/* Logo / wordmark — clicking exits builder mode if active */}
      <button
        className="abw-topbar__logo"
        onClick={handleLogoClick}
        aria-label={isBuilderMode ? 'Exit project — back to projects' : 'Projects'}
        title={isBuilderMode ? 'Back to projects' : 'Projects'}
      >
        <img
          className="abw-topbar__logo-mark"
          src="/signalpoint-logo-s.png"
          alt=""
          aria-hidden
        />
        {!isBuilderMode && <span className="abw-topbar__logo-word">SignalPoint IDE</span>}
      </button>

      {isBuilderMode ? (
        <>
          {/* Builder mode: clickable project name (→ /) + env pill. Linking
              the crumb back to the workspace gives reps a clear way out of
              /publish without exiting the project entirely (logo click does
              that). On `/` itself it's a no-op. */}
          <div className="abw-topbar__crumb" aria-label="Active project">
            <span className="abw-topbar__crumb-sep" aria-hidden>/</span>
            <Link
              to="/"
              className="abw-topbar__crumb-name abw-topbar__crumb-name--link"
              title="Back to builder"
            >
              {activeProject!.name}
            </Link>
            <EnvBadge env={activeEnv} />
          </div>

          {/* Spacer pushes Publish + settings + profile to the right */}
          <div className="abw-topbar__spacer" aria-hidden />

          {/* Publish — primary action for the active project. Lives inside
              builder mode only (no project = nothing to publish). Active
              state highlights when the rep is already on /publish so the
              button doubles as a back-to-targets affordance. */}
          <Link
            to="/publish"
            className={`abw-btn abw-btn--primary abw-btn--sm abw-topbar__publish${
              activePath.startsWith('/publish') ? ' abw-topbar__publish--active' : ''
            }`}
            aria-current={activePath.startsWith('/publish') ? 'page' : undefined}
            title="Publish this project (targets, deploys, history)"
          >
            <span aria-hidden>▲</span> Publish
          </Link>
        </>
      ) : (
        <>
          {/* Browse mode: project switcher (jump-into) + nav */}
          <ProjectSwitcher />

          {/* Screen navigation — 6 primary items */}
          <nav className="abw-topbar__nav" aria-label="Section navigation">
            {NAV_ITEMS.map(({ to, label }) => {
              const isActive = activePath.startsWith(to);
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

          {/* Global search trigger — browse mode only (builder uses Cmd+P inline) */}
          <button className="abw-topbar__search" aria-label="Search (Cmd+K)">
            <span aria-hidden style={{ fontSize: '0.75rem' }}>⌘</span>
            <span>Search…</span>
            <span aria-hidden style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--text-secondary)', flexShrink: 0 }}>⌘K</span>
          </button>
        </>
      )}

      {/* Settings gear — opens a menu of operational + admin surfaces (both modes) */}
      <SettingsMenu activePath={activePath} />
      <ProfileAvatar />
    </header>
  );
}

// ── Project Switcher ───────────────────────────────────────────────────────────

function ProjectSwitcher() {
  const { currentProjectId, projects, setCurrentProject, loadProjectsFromServer } = useProjectStore();
  const router                = useRouter();
  const [open, setOpen]       = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef                = useRef<HTMLButtonElement>(null);
  const menuRef               = useRef<HTMLDivElement>(null);

  const currentProject = currentProjectId !== 'global' ? projects[currentProjectId] : null;
  const projectList    = Object.values(projects).sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  // Sync from server on mount so cross-device projects appear immediately
  useEffect(() => { loadProjectsFromServer(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Recalculate fixed position when dropdown opens or window resizes
  useEffect(() => {
    if (!open) return;
    function calcPos() {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, left: r.left });
    }
    calcPos();
    window.addEventListener('resize', calcPos);
    return () => window.removeEventListener('resize', calcPos);
  }, [open]);

  function handlePick(id: string) {
    setCurrentProject(id);
    setOpen(false);
    if (id !== 'global') {
      // Jump straight into builder mode for the picked project.
      void router.navigate({ to: '/' });
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        className="abw-topbar__project-switcher"
        aria-haspopup="listbox"
        aria-label="Switch project"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentProject?.name ?? 'No project'}
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.625rem', flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Project list"
          style={{
            position:     'fixed',
            top:          menuPos.top,
            left:         menuPos.left,
            zIndex:       9999,
            minWidth:     220,
            maxHeight:    320,
            overflowY:    'auto',
            background:   'var(--surface-overlay)',
            border:       '1px solid var(--border-base)',
            borderRadius: 'var(--radius-card)',
            boxShadow:    'var(--shadow-overlay)',
            padding:      'var(--space-1)',
            display:      'flex',
            flexDirection:'column',
            gap:          2,
          }}
        >
          {projectList.length === 0 ? (
            <span style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
              No projects yet —{' '}
              <Link to="/projects" style={{ color: 'var(--accent-500)' }} onClick={() => setOpen(false)}>
                create one
              </Link>
            </span>
          ) : (
            <>
              {/* "None" option to go back to global context */}
              <button
                role="option"
                aria-selected={currentProjectId === 'global'}
                className={`abw-topbar__nav-link${currentProjectId === 'global' ? ' abw-topbar__nav-link--active' : ''}`}
                style={{
                  border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', flexDirection: 'column', gap: 1, padding: '5px 10px',
                  width: '100%',
                }}
                onClick={() => handlePick('global')}
              >
                <span style={{ fontWeight: 500, color: 'var(--text-secondary)', fontStyle: 'italic' }}>No project</span>
              </button>

              <div style={{ height: 1, background: 'var(--border-base)', margin: '2px 4px' }} aria-hidden />

              {projectList.map((p) => (
                <button
                  key={p.id}
                  role="option"
                  aria-selected={p.id === currentProjectId}
                  className={`abw-topbar__nav-link${p.id === currentProjectId ? ' abw-topbar__nav-link--active' : ''}`}
                  style={{
                    border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
                    display: 'flex', flexDirection: 'column', gap: 1, padding: '5px 10px',
                    width: '100%',
                  }}
                  onClick={() => handlePick(p.id)}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{p.name}</span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                    /{p.slug} · {p.env}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

// ── Settings menu — gear icon → operational + admin surfaces ───────────────────

function SettingsMenu({ activePath }: { activePath: string }) {
  const [open, setOpen]       = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const btnRef                = useRef<HTMLButtonElement>(null);
  const menuRef               = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (
        btnRef.current  && !btnRef.current.contains(t) &&
        menuRef.current && !menuRef.current.contains(t)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Recalculate fixed position whenever the dropdown opens or window resizes
  useEffect(() => {
    if (!open) return;
    function calcPos() {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    calcPos();
    window.addEventListener('resize', calcPos);
    return () => window.removeEventListener('resize', calcPos);
  }, [open]);

  const isAnyActive = SETTINGS_ITEMS.some(({ to }) => activePath.startsWith(to));

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Settings & operations"
        className="abw-topbar__settings-btn"
        style={{
          color: isAnyActive ? 'var(--accent-400)' : undefined,
        }}
      >
        ⚙
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position:     'fixed',
            top:          menuPos.top,
            right:        menuPos.right,
            zIndex:       9999,
            minWidth:     200,
            background:   'var(--surface-overlay)',
            border:       '1px solid var(--border-base)',
            borderRadius: 'var(--radius-card)',
            boxShadow:    'var(--shadow-overlay)',
            padding:      'var(--space-1)',
            display:      'flex',
            flexDirection:'column',
            gap:          2,
          }}
        >
          {SETTINGS_ITEMS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              role="menuitem"
              className={`abw-topbar__nav-link${activePath.startsWith(to) ? ' abw-topbar__nav-link--active' : ''}`}
              style={{ display: 'block', whiteSpace: 'nowrap', borderRadius: 'var(--radius-field)', padding: '6px 10px', fontSize: '0.8125rem' }}
              onClick={() => setOpen(false)}
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

// ── Env badge ─────────────────────────────────────────────────────────────────

function EnvBadge({ env }: { env: string }) {
  const cls = `abw-topbar__env-badge abw-topbar__env-badge--${env}`;
  const labels: Record<string, string> = { dev: 'Dev', staging: 'Staging', preview: 'Preview', production: 'Production' };
  return (
    <span className={cls} role="status" aria-label={`Environment: ${labels[env] ?? env}`}>
      {labels[env] ?? env}
    </span>
  );
}

// ── Profile avatar ─────────────────────────────────────────────────────────────

function ProfileAvatar() {
  const userEmail = useAuthStore((s) => s.user?.email ?? null);
  const initial   = (userEmail?.[0] ?? 'U').toUpperCase();
  return (
    <button
      className="abw-topbar__avatar"
      aria-label="Profile menu"
      aria-haspopup="menu"
      title={userEmail ?? 'Profile'}
    >
      {initial}
    </button>
  );
}
