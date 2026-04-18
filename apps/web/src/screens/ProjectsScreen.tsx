// apps/web/src/screens/ProjectsScreen.tsx — project list + creation.
// Shows all projects with type icon, env, last-active. Primary action: New project.
// Project type picker uses the project-types registry (no demo data — empty state by default).
import { useState } from 'react';
import { listProjectTypes } from '@abw/project-types';
import type { ProjectType, ProjectTypeId, ScaffoldInput } from '@abw/project-types';

// ── Types ─────────────────────────────────────────────────────────────────────

type ProjectEnv = 'dev' | 'staging' | 'preview' | 'production';
type ProjectStatus = 'active' | 'idle' | 'error';

interface Project {
  id:          string;
  name:        string;
  slug:        string;
  typeId:      ProjectTypeId;
  env:         ProjectEnv;
  status:      ProjectStatus;
  lastActiveAt: string | null;
  description?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 2)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function envColor(env: ProjectEnv): string {
  switch (env) {
    case 'production': return 'var(--error-500)';
    case 'staging':    return 'var(--warning-500)';
    case 'preview':    return 'var(--accent-500)';
    default:           return 'var(--text-secondary)';
  }
}

function statusDot(status: ProjectStatus): string {
  switch (status) {
    case 'active': return 'var(--success-500)';
    case 'error':  return 'var(--error-500)';
    default:       return 'var(--border-base)';
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProjectsScreen() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNew, setShowNew]   = useState(false);
  const [search, setSearch]     = useState('');

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.slug.toLowerCase().includes(search.toLowerCase()),
  );

  function handleCreate(data: { name: string; slug: string; typeId: ProjectTypeId; description: string }) {
    const newProject: Project = {
      id:           crypto.randomUUID(),
      name:         data.name,
      slug:         data.slug,
      typeId:       data.typeId,
      env:          'dev',
      status:       'idle',
      lastActiveAt: null,
      description:  data.description,
    };
    setProjects((prev) => [newProject, ...prev]);
    setShowNew(false);
  }

  return (
    <div className="abw-screen">
      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Projects</h1>
          <p className="abw-screen__sub">
            {projects.length === 0
              ? 'No projects yet — create your first to get started.'
              : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
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
      {projects.length > 0 && (
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
      {projects.length === 0 ? (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>🗂</span>
          <p className="abw-empty-state__label">No projects</p>
          <p className="abw-empty-state__sub">
            Start by choosing a project type. Each project gets its own file system, preview sandbox, and verification matrix.
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
        /* Project grid */
        <div className="abw-projects__grid">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      {/* New project dialog */}
      {showNew && (
        <NewProjectDialog
          onClose={() => setShowNew(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}

// ── ProjectCard ───────────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const types = listProjectTypes();
  const pt    = types.find((t) => t.id === project.typeId);

  return (
    <div className="abw-project-card" aria-label={project.name}>
      <div className="abw-project-card__header">
        <span className="abw-project-card__icon" aria-hidden>{pt?.icon ?? '📦'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="abw-project-card__name">{project.name}</p>
          <p className="abw-project-card__slug">/{project.slug}</p>
        </div>
        <span
          className="abw-project-card__status-dot"
          style={{ background: statusDot(project.status) }}
          aria-label={`Status: ${project.status}`}
          title={project.status}
        />
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

      <div className="abw-project-card__actions">
        <button className="abw-btn abw-btn--secondary abw-btn--sm" style={{ flex: 1 }}>
          Open workspace
        </button>
        <button className="abw-btn abw-btn--ghost abw-btn--sm" aria-label="Project settings">
          ⚙
        </button>
      </div>
    </div>
  );
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
  const [step, setStep]         = useState<'type' | 'details'>('type');
  const [selectedType, setSelectedType] = useState<ProjectType | null>(null);
  const [name, setName]         = useState('');
  const [slug, setSlug]         = useState('');
  const [description, setDesc]  = useState('');

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
          /* Type picker grid */
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
          /* Details form */
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
                Used for preview URL: <code style={{ fontSize: '0.6875rem' }}>{slug || 'my-website'}.preview.local</code>
              </p>
            </div>
            <div>
              <label className="abw-field-label" htmlFor="proj-desc">Description <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(optional)</span></label>
              <input
                id="proj-desc"
                className="abw-input"
                type="text"
                placeholder="Short description"
                value={description}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
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
