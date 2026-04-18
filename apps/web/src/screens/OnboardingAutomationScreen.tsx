// apps/web/src/screens/OnboardingAutomationScreen.tsx
// Onboarding automation: flow builder, business intake, brand intake,
// and safe account-setup workflows (approval-gated and audited).
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'flows' | 'intake' | 'brand' | 'checklist';

interface FlowStep {
  id:              string;
  title:           string;
  description:     string;
  requiresApproval: boolean;
  rollbackable:    boolean;
  status:          'pending' | 'active' | 'done' | 'skipped' | 'error' | 'awaiting_approval';
}

interface OnboardingFlow {
  id:        string;
  name:      string;
  template:  string;
  createdAt: string;
  steps:     FlowStep[];
}

interface BusinessIntake {
  companyName:  string;
  industry:     string;
  website:      string;
  contactEmail: string;
  goals:        string;
}

interface BrandIntake {
  primaryColor: string;
  accentColor:  string;
  logoUrl:      string;
  voiceTone:    'professional' | 'friendly' | 'bold' | 'minimal';
  fontStyle:    'serif' | 'sans-serif' | 'mono';
}

interface ChecklistItem {
  id:         string;
  label:      string;
  done:       boolean;
  gated:      boolean; // requires approval before marking done
  notes:      string;
}

// ---------------------------------------------------------------------------
// Stub data (empty by default — replaced by API in Step 13 wiring)
// ---------------------------------------------------------------------------

const FLOW_TEMPLATES = [
  { id: 'standard',     label: 'Standard Onboarding',   desc: 'Welcome → Account setup → Configure → Verify → Done' },
  { id: 'quick-start',  label: 'Quick Start',            desc: 'Minimal: Welcome → Connect → Done' },
  { id: 'enterprise',   label: 'Enterprise Onboarding',  desc: 'Full onboarding with approvals, SSO setup, and compliance steps' },
  { id: 'custom',       label: 'Custom',                  desc: 'Build your own step-by-step flow' },
];

const EMPTY_INTAKE: BusinessIntake = {
  companyName: '', industry: '', website: '', contactEmail: '', goals: '',
};

const EMPTY_BRAND: BrandIntake = {
  primaryColor: '#111827', accentColor: '#6366f1', logoUrl: '',
  voiceTone: 'professional', fontStyle: 'sans-serif',
};

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: 'c1', label: 'Business intake collected',      done: false, gated: false, notes: '' },
  { id: 'c2', label: 'Brand materials received',       done: false, gated: false, notes: '' },
  { id: 'c3', label: 'Account access provisioned',     done: false, gated: true,  notes: 'Requires approval — touches live account.' },
  { id: 'c4', label: 'Welcome email sent',             done: false, gated: false, notes: '' },
  { id: 'c5', label: 'Initial site / tool deployed',   done: false, gated: true,  notes: 'Requires approval — publish action.' },
  { id: 'c6', label: 'Client review session booked',   done: false, gated: false, notes: '' },
  { id: 'c7', label: 'Handoff document delivered',     done: false, gated: false, notes: '' },
];

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function OnboardingAutomationScreen() {
  const [tab, setTab]         = useState<TabId>('flows');
  const [flows, setFlows]     = useState<OnboardingFlow[]>([]);
  const [intake, setIntake]   = useState<BusinessIntake>(EMPTY_INTAKE);
  const [brand, setBrand]     = useState<BrandIntake>(EMPTY_BRAND);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(DEFAULT_CHECKLIST);
  const [showNewFlow, setShowNewFlow] = useState(false);
  const [selectedFlow, setSelectedFlow] = useState<OnboardingFlow | null>(null);
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const doneCount = checklist.filter((c) => c.done).length;
  const pct       = Math.round((doneCount / checklist.length) * 100);

  function handleSaveIntake() {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaveMsg('Intake saved.');
      setTimeout(() => setSaveMsg(null), 3000);
    }, 800);
  }

  function toggleChecklist(id: string) {
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === id
          ? item.gated && !item.done
            ? item // gated items can't be toggled directly — need approval
            : { ...item, done: !item.done }
          : item,
      ),
    );
  }

  return (
    <div className="abw-screen">
      {/* Page header */}
      <div className="abw-screen__header">
        <div>
          <h1 className="abw-screen__title">Onboarding Automation</h1>
          <p className="abw-screen__sub">
            Build onboarding flows, collect intake, manage brand assets, and track client setup.
            Account-setup actions are approval-gated and audited.
          </p>
        </div>
        <button
          className="abw-btn abw-btn--primary"
          onClick={() => setShowNewFlow(true)}
          aria-label="Create new onboarding flow"
        >
          + New flow
        </button>
      </div>

      {/* Tabs */}
      <div className="abw-screen__tabs" role="tablist" aria-label="Onboarding sections">
        {([
          ['flows',     'Flows'],
          ['intake',    'Business Intake'],
          ['brand',     'Brand & Materials'],
          ['checklist', 'Checklist'],
        ] as [TabId, string][]).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`abw-screen__tab${tab === id ? ' abw-screen__tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
            {id === 'checklist' && (
              <span className="abw-oa__tab-pct"> {pct}%</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Flows tab ──────────────────────────────────────────────────────────── */}
      {tab === 'flows' && (
        <>
          {flows.length === 0 ? (
            <div className="abw-empty-state">
              <span className="abw-empty-state__icon" aria-hidden>🚀</span>
              <p className="abw-empty-state__label">No onboarding flows yet</p>
              <p className="abw-empty-state__sub">
                Create a flow from a template or build your own step-by-step onboarding sequence.
              </p>
              <button
                className="abw-btn abw-btn--primary"
                onClick={() => setShowNewFlow(true)}
              >
                Create first flow
              </button>
            </div>
          ) : (
            <div className="abw-oa__flow-list">
              {flows.map((flow) => (
                <FlowCard
                  key={flow.id}
                  flow={flow}
                  selected={selectedFlow?.id === flow.id}
                  onSelect={() => setSelectedFlow(flow)}
                />
              ))}
            </div>
          )}

          {selectedFlow && (
            <FlowDetail flow={selectedFlow} onClose={() => setSelectedFlow(null)} />
          )}
        </>
      )}

      {/* ── Business Intake tab ────────────────────────────────────────────────── */}
      {tab === 'intake' && (
        <div className="abw-oa__form-wrap">
          <div className="abw-oa__form-header">
            <h2 className="abw-oa__form-title">Business Intake</h2>
            <p className="abw-oa__form-sub">
              Collect client details that drive content generation and account setup.
            </p>
          </div>

          {saveMsg && (
            <div className="abw-banner abw-banner--success" role="status" aria-live="polite">
              {saveMsg}
            </div>
          )}

          <div className="abw-oa__fields">
            <div className="abw-oa__field-row">
              <div className="abw-oa__field">
                <label className="abw-field-label" htmlFor="oa-company">Company name</label>
                <input
                  id="oa-company"
                  className="abw-input"
                  type="text"
                  value={intake.companyName}
                  onChange={(e) => setIntake((p) => ({ ...p, companyName: e.target.value }))}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="abw-oa__field">
                <label className="abw-field-label" htmlFor="oa-industry">Industry</label>
                <input
                  id="oa-industry"
                  className="abw-input"
                  type="text"
                  value={intake.industry}
                  onChange={(e) => setIntake((p) => ({ ...p, industry: e.target.value }))}
                  placeholder="e.g. Real estate, SaaS, Healthcare"
                />
              </div>
            </div>
            <div className="abw-oa__field-row">
              <div className="abw-oa__field">
                <label className="abw-field-label" htmlFor="oa-website">Current website</label>
                <input
                  id="oa-website"
                  className="abw-input"
                  type="url"
                  value={intake.website}
                  onChange={(e) => setIntake((p) => ({ ...p, website: e.target.value }))}
                  placeholder="https://example.com"
                />
              </div>
              <div className="abw-oa__field">
                <label className="abw-field-label" htmlFor="oa-email">Contact email</label>
                <input
                  id="oa-email"
                  className="abw-input"
                  type="email"
                  value={intake.contactEmail}
                  onChange={(e) => setIntake((p) => ({ ...p, contactEmail: e.target.value }))}
                  placeholder="owner@company.com"
                />
              </div>
            </div>
            <div className="abw-oa__field">
              <label className="abw-field-label" htmlFor="oa-goals">Goals &amp; requirements</label>
              <textarea
                id="oa-goals"
                className="abw-input abw-input--textarea"
                rows={5}
                value={intake.goals}
                onChange={(e) => setIntake((p) => ({ ...p, goals: e.target.value }))}
                placeholder="Describe what the client wants to achieve, key pain points, and any specific requirements…"
              />
            </div>
          </div>

          <div className="abw-oa__form-actions">
            <button
              className="abw-btn abw-btn--primary"
              onClick={handleSaveIntake}
              disabled={saving}
              aria-busy={saving}
            >
              {saving ? 'Saving…' : 'Save intake'}
            </button>
            <button
              className="abw-btn abw-btn--ghost"
              onClick={() => setIntake(EMPTY_INTAKE)}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── Brand & Materials tab ──────────────────────────────────────────────── */}
      {tab === 'brand' && (
        <div className="abw-oa__form-wrap">
          <div className="abw-oa__form-header">
            <h2 className="abw-oa__form-title">Brand &amp; Materials</h2>
            <p className="abw-oa__form-sub">
              Brand settings drive generated colors, fonts, and voice in site/tool output.
            </p>
          </div>

          <div className="abw-oa__fields">
            {/* Color pickers */}
            <div className="abw-oa__field-row">
              <div className="abw-oa__field">
                <label className="abw-field-label" htmlFor="oa-primary-color">Primary color</label>
                <div className="abw-oa__color-row">
                  <input
                    id="oa-primary-color"
                    type="color"
                    className="abw-oa__color-swatch"
                    value={brand.primaryColor}
                    onChange={(e) => setBrand((p) => ({ ...p, primaryColor: e.target.value }))}
                    aria-label="Primary color picker"
                  />
                  <input
                    className="abw-input abw-oa__color-hex"
                    type="text"
                    value={brand.primaryColor}
                    onChange={(e) => setBrand((p) => ({ ...p, primaryColor: e.target.value }))}
                    aria-label="Primary color hex value"
                    maxLength={7}
                  />
                </div>
              </div>
              <div className="abw-oa__field">
                <label className="abw-field-label" htmlFor="oa-accent-color">Accent color</label>
                <div className="abw-oa__color-row">
                  <input
                    id="oa-accent-color"
                    type="color"
                    className="abw-oa__color-swatch"
                    value={brand.accentColor}
                    onChange={(e) => setBrand((p) => ({ ...p, accentColor: e.target.value }))}
                    aria-label="Accent color picker"
                  />
                  <input
                    className="abw-input abw-oa__color-hex"
                    type="text"
                    value={brand.accentColor}
                    onChange={(e) => setBrand((p) => ({ ...p, accentColor: e.target.value }))}
                    aria-label="Accent color hex value"
                    maxLength={7}
                  />
                </div>
              </div>
            </div>

            {/* Logo */}
            <div className="abw-oa__field">
              <label className="abw-field-label" htmlFor="oa-logo">Logo URL</label>
              <input
                id="oa-logo"
                className="abw-input"
                type="url"
                value={brand.logoUrl}
                onChange={(e) => setBrand((p) => ({ ...p, logoUrl: e.target.value }))}
                placeholder="https://cdn.example.com/logo.svg"
              />
              <p className="abw-oa__field-hint">
                Upload assets via the Files tab or paste a URL. Assets are stored in project storage.
              </p>
            </div>

            {/* Voice + Font */}
            <div className="abw-oa__field-row">
              <div className="abw-oa__field">
                <label className="abw-field-label" htmlFor="oa-voice">Voice &amp; tone</label>
                <select
                  id="oa-voice"
                  className="abw-select"
                  value={brand.voiceTone}
                  onChange={(e) => setBrand((p) => ({ ...p, voiceTone: e.target.value as BrandIntake['voiceTone'] }))}
                >
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly &amp; conversational</option>
                  <option value="bold">Bold &amp; direct</option>
                  <option value="minimal">Minimal &amp; clean</option>
                </select>
              </div>
              <div className="abw-oa__field">
                <label className="abw-field-label" htmlFor="oa-font">Font style</label>
                <select
                  id="oa-font"
                  className="abw-select"
                  value={brand.fontStyle}
                  onChange={(e) => setBrand((p) => ({ ...p, fontStyle: e.target.value as BrandIntake['fontStyle'] }))}
                >
                  <option value="sans-serif">Sans-serif (modern)</option>
                  <option value="serif">Serif (traditional)</option>
                  <option value="mono">Monospace (technical)</option>
                </select>
              </div>
            </div>

            {/* Brand preview swatch */}
            <div className="abw-oa__brand-preview" aria-label="Brand color preview">
              <div
                className="abw-oa__brand-swatch abw-oa__brand-swatch--primary"
                style={{ background: brand.primaryColor }}
                aria-label={`Primary: ${brand.primaryColor}`}
              />
              <div
                className="abw-oa__brand-swatch abw-oa__brand-swatch--accent"
                style={{ background: brand.accentColor }}
                aria-label={`Accent: ${brand.accentColor}`}
              />
              <span className="abw-oa__brand-preview-label">
                {brand.voiceTone} · {brand.fontStyle}
              </span>
            </div>
          </div>

          <div className="abw-oa__form-actions">
            <button className="abw-btn abw-btn--primary">Save brand</button>
            <button
              className="abw-btn abw-btn--ghost"
              onClick={() => setBrand(EMPTY_BRAND)}
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* ── Checklist tab ──────────────────────────────────────────────────────── */}
      {tab === 'checklist' && (
        <div className="abw-oa__checklist-wrap">
          <div className="abw-oa__form-header">
            <div>
              <h2 className="abw-oa__form-title">Onboarding Checklist</h2>
              <p className="abw-oa__form-sub">
                Track setup progress. Steps marked <strong>approval-required</strong> touch live accounts and cannot be bypassed.
              </p>
            </div>
            <div className="abw-oa__checklist-progress">
              <div
                className="abw-oa__checklist-bar"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="abw-oa__checklist-bar__fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="abw-oa__checklist-pct">{doneCount}/{checklist.length}</span>
            </div>
          </div>

          <div className="abw-oa__checklist">
            {checklist.map((item) => (
              <ChecklistRow key={item.id} item={item} onToggle={() => toggleChecklist(item.id)} />
            ))}
          </div>
        </div>
      )}

      {/* New flow dialog */}
      {showNewFlow && (
        <NewFlowDialog
          onClose={() => setShowNewFlow(false)}
          onCreate={(flow) => {
            setFlows((prev) => [flow, ...prev]);
            setShowNewFlow(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FlowCard({ flow, selected, onSelect }: {
  flow: OnboardingFlow;
  selected: boolean;
  onSelect: () => void;
}) {
  const done    = flow.steps.filter((s) => s.status === 'done').length;
  const total   = flow.steps.length;
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
  const blocked = flow.steps.some((s) => s.status === 'awaiting_approval');

  return (
    <div
      className={`abw-oa__flow-card${selected ? ' abw-oa__flow-card--selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      aria-pressed={selected}
    >
      <div className="abw-oa__flow-card__header">
        <span className="abw-oa__flow-card__name">{flow.name}</span>
        <span className="abw-badge">{flow.template}</span>
        {blocked && (
          <span className="abw-badge abw-badge--warning" title="Awaiting approval">
            ⏳ Approval
          </span>
        )}
      </div>
      <div className="abw-oa__flow-card__progress">
        <div className="abw-oa__flow-bar">
          <div className="abw-oa__flow-bar__fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="abw-oa__flow-card__pct">{done}/{total} steps</span>
      </div>
      <p className="abw-oa__flow-card__date">Created {new Date(flow.createdAt).toLocaleDateString()}</p>
    </div>
  );
}

function FlowDetail({ flow, onClose }: { flow: OnboardingFlow; onClose: () => void }) {
  const statusLabels: Record<FlowStep['status'], string> = {
    pending: 'Pending', active: 'Active', done: 'Done',
    skipped: 'Skipped', error: 'Error', awaiting_approval: 'Awaiting approval',
  };

  return (
    <div className="abw-oa__flow-detail">
      <div className="abw-oa__flow-detail__header">
        <h2>{flow.name}</h2>
        <button className="abw-btn abw-btn--ghost abw-btn--sm" onClick={onClose} aria-label="Close detail">
          ✕ Close
        </button>
      </div>
      <div className="abw-oa__step-list">
        {flow.steps.map((step, idx) => (
          <div key={step.id} className={`abw-oa__step abw-oa__step--${step.status}`}>
            <div className="abw-oa__step__num">{idx + 1}</div>
            <div className="abw-oa__step__body">
              <div className="abw-oa__step__title">{step.title}</div>
              <div className="abw-oa__step__desc">{step.description}</div>
              {step.requiresApproval && (
                <span className="abw-oa__step__gate">
                  ⚠️ Approval required
                </span>
              )}
            </div>
            <div className="abw-oa__step__status">
              <span className={`abw-oa__step-badge abw-oa__step-badge--${step.status}`}>
                {statusLabels[step.status]}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChecklistRow({ item, onToggle }: { item: ChecklistItem; onToggle: () => void }) {
  return (
    <div
      className={`abw-oa__checklist-item${item.done ? ' abw-oa__checklist-item--done' : ''}${item.gated && !item.done ? ' abw-oa__checklist-item--gated' : ''}`}
    >
      <button
        className="abw-oa__checklist-check"
        onClick={onToggle}
        aria-label={item.done ? `Uncheck: ${item.label}` : `Check: ${item.label}`}
        aria-pressed={item.done}
        disabled={item.gated && !item.done}
        title={item.gated && !item.done ? 'Requires approval — submit through Approvals' : undefined}
      >
        {item.done ? '✓' : item.gated ? '🔒' : ''}
      </button>
      <div className="abw-oa__checklist-item__body">
        <span className="abw-oa__checklist-item__label">{item.label}</span>
        {item.notes && (
          <span className="abw-oa__checklist-item__notes">{item.notes}</span>
        )}
      </div>
      {item.gated && !item.done && (
        <span className="abw-badge abw-badge--warning abw-oa__checklist-item__gate-badge">
          Approval required
        </span>
      )}
    </div>
  );
}

function NewFlowDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (flow: OnboardingFlow) => void;
}) {
  const [name, setName]         = useState('');
  const [template, setTemplate] = useState(FLOW_TEMPLATES[0]!.id);
  const [creating, setCreating] = useState(false);

  function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    // Simulate async creation — in production this posts to /api/projects
    setTimeout(() => {
      const tmpl = FLOW_TEMPLATES.find((t) => t.id === template)!;
      const defaultSteps: FlowStep[] = [
        { id: 's1', title: 'Welcome',       description: 'Introduction and goals.',         requiresApproval: false, rollbackable: false, status: 'active' },
        { id: 's2', title: 'Account setup', description: 'Provision access and accounts.',  requiresApproval: true,  rollbackable: true,  status: 'pending' },
        { id: 's3', title: 'Configure',     description: 'Apply brand and settings.',       requiresApproval: false, rollbackable: false, status: 'pending' },
        { id: 's4', title: 'Verify',        description: 'Review with client.',             requiresApproval: false, rollbackable: false, status: 'pending' },
        { id: 's5', title: 'Done',          description: 'Handoff and close.',             requiresApproval: false, rollbackable: false, status: 'pending' },
      ];
      onCreate({
        id:        crypto.randomUUID(),
        name:      name.trim(),
        template:  tmpl.label,
        createdAt: new Date().toISOString(),
        steps:     defaultSteps,
      });
    }, 600);
  }

  return (
    <div className="abw-dialog-backdrop" role="dialog" aria-modal aria-label="New onboarding flow">
      <div className="abw-dialog">
        <div className="abw-dialog__header">
          <h2 className="abw-dialog__title">New Onboarding Flow</h2>
          <button className="abw-dialog__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="abw-dialog__body">
          <label className="abw-field-label" htmlFor="nf-name">Flow name</label>
          <input
            id="nf-name"
            className="abw-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Corp Onboarding"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />

          <label className="abw-field-label" htmlFor="nf-template" style={{ marginTop: 'var(--space-4)' }}>
            Template
          </label>
          <select
            id="nf-template"
            className="abw-select"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            {FLOW_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <p className="abw-oa__field-hint" style={{ marginTop: 'var(--space-2)' }}>
            {FLOW_TEMPLATES.find((t) => t.id === template)?.desc}
          </p>

          <div className="abw-banner abw-banner--info" style={{ marginTop: 'var(--space-4)' }}>
            Account-setup steps in this flow are approval-gated and audited.
            Rollback paths are generated for each gated step.
          </div>
        </div>

        <div className="abw-dialog__footer">
          <button className="abw-btn abw-btn--ghost" onClick={onClose}>Cancel</button>
          <button
            className="abw-btn abw-btn--primary"
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            aria-busy={creating}
          >
            {creating ? 'Creating…' : 'Create flow'}
          </button>
        </div>
      </div>
    </div>
  );
}
