// apps/web/src/layout/LeftPanel/ModelSelector.tsx — always-visible model selector.
// Shows selected provider + model. No silent fallback; fallback is opt-in and banner-warned.
// Clicking opens a dropdown to switch provider/model for the NEXT run.
import { useRunStore } from '../../lib/store/runStore';

// Minimal static model list; real list comes from /api/providers/models once wired.
const PROVIDERS = [
  {
    id: 'minimax',
    label: 'MiniMax',
    models: [
      { id: 'MiniMax-M2.7',           label: 'MiniMax M2.7' },
      { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 (highspeed)' },
      { id: 'MiniMax-M2.5',           label: 'MiniMax M2.5' },
      { id: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 (highspeed)' },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    models: [
      { id: 'llama3',      label: 'Llama 3 8B' },
      { id: 'llama3:70b',  label: 'Llama 3 70B' },
      { id: 'mistral',     label: 'Mistral 7B' },
      { id: 'codestral',   label: 'Codestral' },
    ],
  },
] as const;

type ProviderId = typeof PROVIDERS[number]['id'];

function getProvider(id: string) {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function ModelSelector() {
  const { selectedProvider, selectedModel, setProvider, setModel } = useRunStore();

  const provider = getProvider(selectedProvider);
  const models = provider.models as ReadonlyArray<{ id: string; label: string }>;
  const model = models.find((m) => m.id === selectedModel) ?? models[0];

  function handleProviderChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = PROVIDERS.find((p) => p.id === e.target.value);
    if (!next) return;
    setProvider(next.id);
    const firstModel = next.models[0];
    if (firstModel) setModel(firstModel.id);
  }

  function handleModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setModel(e.target.value);
  }

  return (
    <div className="abw-model-selector" aria-label="Model selection">
      <div className="abw-model-selector__label">Model</div>

      {/* Provider select */}
      <div style={{ marginBottom: 'var(--space-1)' }}>
        <select
          value={provider.id}
          onChange={handleProviderChange}
          style={{
            width: '100%',
            border: '1px solid var(--border-base)',
            borderRadius: 'var(--radius-field)',
            background: 'var(--bg-subtle)',
            color: 'var(--text-secondary)',
            fontSize: '0.6875rem',
            padding: '2px var(--space-1)',
            cursor: 'pointer',
          }}
          aria-label="Provider"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Model trigger row */}
      <div className="abw-model-selector__trigger">
        <span
          className="abw-model-selector__dot abw-model-selector__dot--ok"
          aria-hidden="true"
          title="Provider status"
        />
        <select
          className="abw-model-selector__name"
          value={model?.id ?? ''}
          onChange={handleModelChange}
          style={{
            border: 'none', background: 'none', color: 'inherit',
            fontSize: 'inherit', cursor: 'pointer', padding: 0,
            minWidth: 0, flex: 1,
          }}
          aria-label="Model"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
