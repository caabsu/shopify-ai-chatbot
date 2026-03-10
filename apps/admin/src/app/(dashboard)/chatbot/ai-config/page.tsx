'use client';

import { useState, useEffect } from 'react';
import { Save, Check } from 'lucide-react';

const configKeys = [
  { key: 'system_prompt', label: 'System Prompt', type: 'textarea' as const, rows: 12 },
  { key: 'brand_voice', label: 'Brand Voice', type: 'textarea' as const, rows: 4 },
  { key: 'greeting', label: 'Greeting Message', type: 'input' as const },
  { key: 'preset_actions', label: 'Preset Actions (JSON)', type: 'textarea' as const, rows: 8 },
];

export default function ChatbotAiConfigPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ai-config')
      .then((r) => r.json())
      .then((data) => {
        setConfig(data.config ?? {});
        setOriginal(data.config ?? {});
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(key: string) {
    setSaving((s) => ({ ...s, [key]: true }));
    await fetch('/api/ai-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: config[key] }),
    });
    setOriginal((o) => ({ ...o, [key]: config[key] }));
    setSaving((s) => ({ ...s, [key]: false }));
    setSaved((s) => ({ ...s, [key]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [key]: false })), 2000);
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>AI Configuration</h2>

      {configKeys.map(({ key, label, type, rows }) => {
        const changed = config[key] !== original[key];
        return (
          <div
            key={key}
            className="rounded-xl p-5 space-y-3"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</h3>
                {changed && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#d97706' }}
                  >
                    Unsaved
                  </span>
                )}
              </div>
              <button
                onClick={() => handleSave(key)}
                disabled={!changed && !saving[key]}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                {saved[key] ? <><Check size={14} /> Saved</> : saving[key] ? 'Saving...' : <><Save size={14} /> Save</>}
              </button>
            </div>

            {type === 'textarea' ? (
              <textarea
                value={config[key] ?? ''}
                onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                rows={rows}
                className="w-full rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
            ) : (
              <input
                value={config[key] ?? ''}
                onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
