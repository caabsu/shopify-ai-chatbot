'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Check, RotateCcw, RefreshCw } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface DesignSettings {
  primaryColor: string;
  backgroundColor: string;
  headerTitle: string;
  position: 'bottom-right' | 'bottom-left';
  bubbleIcon: 'chat' | 'headset' | 'sparkle' | 'help';
  welcomeMessage: string;
  inputPlaceholder: string;
  borderRadius: 'sharp' | 'rounded' | 'pill';
  fontSize: 'small' | 'medium' | 'large';
  showBrandingBadge: boolean;
  autoOpenDelay: number;
}

const DEFAULTS: DesignSettings = {
  primaryColor: '#6B4A37',
  backgroundColor: '#ffffff',
  headerTitle: 'Outlight Assistant',
  position: 'bottom-right',
  bubbleIcon: 'chat',
  welcomeMessage: '',
  inputPlaceholder: 'Type a message...',
  borderRadius: 'rounded',
  fontSize: 'medium',
  showBrandingBadge: true,
  autoOpenDelay: 0,
};

const COLOR_PRESETS = [
  { label: 'Brown', value: '#6B4A37' },
  { label: 'Black', value: '#1a1a1a' },
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Forest', value: '#2d5a3d' },
  { label: 'Plum', value: '#5b3256' },
  { label: 'Slate', value: '#475569' },
];

const ICON_OPTIONS: { id: DesignSettings['bubbleIcon']; label: string; svg: string }[] = [
  {
    id: 'chat',
    label: 'Chat',
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  },
  {
    id: 'headset',
    label: 'Headset',
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
  },
  {
    id: 'sparkle',
    label: 'AI Sparkle',
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>',
  },
  {
    id: 'help',
    label: 'Help',
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
  },
];

const RADIUS_OPTIONS = [
  { id: 'sharp' as const, label: 'Sharp' },
  { id: 'rounded' as const, label: 'Rounded' },
  { id: 'pill' as const, label: 'Pill' },
];

function radiusValue(r: string): string {
  if (r === 'sharp') return '8px';
  if (r === 'pill') return '24px';
  return '16px';
}

export default function ChatbotDesignPage() {
  const [settings, setSettings] = useState<DesignSettings>(DEFAULTS);
  const [original, setOriginal] = useState<DesignSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewTab, setPreviewTab] = useState<'storefront' | 'embedded'>('storefront');
  const saveCountRef = useRef(0);

  const { brandSlug } = useBrand();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const brandQs = brandSlug && brandSlug !== 'outlight' ? `brand=${brandSlug}` : '';

  useEffect(() => {
    fetch('/api/design')
      .then((r) => r.json())
      .then((data) => {
        if (data.design) {
          const merged = { ...DEFAULTS, ...data.design };
          setSettings(merged);
          setOriginal(merged);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);

  const handleSave = useCallback(async () => {
    setSaving(true);
    await fetch('/api/design', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    setOriginal({ ...settings });
    setSaving(false);
    setSaved(true);
    saveCountRef.current += 1;
    setPreviewKey(saveCountRef.current);
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  const handleReset = useCallback(() => {
    setSettings(DEFAULTS);
  }, []);

  if (loading) return <div className="animate-pulse"><div className="h-96 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} /></div>;

  const iframeSrc = previewTab === 'storefront'
    ? `${backendUrl}/widget/playground?${[brandQs, `_r=${previewKey}`].filter(Boolean).join('&')}`
    : `${backendUrl}/widget/playground-embedded?${[brandQs, `_r=${previewKey}`].filter(Boolean).join('&')}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Widget Design</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Customize the chatbot widget and contact form appearance
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
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

          {/* Assistant Name & Text */}
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Text</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Assistant Name</label>
                <input
                  type="text"
                  value={settings.headerTitle}
                  onChange={(e) => setSettings({ ...settings, headerTitle: e.target.value })}
                  placeholder="e.g. Support Assistant"
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Welcome Tooltip</label>
                <input
                  type="text"
                  value={settings.welcomeMessage}
                  onChange={(e) => setSettings({ ...settings, welcomeMessage: e.target.value })}
                  placeholder="Empty to disable"
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Input Placeholder</label>
                <input
                  type="text"
                  value={settings.inputPlaceholder}
                  onChange={(e) => setSettings({ ...settings, inputPlaceholder: e.target.value })}
                  placeholder="e.g. Ask me anything..."
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
          </div>

          {/* Bubble Icon */}
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Bubble Icon</h3>
            <div className="flex gap-3">
              {ICON_OPTIONS.map((icon) => (
                <button
                  key={icon.id}
                  onClick={() => setSettings({ ...settings, bubbleIcon: icon.id })}
                  className="flex flex-col items-center gap-1.5 w-16 py-2 rounded-lg transition-colors"
                  style={{
                    border: settings.bubbleIcon === icon.id ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                    backgroundColor: settings.bubbleIcon === icon.id ? 'var(--bg-tertiary)' : 'transparent',
                  }}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ background: settings.primaryColor }}>
                    <span dangerouslySetInnerHTML={{ __html: icon.svg }} />
                  </div>
                  <span className="text-[9px] font-medium" style={{ color: 'var(--text-secondary)' }}>{icon.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Shape & Size */}
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

          {/* Position */}
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Widget Position</h3>
            <div className="flex gap-3">
              {(['bottom-right', 'bottom-left'] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => setSettings({ ...settings, position: pos })}
                  className="flex-1 max-w-[160px] relative rounded-lg p-3 transition-colors"
                  style={{
                    border: settings.position === pos ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)',
                    backgroundColor: settings.position === pos ? 'var(--bg-tertiary)' : 'transparent',
                  }}
                >
                  <div className="w-full h-12 rounded relative" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div
                      className="absolute bottom-1 w-3 h-3 rounded-full"
                      style={{ background: settings.primaryColor, ...(pos === 'bottom-right' ? { right: 4 } : { left: 4 }) }}
                    />
                  </div>
                  <p className="text-[10px] font-medium text-center mt-1.5 capitalize" style={{ color: 'var(--text-secondary)' }}>{pos.replace('-', ' ')}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Advanced */}
          <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Advanced</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Auto-open chat</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Seconds before auto-open (0 = off)</p>
                </div>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={settings.autoOpenDelay}
                  onChange={(e) => setSettings({ ...settings, autoOpenDelay: Math.max(0, Math.min(60, parseInt(e.target.value) || 0)) })}
                  className="w-16 text-sm text-center rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Branding badge</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Show &quot;Powered by&quot; badge</p>
                </div>
                <button
                  onClick={() => setSettings({ ...settings, showBrandingBadge: !settings.showBrandingBadge })}
                  className="relative w-10 h-6 rounded-full transition-colors"
                  style={{ backgroundColor: settings.showBrandingBadge ? 'var(--color-accent)' : 'var(--bg-tertiary)' }}
                >
                  <span
                    className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                    style={{ left: settings.showBrandingBadge ? 18 : 2 }}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Live Preview
            </h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPreviewTab('storefront')}
                className="text-[10px] px-2 py-1 rounded-md transition-colors"
                style={{
                  color: previewTab === 'storefront' ? 'var(--color-accent)' : 'var(--text-tertiary)',
                  backgroundColor: previewTab === 'storefront' ? 'var(--bg-tertiary)' : 'transparent',
                }}
              >
                Storefront
              </button>
              <button
                onClick={() => setPreviewTab('embedded')}
                className="text-[10px] px-2 py-1 rounded-md transition-colors"
                style={{
                  color: previewTab === 'embedded' ? 'var(--color-accent)' : 'var(--text-tertiary)',
                  backgroundColor: previewTab === 'embedded' ? 'var(--bg-tertiary)' : 'transparent',
                }}
              >
                Embedded
              </button>
              <button
                onClick={() => setPreviewKey((k) => k + 1)}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md ml-1 transition-colors"
                style={{ color: 'var(--text-tertiary)', border: '1px solid var(--border-primary)' }}
                title="Reload preview"
              >
                <RefreshCw size={10} />
              </button>
            </div>
          </div>
          <div
            className="rounded-xl overflow-hidden sticky top-20"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            <div className="relative" style={{ height: '560px' }}>
              <iframe
                key={`${previewTab}-${previewKey}`}
                src={iframeSrc}
                className="absolute inset-0 w-full h-full border-0"
                style={{ background: '#ffffff' }}
                title="Widget Preview"
              />
            </div>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--border-primary)' }}>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                {saved ? 'Preview updated with saved design' : hasChanges ? 'Save to update preview' : 'Showing current design'}
              </p>
              <a
                href={iframeSrc}
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
