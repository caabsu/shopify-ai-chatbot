'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Check } from 'lucide-react';
import type { SlaRule } from '@/lib/types';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#3b82f6',
  low: '#9ca3af',
};

export default function SlaRulesPage() {
  const [rules, setRules] = useState<SlaRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings/sla')
      .then((r) => r.json())
      .then((data) => setRules(data.rules ?? []))
      .finally(() => setLoading(false));
  }, []);

  function updateRule(index: number, field: keyof SlaRule, value: unknown) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch('/api/settings/sla', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules }),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-40 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings" className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>
            <ArrowLeft size={16} />
          </Link>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>SLA Rules</h2>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving...' : <><Save size={14} /> Save Changes</>}
        </button>
      </div>

      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Define response and resolution time targets for each priority level.
      </p>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
              <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Priority</th>
              <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>First Response (min)</th>
              <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Resolution Target (min)</th>
              <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Business Hours Only</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, i) => (
              <tr key={rule.id || rule.priority} style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: PRIORITY_COLORS[rule.priority] }}
                    />
                    <span className="font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                      {rule.priority}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={rule.first_response_minutes}
                    onChange={(e) => updateRule(i, 'first_response_minutes', parseInt(e.target.value) || 0)}
                    className="w-24 px-2 py-1 text-sm rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-primary)',
                      color: 'var(--text-primary)',
                      '--tw-ring-color': 'var(--color-accent)',
                    } as React.CSSProperties}
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={rule.resolution_target_minutes}
                    onChange={(e) => updateRule(i, 'resolution_target_minutes', parseInt(e.target.value) || 0)}
                    className="w-24 px-2 py-1 text-sm rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-primary)',
                      color: 'var(--text-primary)',
                      '--tw-ring-color': 'var(--color-accent)',
                    } as React.CSSProperties}
                  />
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => updateRule(i, 'business_hours_only', !rule.business_hours_only)}
                    className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0"
                    style={{
                      backgroundColor: rule.business_hours_only ? 'var(--color-accent)' : 'var(--border-primary)',
                    }}
                  >
                    <div
                      className="w-4 h-4 bg-white rounded-full absolute top-1 transition-transform"
                      style={{ left: rule.business_hours_only ? '20px' : '4px' }}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rules.length === 0 && (
          <div className="p-8 text-center">
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No SLA rules configured. They will be created when you save.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
