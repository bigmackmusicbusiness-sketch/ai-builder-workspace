// apps/web/src/screens/ProjectsScreen.tsx — project list + creation.
// Database is the source of truth; localStorage caches agent memory only.
// On mount: syncs from GET /api/projects. Create/delete are persisted to DB first.
//
// Card UX (post-streamline): one primary "Open" button + an overflow ⋯ menu.
// Creative tools live in the /create hub, not on every project card.
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { listProjectTypes } from '@abw/project-types';
import type { ProjectType, ProjectTypeId } from '@abw/project-types';
import { useProjectStore, type ProjectRecord, type ProjectEnv, type DBProjectRow } from '../lib/store/projectStore';
import { apiFetch, ApiError } from '../lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const ms = Date.now() - ts;
  const mins = Math.floor(ms / 60_000);
  if (mins < 2)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function envColor(env: ProjectEnv): string {
  switch (env) {
    case 'production': return 'var(--error-500)';
    case 'staging':    return 'var(--warning-500)';
    case 'preview':    return 'var(--accent-500)';
    default:           return 'var(--text-secondary)';
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProjectsScreen() {
  const { projects, createProject, deleteProject, syncFromDB, setCurrentProject } = useProjectStore();
  const navigate = useNavigate();
  const [showNew,  setShowNew]  = useState(false);
  const [search,   setSearch]   = useState('');
  const [syncing,  setSyncing]  = useState(true);
  const [syncErr,  setSyncErr]  = useState<string | null>(null);

  // ── Sync from DB on mount ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ projects: DBProjectRow[] }>('/api/projects')
      .then((res) => { if (!cancelled) syncFromDB(res.projects); })
      .catch((err) => {
        if (!cancelled) {
          // Non-fatal: show a warning but keep whatever is in localStorage
          setSyncErr(err instanceof ApiError ? err.message : 'Could not reach server — showing cached projects.');
        }
      })
      .finally(() => { if (!cancelled) setSyncing(false); });
    return () => { cancelled = true; };
  }, [syncFromDB]);

  const projectList = Object.values(projects).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const filtered    = projectList.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.slug.toLowerCase().includes(search.toLowerCase()),
  );

  async function handleCreate(data: {
    name: string; slug: string; typeId: ProjectTypeId; description: string;
  }) {
    // DB type uses underscores; store typeId uses hyphens
    const dbType = data.typeId.replace(/-/g, '_');
    try {
      const res = await apiFetch<{ project: DBProjectRow }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: data.name, slug: data.slug, type: dbType, description: data.description || undefined }),
      });
      // Use the DB-assigned id so local and remote stay in sync
      createProject({
        id:          res.project.id,
        name:        data.name,
        slug:        data.slug,
        typeId:      data.typeId,
        env:         'dev',
        description: data.description || undefined,
      });
    } catch (err) {
      alert(`Failed to create project: ${err instanceof ApiError ? err.message : 'Server error'}`);
      return;
    }
    setShowNew(false);
    void navigate({ to: '/' });
  }

  function handleOpen(project: ProjectRecord) {
    setCurrentProject(project.id);
    // Creative + Video Suite types open their dedicated screen.
    // Video kinds all share /video; the screen reads the project's typeId
    // to pick the right tab and pre-fill the creation form.
    const dedicatedRoutes: Partial<Record<string, string>> = {
      'ebook':           '/ebooks',
      'document':        '/documents',
      'email-composer':  '/email',
      'music-studio':    '/music',
      'ai-movie':        '/video',
      'ai-commercial':   '/video',
      'ai-short':        '/video',
      'ai-music-video':  '/video',
    };
    void navigate({ to: (dedicatedRoutes[project.typeId] ?? '/') as '/' });
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    try {
      await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
    } catch (err) {
      alert(`Failed to delete: ${err instanceof ApiError ? err.message : 'Server error'}`);
      return;
    }
    deleteProject(id);
  }

  return (
    <div className="abw-screen">
      {/* Offline/sync warning — non-blocking */}
      {syncErr && (
        <div className="abw-banner abw-banner--warning" style={{ marginBottom: 'var(--space-4)' }}>
          ⚠ {syncErr}
          <button className="abw-btn abw-btn--ghost abw-btn--xs" style={{ marginLeft: 'auto' }} onClick={() => setSyncErr(null)}>✕</button>
        </div>
      )}

      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Projects</h1>
          <p className="abw-screen__sub">
            {syncing
              ? 'Loading…'
              : projectList.length === 0
              ? 'No projects yet — create your first to get started.'
              : `${projectList.length} project${projectList.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          className="abw-btn abw-btn--primary"
          onClick={() => setShowNew(true)}
          aria-label="Create new project"
        >
          + New project
        </button>
      </div>

      {/* Search (only shown when there are projects) */}
      {projectList.length > 0 && (
        <input
          className="abw-input"
          type="search"
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search projects"
          style={{ maxWidth: 320 }}
        />
      )}

      {/* Empty state */}
      {projectList.length === 0 ? (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>🗂</span>
          <p className="abw-empty-state__label">No projects</p>
          <p className="abw-empty-state__sub">
            Start by choosing a project type. Each project gets its own file system,
            preview sandbox, agent memory bank, and verification matrix.
          </p>
          <button className="abw-btn abw-btn--primary" onClick={() => setShowNew(true)}>
            Create first project
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>🔍</span>
          <p className="abw-empty-state__label">No results for &ldquo;{search}&rdquo;</p>
          <p className="abw-empty-state__sub">Try a different name or slug.</p>
        </div>
      ) : (
        <div className="abw-projects__grid">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={handleOpen}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* New project dialog */}
      {showNew && (
        <NewProjectDialog
          onClose={() => setShowNew(false)}
          onCreate={(data) => void handleCreate(data)}
        />
      )}
    </div>
  );
}

// ── ProjectCard ───────────────────────────────────────────────────────────────

function ProjectCard({
  project, onOpen, onDelete,
}: {
  project:  ProjectRecord;
  onOpen:   (p: ProjectRecord) => void;
  onDelete: (id: string) => void;
}) {
  const types       = listProjectTypes();
  const pt          = types.find((t) => t.id === project.typeId);
  const mem         = project.memory;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef  = useRef<HTMLButtonElement>(null);
  const menuRef     = useRef<HTMLDivElement>(null);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (menuBtnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div className="abw-project-card" aria-label={project.name}>
      <div className="abw-project-card__header">
        <span className="abw-project-card__icon" aria-hidden>{pt?.icon ?? '📦'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="abw-project-card__name">{project.name}</p>
          <p className="abw-project-card__slug">/{project.slug}</p>
        </div>
        {/* Memory bank indicator — calm, single dot */}
        {mem.completedTasks.length > 0 && (
          <span
            aria-label={`${mem.completedTasks.length} tasks in memory bank`}
            title={`${mem.completedTasks.length} tasks completed in memory`}
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--accent-500)', flexShrink: 0,
            }}
          />
        )}
      </div>

      {project.description && (
        <p className="abw-project-card__desc">{project.description}</p>
      )}

      <div className="abw-project-card__meta">
        <span style={{ fontSize: '0.6875rem', color: envColor(project.env), fontWeight: 600 }}>
          {project.env.toUpperCase()}
        </span>
        <span className="abw-badge" style={{ fontSize: '0.625rem' }}>{pt?.label ?? project.typeId}</span>
        <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
          {relativeTime(project.lastActiveAt)}
        </span>
      </div>

      <div className="abw-project-card__actions" style={{ position: 'relative' }}>
        <button
          className="abw-btn abw-btn--primary abw-btn--sm"
          style={{ flex: 1 }}
          onClick={() => onOpen(project)}
        >
          Open
        </button>
        <button
          ref={menuBtnRef}
          className="abw-btn abw-btn--ghost abw-btn--sm"
          aria-label={`More actions for ${project.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          title="More actions"
          style={{ width: 32, padding: 0 }}
        >
          ⋯
        </button>

        {menuOpen && (
          <div
            ref={menuRef}
            role="menu"
            style={{
              position:     'absolute',
              top:          'calc(100% + 4px)',
              right:        0,
              zIndex:       30,
              minWidth:     160,
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
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); onOpen(project); }}
              style={overflowItemStyle()}
            >
              Open workspace
            </button>
            {mem.goal && (
              <div
                role="menuitem"
                aria-disabled
                style={{
                  ...overflowItemStyle(),
                  cursor: 'default',
                  color:  'var(--text-secondary)',
                  fontStyle: 'italic',
                  fontSize: '0.75rem',
                  whiteSpace: 'normal',
                  borderTop: '1px solid var(--border-base)',
                  marginTop: 2,
                  paddingTop: 'var(--space-2)',
                }}
                title={mem.goal}
              >
                Goal: {mem.goal.length > 40 ? mem.goal.slice(0, 40) + '…' : mem.goal}
              </div>
            )}
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); void onDelete(project.id); }}
              style={{ ...overflowItemStyle(), color: 'var(--error-500)' }}
            >
              🗑 Delete project
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function overflowItemStyle() {
  return {
    border:       'none',
    background:   'none',
    cursor:       'pointer',
    textAlign:    'left' as const,
    padding:      '6px 10px',
    fontSize:     '0.8125rem',
    color:        'var(--text-primary)',
    borderRadius: 'var(--radius-field)',
    fontFamily:   'inherit',
    width:        '100%',
  };
}

// ── NewProjectDialog ──────────────────────────────────────────────────────────

function NewProjectDialog({
  onClose,
  onCreate,
}: {
  onClose:  () => void;
  onCreate: (data: { name: string; slug: string; typeId: ProjectTypeId; description: string }) => void;
}) {
  const allTypes = listProjectTypes();
  const [step, setStep]                 = useState<'type' | 'details'>('type');
  const [selectedType, setSelectedType] = useState<ProjectType | null>(null);
  const [name, setName]                 = useState('');
  const [slug, setSlug]                 = useState('');
  const [description, setDesc]          = useState('');

  function handleNameChange(val: string) {
    setName(val);
    setSlug(slugify(val));
  }

  function handleCreate() {
    if (!selectedType || !name.trim() || !slug.trim()) return;
    onCreate({ name: name.trim(), slug: slug.trim(), typeId: selectedType.id, description: description.trim() });
  }

  return (
    <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label="New project">
      <div className="abw-dialog" style={{ width: 'min(640px, 94vw)' }}>
        <div className="abw-dialog__header">
          <h2 className="abw-dialog__title">
            {step === 'type' ? 'Choose project type' : `New ${selectedType?.label ?? 'Project'}`}
          </h2>
          <button className="abw-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {step === 'type' ? (
          <div className="abw-dialog__body">
            <div className="abw-project-type-grid">
              {allTypes.map((pt) => (
                <button
                  key={pt.id}
                  className={`abw-project-type-card${selectedType?.id === pt.id ? ' abw-project-type-card--selected' : ''}`}
                  onClick={() => setSelectedType(pt)}
                  aria-pressed={selectedType?.id === pt.id}
                >
                  <span className="abw-project-type-card__icon" aria-hidden>{pt.icon}</span>
                  <span className="abw-project-type-card__label">{pt.label}</span>
                  <span className="abw-project-type-card__desc">{pt.description}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="abw-dialog__body" style={{ gap: 'var(--space-4)' }}>
            <div>
              <label className="abw-field-label" htmlFor="proj-name">Project name</label>
              <input
                id="proj-name"
                className="abw-input"
                type="text"
                placeholder="My Website"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              />
            </div>
            <div>
              <label className="abw-field-label" htmlFor="proj-slug">Slug</label>
              <input
                id="proj-slug"
                className="abw-input"
                type="text"
                placeholder="my-website"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
                Used for preview URL:{' '}
                <code style={{ fontSize: '0.6875rem' }}>{slug || 'my-website'}.preview.local</code>
              </p>
            </div>
            <div>
              <label className="abw-field-label" htmlFor="proj-desc">
                Description{' '}
                <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                id="proj-desc"
                className="abw-input"
                type="text"
                placeholder="Short description"
                value={description}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              🧠 A fresh agent memory bank will be created for this project.
              Chat history and AI decisions persist across sessions.
            </p>
          </div>
        )}

        <div className="abw-dialog__footer">
          {step === 'type' ? (
            <>
              <button className="abw-btn abw-btn--ghost" onClick={onClose}>Cancel</button>
              <button
                className="abw-btn abw-btn--primary"
                disabled={!selectedType}
                onClick={() => selectedType && setStep('details')}
              >
                Continue →
              </button>
            </>
          ) : (
            <>
              <button className="abw-btn abw-btn--ghost" onClick={() => setStep('type')}>← Back</button>
              <button
                className="abw-btn abw-btn--primary"
                disabled={!name.trim() || !slug.trim()}
                onClick={handleCreate}
              >
                Create project
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
