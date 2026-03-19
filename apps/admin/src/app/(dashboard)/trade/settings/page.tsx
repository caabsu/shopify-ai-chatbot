'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Check, Plus, X } from 'lucide-react';

type PaymentTerms = 'due_on_fulfillment' | 'net_30' | 'net_60';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
type RuleField = 'website_url' | 'business_type';
type RuleCondition = 'is_not_empty' | 'contains' | 'equals' | 'one_of';
type RuleLogic = 'all' | 'any';

interface AutoApproveRule {
  id: string;
  field: RuleField;
  condition: RuleCondition;
  value: string;
}

interface TradeSettings {
  discount_percentage: number;
  discount_code: string;
  default_payment_terms: PaymentTerms;
  concierge_email: string;
  auto_approve_enabled: boolean;
  auto_approve_rules: AutoApproveRule[];
  auto_approve_logic: RuleLogic;
  ticket_priority: TicketPriority;
}

const DEFAULT_SETTINGS: TradeSettings = {
  discount_percentage: 30,
  discount_code: 'TRADE30',
  default_payment_terms: 'due_on_fulfillment',
  concierge_email: '',
  auto_approve_enabled: true,
  auto_approve_rules: [
    { id: '1', field: 'website_url', condition: 'is_not_empty', value: '' },
  ],
  auto_approve_logic: 'all',
  ticket_priority: 'medium',
};

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border-primary)',
  color: 'var(--text-primary)',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-primary)',
  border: '1px solid var(--border-primary)',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-semibold uppercase tracking-wide mb-3"
      style={{ color: 'var(--text-tertiary)' }}
    >
      {children}
    </p>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
      {children}
    </label>
  );
}

function valueInputRequired(condition: RuleCondition): boolean {
  return condition === 'contains' || condition === 'equals' || condition === 'one_of';
}

let ruleCounter = 100;

export default function TradeSettingsPage() {
  const [settings, setSettings] = useState<TradeSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/trade/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.settings) {
          setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/trade/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to save settings');
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function updateSettings<K extends keyof TradeSettings>(key: K, value: TradeSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function addRule() {
    ruleCounter += 1;
    const newRule: AutoApproveRule = {
      id: String(ruleCounter),
      field: 'website_url',
      condition: 'is_not_empty',
      value: '',
    };
    updateSettings('auto_approve_rules', [...settings.auto_approve_rules, newRule]);
  }

  function removeRule(id: string) {
    updateSettings(
      'auto_approve_rules',
      settings.auto_approve_rules.filter((r) => r.id !== id),
    );
  }

  function updateRule(id: string, patch: Partial<AutoApproveRule>) {
    updateSettings(
      'auto_approve_rules',
      settings.auto_approve_rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 max-w-lg">
        <div className="h-8 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="h-48 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="h-48 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/trade"
          className="transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <ArrowLeft size={16} />
        </Link>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Trade program settings
        </h2>
      </div>

      {/* General Settings */}
      <div className="rounded-xl p-5 space-y-4" style={cardStyle}>
        <SectionLabel>General</SectionLabel>

        <div>
          <FieldLabel>Discount percentage</FieldLabel>
          <input
            type="number"
            min={0}
            max={100}
            value={settings.discount_percentage}
            onChange={(e) =>
              updateSettings('discount_percentage', Number(e.target.value))
            }
            className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
            style={inputStyle}
          />
        </div>

        <div>
          <FieldLabel>Shared discount code</FieldLabel>
          <input
            type="text"
            value={settings.discount_code}
            onChange={(e) => updateSettings('discount_code', e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
            style={inputStyle}
            placeholder="e.g. TRADE30"
          />
        </div>

        <div>
          <FieldLabel>Default payment terms</FieldLabel>
          <select
            value={settings.default_payment_terms}
            onChange={(e) =>
              updateSettings('default_payment_terms', e.target.value as PaymentTerms)
            }
            className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
            style={inputStyle}
          >
            <option value="due_on_fulfillment">Due on fulfillment</option>
            <option value="net_30">Net 30</option>
            <option value="net_60">Net 60</option>
          </select>
        </div>

        <div>
          <FieldLabel>Concierge email</FieldLabel>
          <input
            type="email"
            value={settings.concierge_email}
            onChange={(e) => updateSettings('concierge_email', e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
            style={inputStyle}
            placeholder="trade@yourbrand.com"
          />
        </div>
      </div>

      {/* Auto-Approve Rules */}
      <div className="rounded-xl p-5 space-y-4" style={cardStyle}>
        <div className="flex items-center justify-between">
          <SectionLabel>Auto-approve rules</SectionLabel>
          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={settings.auto_approve_enabled}
            onClick={() =>
              updateSettings('auto_approve_enabled', !settings.auto_approve_enabled)
            }
            className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none"
            style={{
              backgroundColor: settings.auto_approve_enabled
                ? 'var(--color-accent)'
                : 'var(--border-primary)',
            }}
          >
            <span
              className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
              style={{
                transform: settings.auto_approve_enabled
                  ? 'translateX(18px)'
                  : 'translateX(3px)',
              }}
            />
          </button>
        </div>

        {settings.auto_approve_enabled && (
          <div className="space-y-3">
            {settings.auto_approve_rules.length > 0 && (
              <div className="space-y-2">
                {settings.auto_approve_rules.map((rule, index) => (
                  <div key={rule.id} className="flex items-start gap-2">
                    {/* Row label */}
                    <span
                      className="text-xs font-medium pt-2.5 w-8 shrink-0"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {index === 0 ? 'If' : settings.auto_approve_logic === 'all' ? 'And' : 'Or'}
                    </span>

                    {/* Field selector */}
                    <select
                      value={rule.field}
                      onChange={(e) =>
                        updateRule(rule.id, { field: e.target.value as RuleField })
                      }
                      className="px-2 py-2 text-xs rounded-lg focus:outline-none focus:ring-2 flex-1"
                      style={inputStyle}
                    >
                      <option value="website_url">Website URL</option>
                      <option value="business_type">Business type</option>
                    </select>

                    {/* Condition selector */}
                    <select
                      value={rule.condition}
                      onChange={(e) =>
                        updateRule(rule.id, {
                          condition: e.target.value as RuleCondition,
                          value: '',
                        })
                      }
                      className="px-2 py-2 text-xs rounded-lg focus:outline-none focus:ring-2 flex-1"
                      style={inputStyle}
                    >
                      <option value="is_not_empty">is not empty</option>
                      <option value="contains">contains</option>
                      <option value="equals">equals</option>
                      <option value="one_of">one of</option>
                    </select>

                    {/* Value input (conditional) */}
                    {valueInputRequired(rule.condition) && (
                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                        className="px-2 py-2 text-xs rounded-lg focus:outline-none focus:ring-2 flex-1"
                        style={inputStyle}
                        placeholder={rule.condition === 'one_of' ? 'val1, val2' : 'value'}
                      />
                    )}

                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => removeRule(rule.id)}
                      className="p-2 rounded-lg transition-colors shrink-0"
                      style={{ color: 'var(--text-tertiary)' }}
                      title="Remove rule"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={addRule}
                className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                style={{ color: 'var(--color-accent)' }}
              >
                <Plus size={13} />
                Add rule
              </button>

              {settings.auto_approve_rules.length > 1 && (
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Logic:
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateSettings(
                        'auto_approve_logic',
                        settings.auto_approve_logic === 'all' ? 'any' : 'all',
                      )
                    }
                    className="px-2.5 py-1 text-xs font-medium rounded-lg transition-colors"
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-primary)',
                    }}
                  >
                    {settings.auto_approve_logic === 'all'
                      ? 'ALL rules must match'
                      : 'ANY rule must match'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Support Integration */}
      <div className="rounded-xl p-5 space-y-4" style={cardStyle}>
        <SectionLabel>Support integration</SectionLabel>

        <div>
          <FieldLabel>Ticket priority level</FieldLabel>
          <select
            value={settings.ticket_priority}
            onChange={(e) =>
              updateSettings('ticket_priority', e.target.value as TicketPriority)
            }
            className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
            style={inputStyle}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm" style={{ color: '#ef4444' }}>
          {error}
        </p>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--color-accent)' }}
      >
        {saved ? (
          <>
            <Check size={14} /> Saved
          </>
        ) : saving ? (
          'Saving...'
        ) : (
          <>
            <Save size={14} /> Save changes
          </>
        )}
      </button>
    </div>
  );
}
