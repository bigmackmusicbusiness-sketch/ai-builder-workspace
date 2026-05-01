// apps/web/src/layout/TopBar/TopBar.tsx — single-row top bar.
// 7-item primary nav · project switcher · env badge · search · settings menu · profile.
import { useEffect, useRef, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useShellStore } from '../../lib/store/shellStore';
import { useProjectStore } from '../../lib/store/projectStore';

/** The 7 primary nav items kept in the top bar — daily-driver surfaces only. */
const NAV_ITEMS = [
  { to: '/projects',  label: 'Projects'   },
  { to: '/',          label: 'Workspace'  },
  { to: '/templates', label: 'Templates'  },
  { to: '/create',    label: 'Create'     },
  { to: '/video',     label: 'Video'      },
  { to: '/publish',   label: 'Publish'    },
  { to: '/approvals', label: 'Approvals'  },
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
  const { currentProjectId, projects } = useProjectStore();
  const routerState = useRouterState();
  const activePath  = routerState.location.pathname;

  const activeProject = currentProjectId !== 'global' ? projects[currentProjectId] : null;
  const activeEnv     = activeProject?.env ?? 'dev';

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

      {/* Project switcher — real data from store */}
      <ProjectSwitcher />

      {/* Env badge — derived from active project */}
      <EnvBadge env={activeEnv} />

      {/* Screen navigation — 7 primary items only */}
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

      {/* Settings gear — opens a menu of operational + admin surfaces */}
      <SettingsMenu activePath={activePath} />
      <ProfileAvatar />
    </header>
  );
}

// ── Project Switcher ───────────────────────────────────────────────────────────

function ProjectSwitcher() {
  const { currentProjectId, projects, setCurrentProject, loadProjectsFromServer } = useProjectStore();
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
            background:   'var(--surface-elevated)',
            border:       '1px solid var(--border-base)',
            borderRadius: 'var(--radius-card)',
            boxShadow:    '0 4px 16px rgba(0,0,0,0.18)',
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
                onClick={() => { setCurrentProject('global'); setOpen(false); }}
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
                  onClick={() => { setCurrentProject(p.id); setOpen(false); }}
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
        style={{
          fontSize:        '0.875rem',
          color:           isAnyActive ? 'var(--accent-500)' : 'var(--text-secondary)',
          background:      'none',
          border:          'none',
          cursor:          'pointer',
          padding:         '0 var(--space-1)',
          opacity:         isAnyActive ? 1 : 0.75,
          flexShrink:      0,
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
            background:   'var(--surface-elevated)',
            border:       '1px solid var(--border-base)',
            borderRadius: 'var(--radius-card)',
            boxShadow:    '0 4px 16px rgba(0,0,0,0.18)',
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
