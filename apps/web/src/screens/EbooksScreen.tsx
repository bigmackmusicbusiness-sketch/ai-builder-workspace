// apps/web/src/screens/EbooksScreen.tsx — eBook Generator UI.
// Create form + live SSE progress + library list with PDF/EPUB/KDP downloads.
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { useProjectStore } from '../lib/store/projectStore';
import { useAuthStore } from '../lib/store/authStore';

// ── Types ─────────────────────────────────────────────────────────────────────

type EbookStyle =
  | 'professional_business' | 'lead_magnet' | 'narrative_story' | 'how_to_guide'
  | 'academic' | 'cookbook' | 'kdp_novel' | 'picture_book';

type Genre =
  | 'literary' | 'thriller' | 'romance' | 'sci_fi' | 'fantasy'
  | 'mystery'  | 'memoir'   | 'ya';

type POV = 'first' | 'close_third' | 'omniscient';

type Status = 'generating' | 'ready' | 'failed';

type EbookMode = 'generate' | 'format';

type ChapterDelimiter = 'heading' | 'double_newline' | 'triple_newline' | 'manual';

interface EbookRow {
  id:                string;
  projectId:         string | null;
  title:             string;
  style:             EbookStyle;
  genre:             Genre | null;
  mode:              EbookMode;
  status:            Status;
  pdfAssetId:        string | null;
  epubAssetId:       string | null;
  coverAssetId:      string | null;
  kdpBundleAssetId:  string | null;
  error:             string | null;
  createdAt:         string;
}

type EbookTab = 'project' | 'library';

interface GenerateFormState {
  title:           string;
  subtitle:        string;
  author:          string;
  topic:           string;
  audience:        string;
  tone:            string;
  genre:           Genre;
  pov:             POV;
  style:           EbookStyle;
  chapterCount:    number;
  wordCountTarget: number;
  generateCover:   boolean;
  coverGuidance:   string;
}

interface FormatFormState {
  title:            string;
  subtitle:         string;
  author:           string;
  genre:            Genre | '';
  tone:             string;
  style:            EbookStyle;
  manuscript:       string;
  chapterDelimiter: ChapterDelimiter;
  generateCover:    boolean;
  coverGuidance:    string;
}

const DEFAULT_FORM: GenerateFormState = {
  title:           '',
  subtitle:        '',
  author:          '',
  topic:           '',
  audience:        '',
  tone:            '',
  genre:           'literary',
  pov:             'close_third',
  style:           'lead_magnet',
  chapterCount:    5,
  wordCountTarget: 800,
  generateCover:   true,
  coverGuidance:   '',
};

const DEFAULT_FORMAT_FORM: FormatFormState = {
  title:            '',
  subtitle:         '',
  author:           '',
  genre:            '',
  tone:             '',
  style:            'kdp_novel',
  manuscript:       '',
  chapterDelimiter: 'heading',
  generateCover:    true,
  coverGuidance:    '',
};

const DELIMITERS: { id: ChapterDelimiter; label: string; hint: string }[] = [
  { id: 'heading',         label: 'Headings (recommended)', hint: 'Splits on # Chapter / ## headings or "Chapter N" lines' },
  { id: 'double_newline',  label: 'Double newline',         hint: 'Each block separated by a blank line is a chapter' },
  { id: 'triple_newline',  label: 'Triple newline',         hint: 'Bigger gaps mark chapter breaks; \\n\\n stays as paragraph' },
  { id: 'manual',          label: 'Manual marker',          hint: 'Insert ___CHAPTER___ on its own line between chapters' },
];

const STYLES: { id: EbookStyle; label: string; description: string }[] = [
  { id: 'lead_magnet',           label: 'Lead Magnet',    description: '8.5×11", hero imagery, callouts' },
  { id: 'professional_business', label: 'Business',       description: '6×9", clean Georgia serif' },
  { id: 'how_to_guide',          label: 'How-To Guide',   description: '8.5×11", numbered steps' },
  { id: 'cookbook',              label: 'Cookbook',       description: '7×10", recipe cards' },
  { id: 'academic',              label: 'Academic',       description: '6×9", Times, TOC + refs' },
  { id: 'narrative_story',       label: 'Narrative Story',description: '6×9", drop caps, parchment' },
  { id: 'kdp_novel',             label: 'KDP Novel',      description: '6×9" print-ready, full matter' },
  { id: 'picture_book',          label: 'Picture Book',   description: '8.5×8.5", full-bleed' },
];

const GENRES: { id: Genre; label: string }[] = [
  { id: 'literary',  label: 'Literary'  },
  { id: 'thriller',  label: 'Thriller'  },
  { id: 'romance',   label: 'Romance'   },
  { id: 'sci_fi',    label: 'Sci-Fi'    },
  { id: 'fantasy',   label: 'Fantasy'   },
  { id: 'mystery',   label: 'Mystery'   },
  { id: 'memoir',    label: 'Memoir'    },
  { id: 'ya',        label: 'YA'        },
];

const POVS: { id: POV; label: string }[] = [
  { id: 'first',       label: 'First person'    },
  { id: 'close_third', label: 'Close third'     },
  { id: 'omniscient',  label: 'Omniscient'      },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  if (m < 2)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

// Client-side mirror of apps/api/src/lib/manuscriptParser.ts. Used only for the
// "We'll split your text into N chapters" preview chip — keeps things responsive
// without a server round-trip.
const HEADING_RE = /^(?:#{1,6}\s+.+|(?:chapter|prologue|epilogue|part)\s+[ivxlcdm0-9]+(?:\s*[:.\-—]\s*.*)?)\s*$/im;

function previewChapterCount(manuscript: string, delimiter: ChapterDelimiter): number {
  const text = manuscript.replace(/\r\n/g, '\n').trim();
  if (!text) return 0;
  switch (delimiter) {
    case 'heading': {
      const lines = text.split('\n');
      let count = 0;
      let hasContentBeforeHeadings = false;
      for (const line of lines) {
        if (HEADING_RE.test(line)) count++;
        else if (count === 0 && line.trim()) hasContentBeforeHeadings = true;
      }
      if (count === 0) return 1;
      return count + (hasContentBeforeHeadings ? 1 : 0);
    }
    case 'double_newline':
      return text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean).length || 1;
    case 'triple_newline':
      return text.split(/\n{3,}/).map((b) => b.trim()).filter(Boolean).length || 1;
    case 'manual':
      return text.split(/^___CHAPTER___\s*$/im).map((s) => s.trim()).filter(Boolean).length || 1;
    default:
      return 1;
  }
}

function styleLabel(s: EbookStyle): string {
  return STYLES.find((x) => x.id === s)?.label ?? s;
}

function statusBadge(status: Status): { label: string; color: string } {
  if (status === 'ready')      return { label: 'Ready',      color: 'var(--success-500)' };
  if (status === 'failed')     return { label: 'Failed',     color: 'var(--error-500)'   };
  return                              { label: 'Generating', color: 'var(--accent-500)'  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EbooksScreen(): JSX.Element {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const currentProject   = useProjectStore((s) => s.projects[s.currentProjectId]);
  const allProjects      = useProjectStore((s) => s.projects);
  const projectIdForApi  = currentProjectId === 'global' ? undefined : currentProjectId;
  const hasProject       = currentProjectId !== 'global' && !!currentProject;

  // Default to 'project' when one is selected, otherwise 'library'
  const [tab, setTab]         = useState<EbookTab>(hasProject ? 'project' : 'library');
  const [ebooks, setEbooks]   = useState<EbookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // When project context changes, snap back to the natural default tab
  useEffect(() => {
    setTab(hasProject ? 'project' : 'library');
  }, [hasProject, currentProjectId]);

  // Create form — `null` = no form open; 'chooser' = mode selection; or a mode form
  const [formMode, setFormMode]     = useState<'chooser' | EbookMode | null>(null);
  const [form, setForm]             = useState<GenerateFormState>(DEFAULT_FORM);
  const [formatForm, setFormatForm] = useState<FormatFormState>(DEFAULT_FORMAT_FORM);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress]     = useState<string[]>([]);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const abortRef                    = useRef<AbortController | null>(null);

  const isNovel = form.style === 'kdp_novel' || form.style === 'narrative_story';

  // Live preview of how many chapters the format-mode parser will detect
  const formatChapterCount = useMemo(
    () => previewChapterCount(formatForm.manuscript, formatForm.chapterDelimiter),
    [formatForm.manuscript, formatForm.chapterDelimiter],
  );

  function closeForm() {
    setFormMode(null);
    setProgress([]);
    setActiveStep(null);
  }

  function handleManuscriptFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setFormatForm((f) => ({ ...f, manuscript: text }));
    };
    reader.readAsText(file);
  }

  // ── Fetch ebooks on mount / project change / tab change ───────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Project tab: scope to current project. Library tab: load all across tenant.
    const url = tab === 'project' && projectIdForApi
      ? `/api/ebooks?projectId=${projectIdForApi}`
      : `/api/ebooks`;
    apiFetch<{ ebooks: EbookRow[] }>(url)
      .then((r) => { if (!cancelled) setEbooks(r.ebooks); })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load eBooks.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectIdForApi, tab]);

  function projectName(projectId: string | null): string {
    if (!projectId) return 'No project';
    return allProjects[projectId]?.name ?? 'Unknown project';
  }

  // ── Generate via SSE ───────────────────────────────────────────────────────
  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.author.trim()) {
      setError('Title and author are required.');
      return;
    }
    const token = useAuthStore.getState().session?.access_token;
    if (!token) { setError('Not signed in.'); return; }

    setGenerating(true);
    setError(null);
    setProgress([`Starting: "${form.title}"`]);
    setActiveStep('outline');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/api/ebooks/generate`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify({
          title:           form.title,
          subtitle:        form.subtitle || undefined,
          author:          form.author,
          topic:           form.topic || undefined,
          audience:        form.audience || undefined,
          tone:            form.tone || undefined,
          genre:           isNovel ? form.genre : undefined,
          pov:             form.pov,
          style:           form.style,
          chapterCount:    form.chapterCount,
          wordCountTarget: form.wordCountTarget,
          generateCover:   form.generateCover,
          coverGuidance:   form.coverGuidance || undefined,
          projectId:       projectIdForApi,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        throw new Error(body.error ?? 'Generation failed');
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw) as {
              type:     string;
              step?:    string;
              title?:   string;
              index?:   number;
              chapters?: string[];
              error?:   string;
              message?: string;
              ebookId?: string;
            };

            if (event.type === 'created') {
              setProgress((p) => [...p, `✓ Draft created (id: ${event.ebookId?.slice(0, 8)}…)`]);
            } else if (event.type === 'step') {
              setActiveStep(event.step ?? null);
              if (event.step === 'outline') {
                setProgress((p) => [...p, '→ Generating outline…']);
              } else if (event.step === 'chapter' && typeof event.index === 'number') {
                setProgress((p) => [...p, `→ Drafting chapter ${event.index! + 1}: ${event.title ?? ''}`]);
              } else if (event.step === 'edit' && typeof event.index === 'number') {
                setProgress((p) => [...p, `  ✎ Editor pass on chapter ${event.index! + 1}`]);
              } else if (event.step === 'cover') {
                setProgress((p) => [...p, '→ Generating cover variants…']);
              } else if (event.step === 'pdf') {
                setProgress((p) => [...p, '→ Rendering PDF…']);
              } else if (event.step === 'epub') {
                setProgress((p) => [...p, '→ Building EPUB…']);
              } else if (event.step === 'kdp_bundle') {
                setProgress((p) => [...p, '→ Packaging KDP bundle…']);
              }
            } else if (event.type === 'outline' && event.chapters) {
              setProgress((p) => [...p, `✓ Outline: ${event.chapters!.length} chapters`]);
            } else if (event.type === 'warn') {
              setProgress((p) => [...p, `⚠ ${event.message ?? 'Warning'}`]);
            } else if (event.type === 'done') {
              setProgress((p) => [...p, '✓ Done.']);
              setActiveStep(null);
              // Refresh list
              const url = tab === 'project' && projectIdForApi ? `/api/ebooks?projectId=${projectIdForApi}` : `/api/ebooks`;
              const fresh = await apiFetch<{ ebooks: EbookRow[] }>(url);
              setEbooks(fresh.ebooks);
            } else if (event.type === 'error') {
              throw new Error(event.error ?? 'Generation failed');
            }
          } catch (parseErr) {
            // If parse fails it's a malformed SSE line — skip. If thrown above, rethrow.
            if (parseErr instanceof Error && parseErr.message && !parseErr.message.startsWith('Unexpected')) {
              throw parseErr;
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setProgress((p) => [...p, `✗ ${msg}`]);
    } finally {
      setGenerating(false);
      setActiveStep(null);
      abortRef.current = null;
      // Always refresh the library — the row was inserted at start (status='generating'),
      // so on failure we want the user to see it (with status='failed' and the error).
      try {
        const url = tab === 'project' && projectIdForApi ? `/api/ebooks?projectId=${projectIdForApi}` : `/api/ebooks`;
        const fresh = await apiFetch<{ ebooks: EbookRow[] }>(url);
        setEbooks(fresh.ebooks);
      } catch { /* non-fatal */ }
    }
  }

  // ── Format mode SSE submit ─────────────────────────────────────────────────
  async function handleFormat(e: React.FormEvent) {
    e.preventDefault();
    if (!formatForm.title.trim() || !formatForm.author.trim()) {
      setError('Title and author are required.');
      return;
    }
    if (!formatForm.manuscript.trim()) {
      setError('Paste your manuscript text first.');
      return;
    }
    const token = useAuthStore.getState().session?.access_token;
    if (!token) { setError('Not signed in.'); return; }

    setGenerating(true);
    setError(null);
    setProgress([`Starting: "${formatForm.title}"`]);
    setActiveStep('parsing');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/api/ebooks/format`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify({
          title:            formatForm.title,
          subtitle:         formatForm.subtitle || undefined,
          author:           formatForm.author,
          genre:            formatForm.genre || undefined,
          tone:             formatForm.tone || undefined,
          style:            formatForm.style,
          manuscript:       formatForm.manuscript,
          chapterDelimiter: formatForm.chapterDelimiter,
          generateCover:    formatForm.generateCover,
          coverGuidance:    formatForm.coverGuidance || undefined,
          projectId:        projectIdForApi,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        throw new Error(body.error ?? 'Format failed');
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw) as {
              type: string; step?: string; chapterCount?: number;
              chapters?: string[]; error?: string; message?: string; ebookId?: string;
            };

            if (event.type === 'created') {
              setProgress((p) => [...p, `✓ Draft created (id: ${event.ebookId?.slice(0, 8)}…)`]);
            } else if (event.type === 'step') {
              setActiveStep(event.step ?? null);
              if (event.step === 'parsing') {
                setProgress((p) => [...p, '→ Parsing manuscript into chapters…']);
              } else if (event.step === 'cover') {
                setProgress((p) => [...p, '→ Generating cover variants…']);
              } else if (event.step === 'pdf') {
                setProgress((p) => [...p, '→ Rendering PDF…']);
              } else if (event.step === 'epub') {
                setProgress((p) => [...p, '→ Building EPUB…']);
              }
            } else if (event.type === 'parsed' && event.chapters) {
              setProgress((p) => [...p, `✓ Parsed ${event.chapters!.length} chapter${event.chapters!.length !== 1 ? 's' : ''}`]);
            } else if (event.type === 'warn') {
              setProgress((p) => [...p, `⚠ ${event.message ?? 'Warning'}`]);
            } else if (event.type === 'done') {
              setProgress((p) => [...p, '✓ Done.']);
              setActiveStep(null);
              const url = tab === 'project' && projectIdForApi ? `/api/ebooks?projectId=${projectIdForApi}` : `/api/ebooks`;
              const fresh = await apiFetch<{ ebooks: EbookRow[] }>(url);
              setEbooks(fresh.ebooks);
            } else if (event.type === 'error') {
              throw new Error(event.error ?? 'Format failed');
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message && !parseErr.message.startsWith('Unexpected')) {
              throw parseErr;
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setProgress((p) => [...p, `✗ ${msg}`]);
    } finally {
      setGenerating(false);
      setActiveStep(null);
      abortRef.current = null;
      try {
        const url = tab === 'project' && projectIdForApi ? `/api/ebooks?projectId=${projectIdForApi}` : `/api/ebooks`;
        const fresh = await apiFetch<{ ebooks: EbookRow[] }>(url);
        setEbooks(fresh.ebooks);
      } catch { /* non-fatal */ }
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
    setActiveStep(null);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this eBook? The PDF/EPUB files stay in storage.')) return;
    try {
      await apiFetch(`/api/ebooks/${id}`, { method: 'DELETE' });
      setEbooks((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  function handleDownload(id: string, format: 'pdf' | 'epub' | 'kdp') {
    const url = `${API_BASE}/api/ebooks/${id}/download?format=${format}`;
    const token = useAuthStore.getState().session?.access_token;
    // Open in a new tab — the download route issues a 302 to the public asset URL
    // We need auth for the redirect-issuing endpoint, so fetch first then navigate
    fetch(url, { headers: { Authorization: `Bearer ${token ?? ''}` } })
      .then((res) => {
        if (res.redirected) { window.open(res.url, '_blank'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Download failed'));
  }

  const sortedEbooks = useMemo(
    () => [...ebooks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [ebooks],
  );

  return (
    <div className="abw-screen">
      {/* Error banner */}
      {error && (
        <div className="abw-banner abw-banner--warning" style={{ marginBottom: 'var(--space-4)' }}>
          ⚠ {error}
          <button
            className="abw-btn abw-btn--ghost abw-btn--xs"
            style={{ marginLeft: 'auto' }}
            onClick={() => setError(null)}
          >✕</button>
        </div>
      )}

      {/* Header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">
            {tab === 'project' && hasProject ? `${currentProject!.name} · eBook` : 'eBook Library'}
          </h1>
          <p className="abw-screen__sub">
            {loading
              ? 'Loading…'
              : tab === 'project' && hasProject
              ? (ebooks.length === 0
                ? 'Create the eBook for this project.'
                : `${ebooks.length} eBook${ebooks.length !== 1 ? 's' : ''} in this project`)
              : (ebooks.length === 0
                ? 'No eBooks yet across any project.'
                : `${ebooks.length} eBook${ebooks.length !== 1 ? 's' : ''} across all projects`)}
          </p>
        </div>
        <button
          className="abw-btn abw-btn--primary"
          onClick={() => formMode === null ? setFormMode('chooser') : closeForm()}
          disabled={generating}
        >
          {formMode === null ? '+ New eBook' : '✕ Close'}
        </button>
      </div>

      {/* Tabs: This project · Library */}
      <div role="tablist" aria-label="eBook view" style={{
        display:      'flex',
        gap:          'var(--space-1)',
        borderBottom: '1px solid var(--border-base)',
        marginBottom: 'var(--space-4)',
      }}>
        <button
          role="tab"
          aria-selected={tab === 'project'}
          disabled={!hasProject}
          onClick={() => setTab('project')}
          title={!hasProject ? 'Select a project from the top bar to view its eBook' : undefined}
          style={{
            padding:      '8px 16px',
            background:   'none',
            border:       'none',
            cursor:       hasProject ? 'pointer' : 'not-allowed',
            fontSize:     '0.875rem',
            fontWeight:   600,
            color:        tab === 'project' ? 'var(--accent-500)' : (hasProject ? 'var(--text-secondary)' : 'var(--text-tertiary)'),
            borderBottom: tab === 'project' ? '2px solid var(--accent-500)' : '2px solid transparent',
            marginBottom: -1,
          }}
        >
          📁 This project
        </button>
        <button
          role="tab"
          aria-selected={tab === 'library'}
          onClick={() => setTab('library')}
          style={{
            padding:      '8px 16px',
            background:   'none',
            border:       'none',
            cursor:       'pointer',
            fontSize:     '0.875rem',
            fontWeight:   600,
            color:        tab === 'library' ? 'var(--accent-500)' : 'var(--text-secondary)',
            borderBottom: tab === 'library' ? '2px solid var(--accent-500)' : '2px solid transparent',
            marginBottom: -1,
          }}
        >
          📚 Library
        </button>
      </div>

      {/* Hint when on project tab without a project selected */}
      {tab === 'project' && !hasProject && (
        <div className="abw-banner" style={{ marginBottom: 'var(--space-4)', background: 'var(--surface-base)', border: '1px solid var(--border-base)' }}>
          Select a project from the top bar to lock eBooks to that project, or browse the full Library tab.
        </div>
      )}

      {/* Mode chooser */}
      {formMode === 'chooser' && (
        <div className="abw-card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            What kind of eBook?
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
            Pick how you want to create this book. You can change your mind later — this just sets up the form.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
            <button
              type="button"
              onClick={() => setFormMode('generate')}
              className="abw-btn abw-btn--ghost"
              style={{
                padding: 'var(--space-5)',
                height: 'auto',
                flexDirection: 'column',
                alignItems: 'flex-start',
                textAlign: 'left',
                gap: 'var(--space-2)',
                borderColor: 'var(--border-base)',
              }}
            >
              <span style={{ fontSize: '1.75rem' }} aria-hidden>✨</span>
              <span style={{ fontWeight: 600, fontSize: '1rem' }}>Generate from scratch</span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', whiteSpace: 'normal', lineHeight: 1.5 }}>
                AI writes the entire book based on your topic, audience, and tone. Best for lead magnets, how-to guides, and KDP novels you want drafted from a brief.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFormMode('format')}
              className="abw-btn abw-btn--ghost"
              style={{
                padding: 'var(--space-5)',
                height: 'auto',
                flexDirection: 'column',
                alignItems: 'flex-start',
                textAlign: 'left',
                gap: 'var(--space-2)',
                borderColor: 'var(--border-base)',
              }}
            >
              <span style={{ fontSize: '1.75rem' }} aria-hidden>📖</span>
              <span style={{ fontWeight: 600, fontSize: '1rem' }}>Format my manuscript</span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', whiteSpace: 'normal', lineHeight: 1.5 }}>
                Paste your finished text (or upload a .txt / .md). We split it into chapters, apply a style, optionally generate a cover, and render PDF + EPUB. No AI writing.
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Generate form */}
      {formMode === 'generate' && (
        <form onSubmit={(e) => void handleGenerate(e)} className="abw-card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <label className="abw-field">
              <span className="abw-field__label">Title *</span>
              <input
                className="abw-input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="The Midnight Library"
                required
              />
            </label>
            <label className="abw-field">
              <span className="abw-field__label">Author *</span>
              <input
                className="abw-input"
                value={form.author}
                onChange={(e) => setForm({ ...form, author: e.target.value })}
                placeholder="Your name"
                required
              />
            </label>
            <label className="abw-field">
              <span className="abw-field__label">Subtitle</span>
              <input
                className="abw-input"
                value={form.subtitle}
                onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                placeholder="Optional subtitle"
              />
            </label>
            <label className="abw-field">
              <span className="abw-field__label">Audience</span>
              <input
                className="abw-input"
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value })}
                placeholder="e.g., SaaS founders"
              />
            </label>
            <label className="abw-field" style={{ gridColumn: '1 / -1' }}>
              <span className="abw-field__label">Topic / pitch</span>
              <textarea
                className="abw-input"
                rows={2}
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                placeholder="A one-paragraph description of what this book is about."
              />
            </label>
          </div>

          {/* Style picker */}
          <div style={{ marginTop: 'var(--space-5)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Style</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-2)' }}>
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setForm({ ...form, style: s.id })}
                  className={`abw-btn abw-btn--ghost${form.style === s.id ? ' abw-btn--secondary' : ''}`}
                  style={{
                    textAlign:    'left',
                    padding:      'var(--space-3)',
                    height:       'auto',
                    flexDirection:'column',
                    alignItems:   'flex-start',
                    borderColor:  form.style === s.id ? 'var(--accent-500)' : 'var(--border-base)',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{s.label}</span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {s.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Genre + POV (novels only) */}
          {isNovel && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-5)' }}>
              <label className="abw-field">
                <span className="abw-field__label">Genre</span>
                <select
                  className="abw-input"
                  value={form.genre}
                  onChange={(e) => setForm({ ...form, genre: e.target.value as Genre })}
                >
                  {GENRES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
              </label>
              <label className="abw-field">
                <span className="abw-field__label">Point of view</span>
                <select
                  className="abw-input"
                  value={form.pov}
                  onChange={(e) => setForm({ ...form, pov: e.target.value as POV })}
                >
                  {POVS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
            </div>
          )}

          {/* Length + tone */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-5)' }}>
            <label className="abw-field">
              <span className="abw-field__label">Chapters</span>
              <input
                className="abw-input"
                type="number"
                min={1}
                max={50}
                value={form.chapterCount}
                onChange={(e) => setForm({ ...form, chapterCount: Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)) })}
              />
            </label>
            <label className="abw-field">
              <span className="abw-field__label">Words / chapter</span>
              <input
                className="abw-input"
                type="number"
                min={300}
                max={5000}
                step={100}
                value={form.wordCountTarget}
                onChange={(e) => setForm({ ...form, wordCountTarget: Math.max(300, Math.min(5000, parseInt(e.target.value, 10) || 800)) })}
              />
            </label>
            <label className="abw-field">
              <span className="abw-field__label">Tone</span>
              <input
                className="abw-input"
                value={form.tone}
                onChange={(e) => setForm({ ...form, tone: e.target.value })}
                placeholder="e.g., warm, punchy"
              />
            </label>
          </div>

          {/* Cover */}
          <div style={{ marginTop: 'var(--space-5)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.generateCover}
                onChange={(e) => setForm({ ...form, generateCover: e.target.checked })}
              />
              <span style={{ fontSize: '0.875rem' }}>Generate AI cover (3 variants)</span>
            </label>
            {form.generateCover && (
              <label className="abw-field" style={{ marginTop: 'var(--space-3)' }}>
                <span className="abw-field__label">Cover guidance (optional)</span>
                <input
                  className="abw-input"
                  value={form.coverGuidance}
                  onChange={(e) => setForm({ ...form, coverGuidance: e.target.value })}
                  placeholder="e.g., moody neon cityscape, rain-slicked streets"
                />
              </label>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)' }}>
            <button type="submit" className="abw-btn abw-btn--primary" disabled={generating}>
              {generating ? 'Generating…' : 'Generate eBook'}
            </button>
            {generating && (
              <button type="button" className="abw-btn abw-btn--ghost" onClick={handleCancel}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="abw-btn abw-btn--ghost"
              disabled={generating}
              onClick={() => setForm(DEFAULT_FORM)}
            >
              Reset
            </button>
          </div>

          {/* Progress log */}
          {progress.length > 0 && (
            <div
              style={{
                marginTop:    'var(--space-5)',
                padding:      'var(--space-3)',
                background:   'var(--surface-base)',
                border:       '1px solid var(--border-base)',
                borderRadius: 'var(--radius-field)',
                fontFamily:   'var(--font-mono, monospace)',
                fontSize:     '0.75rem',
                lineHeight:   1.6,
                maxHeight:    220,
                overflowY:    'auto',
              }}
              aria-live="polite"
              aria-atomic="false"
            >
              {progress.map((line, i) => (
                <div key={i} style={{ color: line.startsWith('✗') || line.startsWith('⚠') ? 'var(--error-500)' : 'var(--text-secondary)' }}>
                  {line}
                </div>
              ))}
              {activeStep && (
                <div style={{ color: 'var(--accent-500)', marginTop: 'var(--space-1)' }}>
                  ● {activeStep}…
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {/* Format-mode form */}
      {formMode === 'format' && (
        <form onSubmit={(e) => void handleFormat(e)} className="abw-card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-4)' }}>
            <div>
              <h2 style={{ fontSize: '1.0625rem', fontWeight: 600 }}>📖 Format my manuscript</h2>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                Paste your text below. We&apos;ll split it into chapters and render a styled PDF + EPUB.
              </p>
            </div>
            <button type="button" className="abw-btn abw-btn--ghost abw-btn--sm" onClick={() => setFormMode('chooser')} disabled={generating}>
              ← Back
            </button>
          </div>

          {/* Title / Author / Subtitle / Tone */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <label className="abw-field">
              <span className="abw-field__label">Title *</span>
              <input
                className="abw-input"
                value={formatForm.title}
                onChange={(e) => setFormatForm({ ...formatForm, title: e.target.value })}
                placeholder="My Novel"
                required
              />
            </label>
            <label className="abw-field">
              <span className="abw-field__label">Author *</span>
              <input
                className="abw-input"
                value={formatForm.author}
                onChange={(e) => setFormatForm({ ...formatForm, author: e.target.value })}
                placeholder="Your name"
                required
              />
            </label>
            <label className="abw-field">
              <span className="abw-field__label">Subtitle</span>
              <input
                className="abw-input"
                value={formatForm.subtitle}
                onChange={(e) => setFormatForm({ ...formatForm, subtitle: e.target.value })}
                placeholder="Optional subtitle"
              />
            </label>
            <label className="abw-field">
              <span className="abw-field__label">Tone (optional, used for cover)</span>
              <input
                className="abw-input"
                value={formatForm.tone}
                onChange={(e) => setFormatForm({ ...formatForm, tone: e.target.value })}
                placeholder="e.g., dark, hopeful"
              />
            </label>
          </div>

          {/* Style picker */}
          <div style={{ marginTop: 'var(--space-5)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Style</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-2)' }}>
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setFormatForm({ ...formatForm, style: s.id })}
                  className={`abw-btn abw-btn--ghost${formatForm.style === s.id ? ' abw-btn--secondary' : ''}`}
                  style={{
                    textAlign:    'left',
                    padding:      'var(--space-3)',
                    height:       'auto',
                    flexDirection:'column',
                    alignItems:   'flex-start',
                    borderColor:  formatForm.style === s.id ? 'var(--accent-500)' : 'var(--border-base)',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{s.label}</span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {s.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Manuscript textarea + file upload */}
          <div style={{ marginTop: 'var(--space-5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
              <span className="abw-field__label">Manuscript *</span>
              <label className="abw-btn abw-btn--ghost abw-btn--xs" style={{ cursor: 'pointer' }}>
                📁 Upload .txt or .md
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleManuscriptFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <textarea
              className="abw-input"
              rows={14}
              style={{ minHeight: 320, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8125rem' }}
              value={formatForm.manuscript}
              onChange={(e) => setFormatForm({ ...formatForm, manuscript: e.target.value })}
              placeholder={'Paste your full manuscript here…\n\n# Chapter 1\nIt was a dark and stormy night.\n\n# Chapter 2\nThe morning came too soon.'}
              required
            />
          </div>

          {/* Chapter delimiter */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <p className="abw-field__label" style={{ marginBottom: 'var(--space-2)' }}>Chapter detection</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-2)' }}>
              {DELIMITERS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setFormatForm({ ...formatForm, chapterDelimiter: d.id })}
                  className={`abw-btn abw-btn--ghost${formatForm.chapterDelimiter === d.id ? ' abw-btn--secondary' : ''}`}
                  style={{
                    textAlign: 'left',
                    padding: 'var(--space-3)',
                    height: 'auto',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    borderColor: formatForm.chapterDelimiter === d.id ? 'var(--accent-500)' : 'var(--border-base)',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{d.label}</span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginTop: 2, whiteSpace: 'normal' }}>
                    {d.hint}
                  </span>
                </button>
              ))}
            </div>
            {formatForm.manuscript.trim().length > 0 && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
                Preview: <strong>{formatChapterCount}</strong> chapter{formatChapterCount !== 1 ? 's' : ''} detected.
              </p>
            )}
          </div>

          {/* Cover */}
          <div style={{ marginTop: 'var(--space-5)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={formatForm.generateCover}
                onChange={(e) => setFormatForm({ ...formatForm, generateCover: e.target.checked })}
              />
              <span style={{ fontSize: '0.875rem' }}>Generate AI cover (3 variants)</span>
            </label>
            {formatForm.generateCover && (
              <label className="abw-field" style={{ marginTop: 'var(--space-3)' }}>
                <span className="abw-field__label">Cover guidance (optional)</span>
                <input
                  className="abw-input"
                  value={formatForm.coverGuidance}
                  onChange={(e) => setFormatForm({ ...formatForm, coverGuidance: e.target.value })}
                  placeholder="e.g., minimal type on a deep blue field"
                />
              </label>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)' }}>
            <button type="submit" className="abw-btn abw-btn--primary" disabled={generating}>
              {generating ? 'Rendering…' : 'Format & render'}
            </button>
            {generating && (
              <button type="button" className="abw-btn abw-btn--ghost" onClick={handleCancel}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="abw-btn abw-btn--ghost"
              disabled={generating}
              onClick={() => setFormatForm(DEFAULT_FORMAT_FORM)}
            >
              Reset
            </button>
          </div>

          {/* Progress log */}
          {progress.length > 0 && (
            <div
              style={{
                marginTop:    'var(--space-5)',
                padding:      'var(--space-3)',
                background:   'var(--surface-base)',
                border:       '1px solid var(--border-base)',
                borderRadius: 'var(--radius-field)',
                fontFamily:   'var(--font-mono, monospace)',
                fontSize:     '0.75rem',
                lineHeight:   1.6,
                maxHeight:    220,
                overflowY:    'auto',
              }}
              aria-live="polite"
              aria-atomic="false"
            >
              {progress.map((line, i) => (
                <div key={i} style={{ color: line.startsWith('✗') || line.startsWith('⚠') ? 'var(--error-500)' : 'var(--text-secondary)' }}>
                  {line}
                </div>
              ))}
              {activeStep && (
                <div style={{ color: 'var(--accent-500)', marginTop: 'var(--space-1)' }}>
                  ● {activeStep}…
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {/* Library */}
      {loading ? (
        <div className="abw-empty-state">
          <p className="abw-empty-state__sub">Loading eBooks…</p>
        </div>
      ) : sortedEbooks.length === 0 ? (
        <div className="abw-empty-state">
          <span className="abw-empty-state__icon" aria-hidden>📖</span>
          <p className="abw-empty-state__label">No eBooks yet</p>
          <p className="abw-empty-state__sub">
            Generate a KDP-ready novel, a picture-heavy lead magnet, a cookbook, or anything in between.
          </p>
          {formMode === null && (
            <button className="abw-btn abw-btn--primary" onClick={() => setFormMode('chooser')}>
              + Create your first eBook
            </button>
          )}
        </div>
      ) : (
        <div className="abw-table-wrap">
          <table className="abw-table" aria-label="eBooks">
            <thead>
              <tr>
                <th>Title</th>
                {tab === 'library' && <th style={{ width: 160 }}>Project</th>}
                <th style={{ width: 140 }}>Style</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 110 }}>Created</th>
                <th style={{ width: 280 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sortedEbooks.map((e) => {
                const badge = statusBadge(e.status);
                return (
                  <tr key={e.id}>
                    <td>
                      <span className="abw-table__name" style={{ fontWeight: 600 }}>
                        <span title={e.mode === 'format' ? 'Manuscript formatted from your text' : 'AI-generated'} style={{ marginRight: 6 }} aria-hidden>
                          {e.mode === 'format' ? '📖' : '✨'}
                        </span>
                        {e.title}
                      </span>
                      {e.genre && (
                        <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', display: 'block', marginLeft: 22 }}>
                          {e.genre.replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    {tab === 'library' && (
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {projectName(e.projectId)}
                      </td>
                    )}
                    <td>
                      <span className="abw-badge" style={{ fontSize: '0.625rem' }}>{styleLabel(e.style)}</span>
                    </td>
                    <td>
                      <span style={{ color: badge.color, fontSize: '0.75rem', fontWeight: 600 }}>
                        ● {badge.label}
                      </span>
                      {e.status === 'failed' && e.error && (
                        <span
                          title={e.error}
                          style={{ display: 'block', fontSize: '0.625rem', color: 'var(--text-tertiary)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {e.error}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {relativeTime(e.createdAt)}
                    </td>
                    <td>
                      <div className="abw-table__actions">
                        <button
                          className="abw-btn abw-btn--ghost abw-btn--xs"
                          disabled={!e.pdfAssetId}
                          onClick={() => handleDownload(e.id, 'pdf')}
                          aria-label={`Download PDF for ${e.title}`}
                        >
                          PDF
                        </button>
                        <button
                          className="abw-btn abw-btn--ghost abw-btn--xs"
                          disabled={!e.epubAssetId}
                          onClick={() => handleDownload(e.id, 'epub')}
                          aria-label={`Download EPUB for ${e.title}`}
                        >
                          EPUB
                        </button>
                        {e.style === 'kdp_novel' && (
                          <button
                            className="abw-btn abw-btn--ghost abw-btn--xs"
                            disabled={!e.kdpBundleAssetId}
                            onClick={() => handleDownload(e.id, 'kdp')}
                            aria-label={`Download KDP bundle for ${e.title}`}
                          >
                            KDP ZIP
                          </button>
                        )}
                        <button
                          className="abw-btn abw-btn--ghost abw-btn--xs abw-btn--destructive"
                          onClick={() => void handleDelete(e.id)}
                          aria-label={`Delete ${e.title}`}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
