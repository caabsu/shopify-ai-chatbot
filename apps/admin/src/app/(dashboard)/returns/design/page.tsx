'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Check, RotateCcw, RefreshCw } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface PortalDesign {
  primaryColor: string;
  backgroundColor: string;
  borderRadius: 'sharp' | 'rounded' | 'pill';
  fontSize: 'small' | 'medium' | 'large';
  fontFamily: string;
  headingFontFamily: string;
  buttonTextLookup: string;
  buttonTextContinue: string;
  buttonTextSubmit: string;
  stepLabels: string[];
  successTitle: string;
  successMessage: string;
  successButtonText: string;
}

const DEFAULTS: PortalDesign = {
  primaryColor: '#18181b',
  backgroundColor: '#ffffff',
  borderRadius: 'rounded',
  fontSize: 'medium',
  fontFamily: '',
  headingFontFamily: '',
  buttonTextLookup: 'Find My Order',
  buttonTextContinue: 'Continue to Review',
  buttonTextSubmit: 'Submit Return Request',
  stepLabels: ['Find Order', 'Select Items', 'Confirm'],
  successTitle: 'Return Request Submitted',
  successMessage: 'Your return request has been received.',
  successButtonText: 'Start Another Return',
};

const COLOR_PRESETS = [
  { label: 'Black', value: '#18181b' },
  { label: 'Brown', value: '#6B4A37' },
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Forest', value: '#2d5a3d' },
  { label: 'Plum', value: '#5b3256' },
  { label: 'Slate', value: '#475569' },
];

const RADIUS_OPTIONS = [
  { id: 'sharp' as const, label: 'Sharp' },
  { id: 'rounded' as const, label: 'Rounded' },
  { id: 'pill' as const, label: 'Pill' },
];

function radiusValue(r: string): string {
  if (r === 'sharp') return '4px';
  if (r === 'pill') return '24px';
  return '12px';
}

export default function PortalDesignPage() {
  const [settings, setSettings] = useState<PortalDesign>(DEFAULTS);
  const [original, setOriginal] = useState<PortalDesign>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { brandSlug } = useBrand();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  useEffect(() => {
    fetch('/api/returns/portal-design')
      .then((r) => r.json())
      .then((data) => {
        if (data.design) {
          const merged = { ...DEFAULTS, ...data.design };
          if (typeof merged.stepLabels === 'string') {
            try { merged.stepLabels = JSON.parse(merged.stepLabels); } catch { merged.stepLabels = DEFAULTS.stepLabels; }
          }
          setSettings(merged);
          setOriginal(merged);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const [previewKey, setPreviewKey] = useState(0);
  const saveCountRef = useRef(0);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);

  const handleSave = useCallback(async () => {
    setSaving(true);
    await fetch('/api/returns/portal-design', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    setOriginal({ ...settings });
    setSaving(false);
    setSaved(true);
    saveCountRef.current += 1;
    // Refresh preview iframe after save so it loads the new design from API
    setPreviewKey(saveCountRef.current);
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  const handleReset = useCallback(() => {
    setSettings(DEFAULTS);
  }, []);

  function updateStepLabel(index: number, value: string) {
    const labels = [...settings.stepLabels];
    labels[index] = value;
    setSettings({ ...settings, stepLabels: labels });
  }

  if (loading) return <div className="animate-pulse"><div className="h-96 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Portal Design</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Customize the customer-facing returns portal appearance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving...' : <><Save size={14} /> Save Changes</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Left: Settings */}
        <div className="space-y-5">
          {/* Colors */}
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Colors</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Primary Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={settings.primaryColor}
                    onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={settings.primaryColor}
                    onChange={(e) => {
                      if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setSettings({ ...settings, primaryColor: e.target.value });
                    }}
                    className="w-28 text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => setSettings({ ...settings, primaryColor: preset.value })}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-medium"
                      style={{
                        borderColor: settings.primaryColor === preset.value ? 'var(--text-primary)' : 'var(--border-primary)',
                        backgroundColor: settings.primaryColor === preset.value ? 'var(--bg-tertiary)' : 'transparent',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span className="w-3 h-3 rounded-full" style={{ background: preset.value }} />
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Background Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={settings.backgroundColor}
                    onChange={(e) => setSettings({ ...settings, backgroundColor: e.target.value })}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={settings.backgroundColor}
                    onChange={(e) => {
                      if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setSettings({ ...settings, backgroundColor: e.target.value });
                    }}
                    className="w-28 text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Typography */}
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Typography</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Body Font</label>
                <input
                  type="text"
                  value={settings.fontFamily}
                  onChange={(e) => setSettings({ ...settings, fontFamily: e.target.value })}
                  placeholder="System default"
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Heading Font</label>
                <input
                  type="text"
                  value={settings.headingFontFamily}
                  onChange={(e) => setSettings({ ...settings, headingFontFamily: e.target.value })}
                  placeholder="Same as body"
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
          </div>

          {/* Shape */}
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Shape & Size</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Corner Radius</label>
                <div className="flex gap-3">
                  {RADIUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSettings({ ...settings, borderRadius: opt.id })}
                      className="px-4 py-2 text-xs font-medium transition-colors"
                      style={{
                        borderRadius: radiusValue(opt.id),
                        border: settings.borderRadius === opt.id ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                        backgroundColor: settings.borderRadius === opt.id ? 'var(--bg-tertiary)' : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>Font Size</label>
                <div className="flex gap-3">
                  {(['small', 'medium', 'large'] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => setSettings({ ...settings, fontSize: size })}
                      className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                      style={{
                        border: settings.fontSize === size ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                        backgroundColor: settings.fontSize === size ? 'var(--bg-tertiary)' : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Button Text */}
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Button Text</h3>
            <div className="space-y-3">
              {[
                { key: 'buttonTextLookup' as const, label: 'Lookup Button' },
                { key: 'buttonTextContinue' as const, label: 'Continue Button' },
                { key: 'buttonTextSubmit' as const, label: 'Submit Button' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>{label}</label>
                  <input
                    type="text"
                    value={settings[key]}
                    onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Step Labels */}
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Step Labels</h3>
            <div className="grid grid-cols-3 gap-3">
              {settings.stepLabels.map((label, i) => (
                <div key={i}>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Step {i + 1}</label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => updateStepLabel(i, e.target.value)}
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Success Screen */}
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Success Screen</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Title</label>
                <input
                  type="text"
                  value={settings.successTitle}
                  onChange={(e) => setSettings({ ...settings, successTitle: e.target.value })}
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Message</label>
                <input
                  type="text"
                  value={settings.successMessage}
                  onChange={(e) => setSettings({ ...settings, successMessage: e.target.value })}
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Button Text</label>
                <input
                  type="text"
                  value={settings.successButtonText}
                  onChange={(e) => setSettings({ ...settings, successButtonText: e.target.value })}
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Preview (actual widget in iframe) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Live Preview
            </h3>
            <button
              onClick={() => setPreviewKey((k) => k + 1)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ color: 'var(--text-tertiary)', border: '1px solid var(--border-primary)' }}
              title="Reload preview"
            >
              <RefreshCw size={10} /> Refresh
            </button>
          </div>
          <div
            className="rounded-xl overflow-hidden sticky top-20"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            <div className="relative" style={{ height: '520px' }}>
              <iframe
                key={previewKey}
                src={`${backendUrl}/widget/playground-returns?${[brandSlug ? `brand=${brandSlug}` : '', 'debug=0'].filter(Boolean).join('&')}`}
                className="absolute inset-0 w-full h-full border-0"
                style={{ background: '#ffffff' }}
                title="Returns Portal Preview"
              />
            </div>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--border-primary)' }}>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                {saved ? 'Preview updated with saved design' : hasChanges ? 'Save to update preview' : 'Showing current design'}
              </p>
              <a
                href={`${backendUrl}/widget/playground-returns${brandSlug ? `?brand=${brandSlug}` : ''}`}
                target="_blank"
                rel="noopener"
                className="text-[10px] font-medium transition-colors"
                style={{ color: 'var(--color-accent)' }}
              >
                Open Full Preview
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
