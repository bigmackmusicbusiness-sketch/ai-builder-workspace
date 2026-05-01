// apps/web/src/screens/TemplatesScreen.tsx — browse & scaffold project templates.
// Shows all registered project types. "Use template" opens a scaffold dialog that
// calls the project-types registry scaffold() to preview the file tree.
import { useState } from 'react';
import { listProjectTypes } from '@abw/project-types';
import type { ProjectType, ProjectTypeId } from '@abw/project-types';

// ── Types ─────────────────────────────────────────────────────────────────────

type CategoryFilter = 'all' | 'web' | 'backend' | 'saas' | 'tool' | 'creative' | 'video';

// ── Category mapping ───────────────────────────────────────────────────────────

const TYPE_CATEGORIES: Record<ProjectTypeId, CategoryFilter> = {
  'website':          'web',
  'landing-page':     'web',
  'dashboard':        'web',
  'saas-app':         'saas',
  'full-stack-app':   'saas',
  'api-service':      'backend',
  'internal-tool':    'tool',
  'onboarding-flow':  'tool',
  'automation-panel': 'tool',
  'ebook':            'creative',
  'document':         'creative',
  'email-composer':   'creative',
  'music-studio':     'creative',
  'ai-movie':         'video',
  'ai-commercial':    'video',
  'ai-short':         'video',
  'ai-music-video':   'video',
  'blank':            'all',
};

const CATEGORY_FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: 'all',      label: 'All templates'      },
  { id: 'web',      label: 'Web & Marketing'     },
  { id: 'saas',     label: 'SaaS & Full-Stack'   },
  { id: 'backend',  label: 'Backend & API'       },
  { id: 'tool',     label: 'Tools & Automation'  },
  { id: 'creative', label: 'Creative Suite'      },
  { id: 'video',    label: 'Video Suite'         },
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TemplatesScreen() {
  const allTypes   = listProjectTypes();
  const [filter, setFilter]   = useState<CategoryFilter>('all');
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState<ProjectType | null>(null);

  const filtered = allTypes.filter((t) => {
    const catMatch = filter === 'all' || TYPE_CATEGORIES[t.id] === filter || TYPE_CATEGORIES[t.id] === 'all';
    const searchMatch = search === '' ||
      t.label.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase());
    return catMatch && searchMatch;
  });

  return (
    <div className="abw-screen">
      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Templates</h1>
          <p className="abw-screen__sub">
            {allTypes.length} project templates. Each scaffolds a complete file tree ready to build and deploy.
          </p>
        </div>
      </div>

      {/* Search + filter */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="abw-input"
          type="search"
          placeholder="Search templates…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search templates"
          style={{ maxWidth: 280 }}
        />
      </div>

      {/* Category tabs */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Template categories">
        {CATEGORY_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={filter === id}
            className={`abw-screen__tab${filter === id ? ' abw-screen__tab--active' : ''}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Template grid */}
      {filtered.length === 0 ? (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>🔍</span>
          <p className="abw-empty-state__label">No templates match &ldquo;{search}&rdquo;</p>
          <p className="abw-empty-state__sub">Try a broader search or choose a different category.</p>
        </div>
      ) : (
        <div className="abw-template-grid">
          {filtered.map((pt) => (
            <TemplateCard key={pt.id} type={pt} onUse={() => setSelected(pt)} />
          ))}
        </div>
      )}

      {/* Scaffold dialog */}
      {selected && (
        <ScaffoldDialog
          type={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ── TemplateCard ──────────────────────────────────────────────────────────────

function TemplateCard({ type, onUse }: { type: ProjectType; onUse: () => void }) {
  const adapterCount = type.defaultVerificationMatrix.length;

  return (
    <div className="abw-template-card" aria-label={type.label}>
      <div className="abw-template-card__icon" aria-hidden>{type.icon}</div>
      <div className="abw-template-card__body">
        <h2 className="abw-template-card__title">{type.label}</h2>
        <p className="abw-template-card__desc">{type.description}</p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'auto' }}>
          {type.screens.slice(0, 3).map((s) => (
            <span key={s} className="abw-badge" style={{ fontSize: '0.5625rem' }}>{s}</span>
          ))}
          {type.screens.length > 3 && (
            <span style={{ fontSize: '0.625rem', color: 'var(--text-secondary)' }}>+{type.screens.length - 3} more</span>
          )}
        </div>
      </div>
      <div className="abw-template-card__footer">
        <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
          {adapterCount} verification check{adapterCount !== 1 ? 's' : ''}
        </span>
        <button
          className="abw-btn abw-btn--primary abw-btn--sm"
          onClick={onUse}
          aria-label={`Use ${type.label} template`}
        >
          Use template
        </button>
      </div>
    </div>
  );
}

// ── ScaffoldDialog ────────────────────────────────────────────────────────────

function ScaffoldDialog({ type, onClose }: { type: ProjectType; onClose: () => void }) {
  const [name, setName]   = useState('');
  const [slug, setSlug]   = useState('');
  const [preview, setPreview] = useState(false);

  function handleNameChange(val: string) {
    setName(val);
    setSlug(slugify(val));
  }

  const fileTree = name.trim() && slug.trim()
    ? type.scaffold({ projectName: name.trim(), projectSlug: slug.trim() })
    : null;

  const fileList = fileTree ? Object.keys(fileTree).sort() : [];

  return (
    <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label={`Use ${type.label} template`}>
      <div className="abw-dialog" style={{ width: 'min(620px, 94vw)', maxHeight: '90vh' }}>
        <div className="abw-dialog__header">
          <h2 className="abw-dialog__title">{type.icon} {type.label}</h2>
          <button className="abw-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="abw-dialog__body" style={{ gap: 'var(--space-4)' }}>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{type.description}</p>

          <div>
            <label className="abw-field-label" htmlFor="tmpl-name">Project name</label>
            <input
              id="tmpl-name"
              className="abw-input"
              type="text"
              placeholder="My Project"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          <div>
            <label className="abw-field-label" htmlFor="tmpl-slug">Slug</label>
            <input
              id="tmpl-slug"
              className="abw-input"
              type="text"
              placeholder="my-project"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>

          {/* Preview toggle */}
          {fileList.length > 0 && (
            <div>
              <button
                className="abw-btn abw-btn--ghost abw-btn--sm"
                onClick={() => setPreview((p) => !p)}
                aria-expanded={preview}
              >
                {preview ? '▾' : '▸'} {fileList.length} files to scaffold
              </button>
              {preview && (
                <div style={{
                  marginTop: 'var(--space-2)',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-field)',
                  padding: 'var(--space-3)',
                  maxHeight: 200,
                  overflowY: 'auto',
                }}>
                  {fileList.map((path) => (
                    <p key={path} style={{ margin: '2px 0', fontFamily: 'monospace', fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                      {path}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Verification matrix preview */}
          <div>
            <p className="abw-field-label">Default verification</p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {type.defaultVerificationMatrix.map((a) => (
                <span key={a} className="abw-badge" style={{ fontSize: '0.625rem' }}>{a}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="abw-dialog__footer">
          <button className="abw-btn abw-btn--ghost" onClick={onClose}>Cancel</button>
          <button
            className="abw-btn abw-btn--primary"
            disabled={!name.trim() || !slug.trim()}
            onClick={() => {
              // TODO: POST /api/projects with typeId + scaffold call server-side
              alert(`Scaffold "${name}" as ${type.label} — API route not yet wired. Files will appear in the project once connected.`);
              onClose();
            }}
          >
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}
