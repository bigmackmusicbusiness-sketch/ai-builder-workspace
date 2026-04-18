// apps/web/src/layout/MainWorkspace/modes/VisualQAMode.tsx — visual QA grid.
// Route × viewport grid of screenshots with diff overlay.
// Click a cell to see screenshot + diff + console at capture time.
// Baselines are editable (audit-logged via /api/tests/baseline).
import { useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

const VIEWPORTS = [360, 768, 1280, 1440] as const;
type Viewport = typeof VIEWPORTS[number];

interface VisualCell {
  route:         string;
  viewport:      Viewport;
  screenshotUrl: string | null;
  baselineUrl:   string | null;
  diffPct:       number | null;
  passed:        boolean | null;
  capturedAt:    string | null;
  checkId:       string | null;
}

type CellStatus = 'empty' | 'no-baseline' | 'passed' | 'failed' | 'error';

function cellStatus(cell: VisualCell): CellStatus {
  if (!cell.screenshotUrl)     return 'empty';
  if (!cell.baselineUrl)       return 'no-baseline';
  if (cell.passed === null)    return 'no-baseline';
  if (cell.passed)             return 'passed';
  return cell.diffPct !== null ? 'failed' : 'error';
}

// ── Status colors ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<CellStatus, { border: string; bg: string; label: string }> = {
  empty:        { border: 'var(--border-subtle)', bg: 'var(--bg-elevated)',  label: 'No capture' },
  'no-baseline':{ border: 'var(--border-base)',   bg: 'var(--bg-elevated)',  label: 'No baseline' },
  passed:       { border: 'var(--success-500)',   bg: 'var(--bg-elevated)',  label: 'Passed' },
  failed:       { border: 'var(--error-500)',     bg: 'var(--bg-elevated)',  label: 'Regression' },
  error:        { border: 'var(--error-300)',     bg: 'var(--bg-elevated)',  label: 'Error' },
};

// ── Cell component ────────────────────────────────────────────────────────────

function GridCell({
  cell,
  onClick,
}: {
  cell:    VisualCell;
  onClick: (cell: VisualCell) => void;
}) {
  const status = cellStatus(cell);
  const style  = STATUS_STYLE[status];

  return (
    <button
      className="abw-vqa-cell"
      style={{ borderColor: style.border, background: style.bg }}
      onClick={() => onClick(cell)}
      aria-label={`${cell.route} at ${cell.viewport}px — ${style.label}`}
      title={`${cell.route} · ${cell.viewport}px · ${style.label}${cell.diffPct !== null ? ` · ${cell.diffPct.toFixed(1)}% diff` : ''}`}
    >
      {cell.screenshotUrl ? (
        <img
          src={cell.screenshotUrl}
          alt={`${cell.route} @${cell.viewport}px`}
          className="abw-vqa-cell__img"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className="abw-vqa-cell__empty">
          <span aria-hidden>📷</span>
          <span>{status === 'empty' ? 'No capture' : 'No baseline'}</span>
        </div>
      )}

      {/* Diff badge */}
      {cell.diffPct !== null && cell.diffPct > 0 && (
        <span className="abw-vqa-cell__diff-badge">
          {cell.diffPct.toFixed(1)}%
        </span>
      )}

      {/* Status dot */}
      <span
        className="abw-vqa-cell__status-dot"
        style={{ background: style.border }}
        aria-hidden
      />
    </button>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  cell,
  onClose,
  onSetBaseline,
}: {
  cell:           VisualCell;
  onClose:        () => void;
  onSetBaseline:  (cell: VisualCell) => Promise<void>;
}) {
  const [setting, setSetting] = useState(false);
  const status = cellStatus(cell);

  const handleSetBaseline = async () => {
    setSetting(true);
    try { await onSetBaseline(cell); } finally { setSetting(false); }
  };

  return (
    <div className="abw-vqa-detail">
      {/* Header */}
      <div className="abw-vqa-detail__header">
        <div>
          <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>{cell.route}</span>
          <span style={{ color: 'var(--text-secondary)', marginLeft: 'var(--space-2)', fontSize: '0.8125rem' }}>
            @{cell.viewport}px
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {cell.screenshotUrl && (
            <button
              className="abw-btn abw-btn--ghost abw-btn--xs"
              onClick={() => void handleSetBaseline()}
              disabled={setting}
              title="Promote this screenshot to baseline (audit-logged)"
            >
              {setting ? 'Saving…' : '⊕ Set as baseline'}
            </button>
          )}
          <button className="abw-btn abw-btn--ghost abw-btn--xs" onClick={onClose} aria-label="Close detail">✕</button>
        </div>
      </div>

      {/* Status */}
      <div style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ fontSize: '0.75rem', color: STATUS_STYLE[status].border, fontWeight: 600 }}>
          {STATUS_STYLE[status].label}
        </span>
        {cell.diffPct !== null && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: 'var(--space-2)' }}>
            {cell.diffPct.toFixed(2)}% pixel diff
          </span>
        )}
        {cell.capturedAt && (
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', marginLeft: 'var(--space-2)' }}>
            Captured {new Date(cell.capturedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* Screenshots: current | baseline */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', padding: 'var(--space-3)' }}>
        <div>
          <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>CURRENT</p>
          {cell.screenshotUrl ? (
            <img src={cell.screenshotUrl} alt="Current screenshot" style={{ width: '100%', borderRadius: 4, border: '1px solid var(--border-subtle)' }} />
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', borderRadius: 4, color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
              No screenshot
            </div>
          )}
        </div>
        <div>
          <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>BASELINE</p>
          {cell.baselineUrl ? (
            <img src={cell.baselineUrl} alt="Baseline screenshot" style={{ width: '100%', borderRadius: 4, border: '1px solid var(--border-subtle)' }} />
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', borderRadius: 4, color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
              {cell.screenshotUrl ? 'No baseline set — click "Set as baseline" above' : 'No screenshots captured yet'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const SAMPLE_ROUTES = ['/', '/pricing', '/docs'];

function makeEmptyGrid(routes: string[]): VisualCell[] {
  return routes.flatMap((route) =>
    VIEWPORTS.map((viewport) => ({
      route, viewport,
      screenshotUrl: null, baselineUrl: null,
      diffPct: null, passed: null,
      capturedAt: null, checkId: null,
    })),
  );
}

export function VisualQAMode() {
  const [routes]    = useState<string[]>(SAMPLE_ROUTES);
  const [cells, setCells]     = useState<VisualCell[]>(() => makeEmptyGrid(SAMPLE_ROUTES));
  const [selected, setSelected] = useState<VisualCell | null>(null);
  const [capturing, setCapturing] = useState(false);

  const handleCapture = useCallback(async () => {
    setCapturing(true);
    try {
      const res = await fetch('/api/tests/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          projectId:   '00000000-0000-0000-0000-000000000000',
          projectRoot: '.',
          adapters:    ['screenshotDiff'],
        }),
      });
      const data = await res.json() as {
        results?: Array<{
          adapter: string;
          ok: boolean;
          summary: string;
        }>;
      };
      // In real impl, fetch updated visual_checks from /api/tests/results
      // and update cells. For now: show a stub update.
      void data;
    } catch { /* ignore */ } finally {
      setCapturing(false);
    }
  }, []);

  const handleSetBaseline = useCallback(async (cell: VisualCell) => {
    if (!cell.checkId) return;
    await fetch('/api/tests/baseline', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ projectId: '00000000-0000-0000-0000-000000000000', visualCheckId: cell.checkId }),
    });
    setCells((prev) => prev.map((c) =>
      c.route === cell.route && c.viewport === cell.viewport
        ? { ...c, baselineUrl: c.screenshotUrl, passed: true, diffPct: 0 }
        : c,
    ));
  }, []);

  return (
    <div className="abw-vqa">
      {/* Header */}
      <div className="abw-vqa__header">
        <div>
          <h2 className="abw-vqa__title">Visual QA</h2>
          <p className="abw-vqa__sub">
            {routes.length} route{routes.length !== 1 ? 's' : ''} × {VIEWPORTS.length} viewports = {routes.length * VIEWPORTS.length} cells
          </p>
        </div>
        <button
          className="abw-btn abw-btn--primary abw-btn--sm"
          onClick={() => void handleCapture()}
          disabled={capturing}
          aria-busy={capturing}
        >
          {capturing ? 'Capturing…' : '📷 Capture all'}
        </button>
      </div>

      <div className="abw-vqa__body">
        {/* Grid */}
        <div className="abw-vqa__grid-wrap" style={{ flex: selected ? '0 0 60%' : '1' }}>
          <table className="abw-vqa__grid" aria-label="Visual QA grid">
            <thead>
              <tr>
                <th style={{ width: 120 }}>Route</th>
                {VIEWPORTS.map((vp) => (
                  <th key={vp} style={{ width: 120, textAlign: 'center' }}>{vp}px</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr key={route}>
                  <td style={{ fontSize: '0.8125rem', fontFamily: 'monospace', color: 'var(--text-secondary)', paddingRight: 'var(--space-2)' }}>
                    {route}
                  </td>
                  {VIEWPORTS.map((viewport) => {
                    const cell = cells.find((c) => c.route === route && c.viewport === viewport)!;
                    return (
                      <td key={viewport} style={{ padding: 'var(--space-1)', verticalAlign: 'top' }}>
                        <GridCell cell={cell} onClick={setSelected} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Legend */}
          <div className="abw-vqa__legend">
            {(Object.entries(STATUS_STYLE) as [CellStatus, typeof STATUS_STYLE[CellStatus]][]).map(([key, val]) => (
              <span key={key} className="abw-vqa__legend-item">
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: val.border, display: 'inline-block' }} />
                {val.label}
              </span>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="abw-vqa__detail-wrap">
            <DetailPanel
              cell={selected}
              onClose={() => setSelected(null)}
              onSetBaseline={handleSetBaseline}
            />
          </div>
        )}

        {/* Empty state (no captures yet) */}
        {cells.every((c) => !c.screenshotUrl) && !selected && (
          <div
            className="abw-mode-placeholder"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}
          >
            <span className="abw-mode-placeholder__icon" aria-hidden>🖼</span>
            <span className="abw-mode-placeholder__label">No screenshots yet</span>
            <span className="abw-mode-placeholder__sub">
              Click &ldquo;Capture all&rdquo; to screenshot every route at every viewport.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
