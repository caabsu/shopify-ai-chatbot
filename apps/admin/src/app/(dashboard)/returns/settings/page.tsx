'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Check, Plus, X } from 'lucide-react';

interface ReturnSettings {
  return_window_days: number;
  require_photos: boolean;
  require_photos_for_reasons: string[];
  ai_confidence_threshold: number;
  available_reasons: string[];
  reason_labels: Record<string, string>;
  available_resolutions: string[];
  auto_close_days: number;
  portal_title: string;
  portal_description: string;
  restocking_fee_percent: number;
  restocking_fee_exempt_reasons: string[];
  dimension_collection_enabled: boolean;
  collect_dimensions_for_reasons: string[];
  provide_prepaid_label_for_reasons: string[];
}

const DEFAULTS: ReturnSettings = {
  return_window_days: 30,
  require_photos: false,
  require_photos_for_reasons: ['defective', 'wrong_item', 'not_as_described'],
  ai_confidence_threshold: 0.85,
  available_reasons: ['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'too_small', 'too_large', 'arrived_late', 'other'],
  reason_labels: {
    defective: 'Defective / Damaged',
    wrong_item: 'Wrong Item Received',
    not_as_described: 'Not as Described',
    changed_mind: 'Changed My Mind',
    too_small: 'Too Small',
    too_large: 'Too Large',
    arrived_late: 'Arrived Late',
    other: 'Other',
  },
  available_resolutions: ['refund', 'store_credit', 'exchange'],
  auto_close_days: 30,
  portal_title: 'Returns & Exchanges',
  portal_description: 'Start a return or exchange in just a few steps.',
  restocking_fee_percent: 20,
  restocking_fee_exempt_reasons: ['defective', 'wrong_item', 'not_as_described'],
  dimension_collection_enabled: true,
  collect_dimensions_for_reasons: ['defective', 'wrong_item', 'not_as_described'],
  provide_prepaid_label_for_reasons: ['defective', 'wrong_item', 'not_as_described'],
};

export default function ReturnSettingsPage() {
  const [settings, setSettings] = useState<ReturnSettings>(DEFAULTS);
  const [original, setOriginal] = useState<ReturnSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newReason, setNewReason] = useState('');
  const [newReasonLabel, setNewReasonLabel] = useState('');

  useEffect(() => {
    fetch('/api/returns/settings')
      .then((r) => r.json())
      .then((data) => {
        const merged = { ...DEFAULTS, ...data };
        setSettings(merged);
        setOriginal(merged);
      })
      .finally(() => setLoading(false));
  }, []);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const res = await fetch('/api/returns/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      const data = await res.json();
      const merged = { ...DEFAULTS, ...data };
      setSettings(merged);
      setOriginal(merged);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  function addReason() {
    const slug = newReason.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const label = newReasonLabel.trim();
    if (!slug || !label) return;
    if (settings.available_reasons.includes(slug)) return;

    setSettings({
      ...settings,
      available_reasons: [...settings.available_reasons, slug],
      reason_labels: { ...settings.reason_labels, [slug]: label },
    });
    setNewReason('');
    setNewReasonLabel('');
  }

  function removeReason(slug: string) {
    const { [slug]: _, ...restLabels } = settings.reason_labels;
    setSettings({
      ...settings,
      available_reasons: settings.available_reasons.filter((r) => r !== slug),
      reason_labels: restLabels,
    });
  }

  function updateReasonLabel(slug: string, label: string) {
    setSettings({
      ...settings,
      reason_labels: { ...settings.reason_labels, [slug]: label },
    });
  }

  function toggleResolution(res: string) {
    const current = settings.available_resolutions;
    const updated = current.includes(res)
      ? current.filter((r) => r !== res)
      : [...current, res];
    setSettings({ ...settings, available_resolutions: updated });
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-40 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="h-96 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  const inputStyle = {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    color: 'var(--text-primary)',
  } as React.CSSProperties;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Return Settings</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Configure return policies, reasons, and automation thresholds
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving...' : <><Save size={14} /> Save Changes</>}
        </button>
      </div>

      <div className="space-y-5">
        {/* Return Window */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Return Window</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Number of days after purchase that customers can initiate a return
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={settings.return_window_days}
              onChange={(e) => setSettings({ ...settings, return_window_days: parseInt(e.target.value) || 30 })}
              className="w-24 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
              style={inputStyle}
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>days</span>
          </div>
        </div>

        {/* Return Reasons */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Return Reasons</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Reasons customers can select when submitting a return. Each has a slug (value) and display label.
          </p>
          <div className="space-y-2 mb-3">
            {settings.available_reasons.map((slug) => (
              <div key={slug} className="flex items-center gap-2">
                <span
                  className="text-[10px] font-mono px-2 py-1 rounded w-32 truncate flex-shrink-0"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    color: 'var(--text-tertiary)',
                    border: '1px solid var(--border-secondary)',
                  }}
                >
                  {slug}
                </span>
                <input
                  type="text"
                  value={settings.reason_labels[slug] || ''}
                  onChange={(e) => updateReasonLabel(slug, e.target.value)}
                  className="flex-1 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2"
                  style={inputStyle}
                />
                <button
                  onClick={() => removeReason(slug)}
                  className="p-1.5 rounded-lg transition-colors flex-shrink-0"
                  style={{ color: 'var(--text-tertiary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          {/* Add new reason */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder="slug (e.g. too_heavy)"
              className="w-32 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2"
              style={inputStyle}
            />
            <input
              type="text"
              value={newReasonLabel}
              onChange={(e) => setNewReasonLabel(e.target.value)}
              placeholder="Display label (e.g. Too Heavy)"
              className="flex-1 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2"
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === 'Enter') addReason(); }}
            />
            <button
              onClick={addReason}
              disabled={!newReason.trim() || !newReasonLabel.trim()}
              className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              <Plus size={12} /> Add
            </button>
          </div>
        </div>

        {/* Resolution Types */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Resolution Types</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Available resolution options for returns
          </p>
          <div className="flex gap-3">
            {['refund', 'store_credit', 'exchange'].map((res) => (
              <button
                key={res}
                onClick={() => toggleResolution(res)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{
                  backgroundColor: settings.available_resolutions.includes(res)
                    ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                    : 'var(--bg-secondary)',
                  color: settings.available_resolutions.includes(res)
                    ? 'var(--color-accent)'
                    : 'var(--text-secondary)',
                  border: settings.available_resolutions.includes(res)
                    ? '1.5px solid var(--color-accent)'
                    : '1.5px solid var(--border-primary)',
                }}
              >
                {settings.available_resolutions.includes(res) && <Check size={12} />}
                {res.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </button>
            ))}
          </div>
        </div>

        {/* AI Configuration */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>AI Configuration</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Confidence threshold for AI auto-decisions. Returns below this threshold go to manual review.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.ai_confidence_threshold}
              onChange={(e) => setSettings({ ...settings, ai_confidence_threshold: parseFloat(e.target.value) })}
              className="flex-1 accent-current"
              style={{ accentColor: 'var(--color-accent)' }}
            />
            <span className="text-sm font-mono w-12 text-right" style={{ color: 'var(--text-primary)' }}>
              {settings.ai_confidence_threshold.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Photo Requirements — Per Reason */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Photo Requirements</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Require customers to upload photos for specific return reasons. Photos are always optional for unchecked reasons.
          </p>
          <div className="space-y-2">
            {settings.available_reasons.map((slug) => {
              const isRequired = settings.require_photos_for_reasons.includes(slug);
              return (
                <div key={slug} className="flex items-center justify-between py-1">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {settings.reason_labels[slug] || slug}
                  </span>
                  <button
                    onClick={() => {
                      const updated = isRequired
                        ? settings.require_photos_for_reasons.filter((r) => r !== slug)
                        : [...settings.require_photos_for_reasons, slug];
                      setSettings({ ...settings, require_photos_for_reasons: updated });
                    }}
                    className="w-9 h-5 rounded-full transition-colors relative flex-shrink-0"
                    style={{
                      backgroundColor: isRequired ? 'var(--color-accent)' : 'var(--border-primary)',
                    }}
                  >
                    <div
                      className="w-3.5 h-3.5 bg-white rounded-full absolute transition-transform"
                      style={{ top: '3px', left: isRequired ? '17px' : '3px' }}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Auto-Close */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Auto-Close</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Automatically close unresolved return requests after this many days
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={settings.auto_close_days}
              onChange={(e) => setSettings({ ...settings, auto_close_days: parseInt(e.target.value) || 30 })}
              className="w-24 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
              style={inputStyle}
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>days</span>
          </div>
        </div>

        {/* Customer Portal Text */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Customer Portal Text</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Title and description shown at the top of the returns portal
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Title</label>
              <input
                type="text"
                value={settings.portal_title}
                onChange={(e) => setSettings({ ...settings, portal_title: e.target.value })}
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Description</label>
              <textarea
                value={settings.portal_description}
                onChange={(e) => setSettings({ ...settings, portal_description: e.target.value })}
                rows={2}
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 resize-y"
                style={inputStyle}
              />
            </div>
          </div>
        </div>
        {/* Label & Shipping Settings */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Label & Shipping Settings</h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
            Control package dimension collection and prepaid label generation
          </p>

          {/* Master toggle */}
          <div className="flex items-center justify-between py-2 mb-3" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
            <div>
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Collect package dimensions from customer</span>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>When enabled, customers will be asked to enter package dimensions for selected reasons</p>
            </div>
            <button
              onClick={() => setSettings({ ...settings, dimension_collection_enabled: !settings.dimension_collection_enabled })}
              className="w-9 h-5 rounded-full transition-colors relative flex-shrink-0"
              style={{ backgroundColor: settings.dimension_collection_enabled ? 'var(--color-accent)' : 'var(--border-primary)' }}
            >
              <div className="w-3.5 h-3.5 bg-white rounded-full absolute transition-transform" style={{ top: '3px', left: settings.dimension_collection_enabled ? '17px' : '3px' }} />
            </button>
          </div>

          {settings.dimension_collection_enabled && (
            <>
              {/* Collect dimensions for reasons */}
              <div className="mb-4">
                <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>Collect dimensions for these reasons</label>
                <div className="space-y-1.5">
                  {settings.available_reasons.map((slug) => {
                    const isChecked = settings.collect_dimensions_for_reasons.includes(slug);
                    return (
                      <div key={slug} className="flex items-center justify-between py-1">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{settings.reason_labels[slug] || slug}</span>
                        <button
                          onClick={() => {
                            const updated = isChecked
                              ? settings.collect_dimensions_for_reasons.filter((r) => r !== slug)
                              : [...settings.collect_dimensions_for_reasons, slug];
                            setSettings({ ...settings, collect_dimensions_for_reasons: updated });
                          }}
                          className="w-9 h-5 rounded-full transition-colors relative flex-shrink-0"
                          style={{ backgroundColor: isChecked ? 'var(--color-accent)' : 'var(--border-primary)' }}
                        >
                          <div className="w-3.5 h-3.5 bg-white rounded-full absolute transition-transform" style={{ top: '3px', left: isChecked ? '17px' : '3px' }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Provide prepaid label for reasons */}
              <div>
                <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>Provide prepaid label for these reasons</label>
                <div className="space-y-1.5">
                  {settings.available_reasons.map((slug) => {
                    const isChecked = settings.provide_prepaid_label_for_reasons.includes(slug);
                    return (
                      <div key={slug} className="flex items-center justify-between py-1">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{settings.reason_labels[slug] || slug}</span>
                        <button
                          onClick={() => {
                            const updated = isChecked
                              ? settings.provide_prepaid_label_for_reasons.filter((r) => r !== slug)
                              : [...settings.provide_prepaid_label_for_reasons, slug];
                            setSettings({ ...settings, provide_prepaid_label_for_reasons: updated });
                          }}
                          className="w-9 h-5 rounded-full transition-colors relative flex-shrink-0"
                          style={{ backgroundColor: isChecked ? 'var(--color-accent)' : 'var(--border-primary)' }}
                        >
                          <div className="w-3.5 h-3.5 bg-white rounded-full absolute transition-transform" style={{ top: '3px', left: isChecked ? '17px' : '3px' }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Return Address */}
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Return Address</label>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Red Stag Fulfillment, 6503 W Belvil Hwy, Sweetwater, TN 37874
            </p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
              This address is managed by your fulfillment provider and cannot be changed here.
            </p>
          </div>
        </div>

        {/* Restocking Fee */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Restocking Fee</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Applied to returns unless the reason is exempt. Customers see this fee at checkout.
          </p>
          <div className="flex items-center gap-2 mb-4">
            <input
              type="number"
              min={0}
              max={100}
              value={settings.restocking_fee_percent}
              onChange={(e) => setSettings({ ...settings, restocking_fee_percent: parseInt(e.target.value) || 0 })}
              className="w-24 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
              style={inputStyle}
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>%</span>
          </div>
          <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>Exempt reasons (no restocking fee)</label>
          <div className="space-y-1.5">
            {settings.available_reasons.map((slug) => {
              const isExempt = settings.restocking_fee_exempt_reasons.includes(slug);
              return (
                <div key={slug} className="flex items-center justify-between py-1">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{settings.reason_labels[slug] || slug}</span>
                  <button
                    onClick={() => {
                      const updated = isExempt
                        ? settings.restocking_fee_exempt_reasons.filter((r) => r !== slug)
                        : [...settings.restocking_fee_exempt_reasons, slug];
                      setSettings({ ...settings, restocking_fee_exempt_reasons: updated });
                    }}
                    className="w-9 h-5 rounded-full transition-colors relative flex-shrink-0"
                    style={{ backgroundColor: isExempt ? 'var(--color-accent)' : 'var(--border-primary)' }}
                  >
                    <div className="w-3.5 h-3.5 bg-white rounded-full absolute transition-transform" style={{ top: '3px', left: isExempt ? '17px' : '3px' }} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
