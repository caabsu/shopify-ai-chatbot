'use client';

import { useState, useEffect } from 'react';
import { Save, Check } from 'lucide-react';

const configKeys = [
  { key: 'system_prompt', label: 'System Prompt', type: 'textarea' as const, rows: 12 },
  { key: 'brand_voice', label: 'Brand Voice', type: 'textarea' as const, rows: 4 },
  { key: 'greeting', label: 'Greeting Message', type: 'input' as const },
  { key: 'preset_actions', label: 'Preset Actions (JSON)', type: 'textarea' as const, rows: 8 },
];

export default function AiConfigPage() {
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

  if (loading) return <div className="animate-pulse"><div className="h-64 bg-gray-200 rounded-xl" /></div>;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">AI Configuration</h2>

      {configKeys.map(({ key, label, type, rows }) => {
        const changed = config[key] !== original[key];
        return (
          <div key={key} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">{label}</h3>
                {changed && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">Unsaved</span>}
              </div>
              <button
                onClick={() => handleSave(key)}
                disabled={!changed && !saving[key]}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saved[key] ? <><Check size={14} /> Saved</> : saving[key] ? 'Saving...' : <><Save size={14} /> Save</>}
              </button>
            </div>

            {type === 'textarea' ? (
              <textarea
                value={config[key] ?? ''}
                onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                rows={rows}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black resize-y"
              />
            ) : (
              <input
                value={config[key] ?? ''}
                onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
