'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Check, RotateCcw } from 'lucide-react';
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

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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

  const radius = radiusValue(settings.borderRadius);
  const primary = settings.primaryColor;
  const bg = settings.backgroundColor;
  const btnText = isLightColor(primary) ? '#1a1a1a' : '#ffffff';
  const textColor = isLightColor(bg) ? '#1a1a1a' : '#f5f5f5';
  const subtextColor = isLightColor(bg) ? '#6b7280' : '#a0a0a0';
  const inputBorder = isLightColor(bg) ? '#d1d5db' : '#4a4a4a';

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

        {/* Right: Live Preview */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Preview
          </h3>
          <div
            className="rounded-xl overflow-hidden sticky top-20"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            {/* Mini portal preview */}
            <div className="p-4" style={{ background: '#f5f5f5' }}>
              <div style={{ background: bg, borderRadius: radius, padding: '20px', maxWidth: '100%', fontFamily: settings.fontFamily || 'system-ui, sans-serif' }}>
                {/* Title */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: settings.headingFontFamily || settings.fontFamily || 'system-ui, sans-serif', fontSize: 16, fontWeight: 700, color: textColor, marginBottom: 4 }}>
                    Returns & Exchanges
                  </div>
                  <div style={{ fontSize: 10, color: subtextColor }}>
                    Start a return or exchange in just a few steps.
                  </div>
                </div>

                {/* Steps */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 16 }}>
                  {settings.stepLabels.map((label, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 8, fontWeight: 700,
                        background: i === 0 ? primary : 'transparent',
                        color: i === 0 ? btnText : subtextColor,
                        border: i === 0 ? 'none' : `1.5px solid ${inputBorder}`,
                      }}>
                        {i + 1}
                      </div>
                      <span style={{ fontSize: 8, color: i === 0 ? primary : subtextColor, fontWeight: i === 0 ? 600 : 400 }}>
                        {label}
                      </span>
                      {i < settings.stepLabels.length - 1 && (
                        <div style={{ width: 20, height: 1.5, background: inputBorder, margin: '0 6px' }} />
                      )}
                    </div>
                  ))}
                </div>

                {/* Form fields mock */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, fontWeight: 600, color: subtextColor, marginBottom: 3 }}>Order Number</div>
                    <div style={{
                      border: `1.5px solid ${inputBorder}`,
                      borderRadius: radius,
                      padding: '6px 8px',
                      fontSize: 9,
                      color: subtextColor,
                      background: isLightColor(bg) ? '#ffffff' : hexToRgba('#ffffff', 0.08),
                    }}>
                      #1001
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 8, fontWeight: 600, color: subtextColor, marginBottom: 3 }}>Email Address</div>
                    <div style={{
                      border: `1.5px solid ${inputBorder}`,
                      borderRadius: radius,
                      padding: '6px 8px',
                      fontSize: 9,
                      color: subtextColor,
                      background: isLightColor(bg) ? '#ffffff' : hexToRgba('#ffffff', 0.08),
                    }}>
                      you@email.com
                    </div>
                  </div>
                </div>

                {/* Button */}
                <div style={{
                  background: primary,
                  color: btnText,
                  borderRadius: radius,
                  padding: '8px 0',
                  textAlign: 'center',
                  fontSize: 10,
                  fontWeight: 600,
                }}>
                  {settings.buttonTextLookup}
                </div>
              </div>
            </div>

            {/* Success preview */}
            <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-primary)' }}>
              <p className="text-[10px] mb-2" style={{ color: 'var(--text-tertiary)' }}>Success Screen</p>
              <div style={{
                background: hexToRgba(primary, 0.06),
                border: `1px solid ${hexToRgba(primary, 0.15)}`,
                borderRadius: radius,
                padding: '12px',
                textAlign: 'center',
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', background: primary,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 6px',
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={btnText} strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: textColor }}>{settings.successTitle}</div>
                <div style={{ fontSize: 8, color: subtextColor, marginTop: 2 }}>{settings.successMessage}</div>
                <div style={{
                  display: 'inline-block',
                  marginTop: 6,
                  border: `1px solid ${primary}`,
                  color: primary,
                  borderRadius: radius,
                  padding: '3px 10px',
                  fontSize: 8,
                  fontWeight: 600,
                }}>
                  {settings.successButtonText}
                </div>
              </div>
            </div>

            {/* Open full preview */}
            <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-primary)' }}>
              <a
                href={`${backendUrl}/widget/playground-returns${brandSlug ? `?brand=${brandSlug}` : ''}`}
                target="_blank"
                rel="noopener"
                className="text-xs font-medium block text-center py-1.5 rounded-lg transition-colors"
                style={{
                  color: 'var(--color-accent)',
                  border: '1px solid var(--border-primary)',
                }}
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
