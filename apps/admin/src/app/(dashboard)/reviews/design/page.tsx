'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Check, RotateCcw, RefreshCw, Star } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface WidgetDesign {
  starColor: string;
  textColor: string;
  headingColor: string;
  backgroundColor: string;
  dividerColor: string;
  verifiedBadgeColor: string;
  dateColor: string;
  bodyFontFamily: string;
  headingFontFamily: string;
  bodyFontWeight: string;
  headingFontWeight: string;
  ratingFontFamily: string;
  ratingFontWeight: string;
  bodyFontSize: string;
  headerTitleSize: string;
  ratingNumberSize: string;
  cardPadding: string;
  photoSize: string;
  fontSize: 'small' | 'medium' | 'large';
  borderRadius: 'sharp' | 'rounded' | 'pill';
  cardStyle: 'bordered' | 'shadow' | 'minimal';
  buttonStyle: 'outlined' | 'filled' | 'minimal';
  buttonText: string;
  headerText: string;
  layout: 'grid' | 'list';
  showVerifiedBadge: boolean;
  showVariant: boolean;
  showDate: boolean;
  showPhotos: boolean;
  showHelpfulButton: boolean;
  reviewsPerPage: number;
}

const DEFAULTS: WidgetDesign = {
  starColor: '#C4A265',
  textColor: '#333333',
  headingColor: '#C4A265',
  backgroundColor: '#ffffff',
  dividerColor: '#eeeeee',
  verifiedBadgeColor: '#4caf50',
  dateColor: '#aaaaaa',
  bodyFontFamily: 'Manrope',
  headingFontFamily: 'Manrope',
  bodyFontWeight: '400',
  headingFontWeight: '600',
  ratingFontFamily: 'Newsreader',
  ratingFontWeight: '200',
  bodyFontSize: '14px',
  headerTitleSize: '11px',
  ratingNumberSize: '42px',
  cardPadding: '32px 28px',
  photoSize: '64px',
  fontSize: 'medium',
  borderRadius: 'rounded',
  cardStyle: 'bordered',
  buttonStyle: 'outlined',
  buttonText: 'WRITE A REVIEW',
  headerText: 'CUSTOMER REVIEWS',
  layout: 'grid',
  showVerifiedBadge: true,
  showVariant: true,
  showDate: true,
  showPhotos: true,
  showHelpfulButton: false,
  reviewsPerPage: 10,
};

const COLOR_PRESETS = [
  { label: 'Gold', value: '#C4A265' },
  { label: 'Black', value: '#18181b' },
  { label: 'Brown', value: '#6B4A37' },
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Forest', value: '#2d5a3d' },
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

export default function ReviewWidgetDesignPage() {
  const [settings, setSettings] = useState<WidgetDesign>(DEFAULTS);
  const [original, setOriginal] = useState<WidgetDesign>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { brandSlug } = useBrand();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  useEffect(() => {
    fetch('/api/reviews/design')
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

  const [previewKey, setPreviewKey] = useState(0);
  const saveCountRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Send live design updates to the iframe via postMessage
  useEffect(() => {
    if (!loading && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'orw:design_update', design: settings },
        '*',
      );
    }
  }, [settings, loading]);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/reviews/design', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setOriginal({ ...settings });
      setSaved(true);
      saveCountRef.current += 1;
      setPreviewKey(saveCountRef.current);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    }
    setSaving(false);
  }, [settings]);

  const handleReset = useCallback(() => {
    setSettings(DEFAULTS);
  }, []);

  function ToggleSwitch({
    value,
    onChange,
    label,
  }: {
    value: boolean;
    onChange: (v: boolean) => void;
    label: string;
  }) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <button
          onClick={() => onChange(!value)}
          className="w-9 h-5 rounded-full transition-colors relative flex-shrink-0"
          style={{
            backgroundColor: value ? 'var(--color-accent)' : 'var(--border-primary)',
          }}
        >
          <div
            className="w-3.5 h-3.5 bg-white rounded-full absolute transition-transform"
            style={{ top: '3px', left: value ? '17px' : '3px' }}
          />
        </button>
      </div>
    );
  }

  if (loading)
    return (
      <div className="animate-pulse">
        <div className="h-96 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );

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
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Widget Design
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Customize the customer-facing reviews widget appearance
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
            {saved ? (
              <>
                <Check size={14} /> Saved
              </>
            ) : saving ? (
              'Saving...'
            ) : (
              <>
                <Save size={14} /> Save Changes
              </>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Left: Settings */}
        <div className="space-y-5">
          {/* Star Color */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Star Color
            </h3>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={settings.starColor}
                onChange={(e) => setSettings({ ...settings, starColor: e.target.value })}
                className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={settings.starColor}
                onChange={(e) => {
                  if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value))
                    setSettings({ ...settings, starColor: e.target.value });
                }}
                className="w-28 text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={inputStyle}
              />
              <div className="flex items-center gap-0.5 ml-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} size={16} fill={settings.starColor} stroke={settings.starColor} />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setSettings({ ...settings, starColor: preset.value })}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-medium"
                  style={{
                    borderColor:
                      settings.starColor === preset.value
                        ? 'var(--text-primary)'
                        : 'var(--border-primary)',
                    backgroundColor:
                      settings.starColor === preset.value ? 'var(--bg-tertiary)' : 'transparent',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span className="w-3 h-3 rounded-full" style={{ background: preset.value }} />
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Text Colors */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Colors
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Text Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={settings.textColor}
                    onChange={(e) => setSettings({ ...settings, textColor: e.target.value })}
                    className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={settings.textColor}
                    onChange={(e) => {
                      if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value))
                        setSettings({ ...settings, textColor: e.target.value });
                    }}
                    className="w-24 text-xs font-mono rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Heading Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={settings.headingColor}
                    onChange={(e) => setSettings({ ...settings, headingColor: e.target.value })}
                    className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={settings.headingColor}
                    onChange={(e) => {
                      if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value))
                        setSettings({ ...settings, headingColor: e.target.value });
                    }}
                    className="w-24 text-xs font-mono rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Typography */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Typography
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  className="text-xs font-medium mb-1 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Body Font
                </label>
                <input
                  type="text"
                  value={settings.fontFamily}
                  onChange={(e) => setSettings({ ...settings, fontFamily: e.target.value })}
                  placeholder="System default"
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={inputStyle}
                />
              </div>
              <div>
                <label
                  className="text-xs font-medium mb-1 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Heading Font
                </label>
                <input
                  type="text"
                  value={settings.headingFontFamily}
                  onChange={(e) => setSettings({ ...settings, headingFontFamily: e.target.value })}
                  placeholder="Same as body"
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={inputStyle}
                />
              </div>
            </div>
            <div className="mt-4">
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Font Size
              </label>
              <div className="flex gap-3">
                {(['small', 'medium', 'large'] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => setSettings({ ...settings, fontSize: size })}
                    className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                    style={{
                      border:
                        settings.fontSize === size
                          ? '2px solid var(--text-primary)'
                          : '2px solid var(--border-primary)',
                      backgroundColor:
                        settings.fontSize === size ? 'var(--bg-tertiary)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Shape & Style */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Shape & Style
            </h3>
            <div className="space-y-4">
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Corner Radius
                </label>
                <div className="flex gap-3">
                  {RADIUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSettings({ ...settings, borderRadius: opt.id })}
                      className="px-4 py-2 text-xs font-medium transition-colors"
                      style={{
                        borderRadius: radiusValue(opt.id),
                        border:
                          settings.borderRadius === opt.id
                            ? '2px solid var(--text-primary)'
                            : '2px solid var(--border-primary)',
                        backgroundColor:
                          settings.borderRadius === opt.id ? 'var(--bg-tertiary)' : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Card Style
                </label>
                <div className="flex gap-3">
                  {(['bordered', 'shadow', 'minimal'] as const).map((style) => (
                    <button
                      key={style}
                      onClick={() => setSettings({ ...settings, cardStyle: style })}
                      className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                      style={{
                        border:
                          settings.cardStyle === style
                            ? '2px solid var(--text-primary)'
                            : '2px solid var(--border-primary)',
                        backgroundColor:
                          settings.cardStyle === style ? 'var(--bg-tertiary)' : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Button Style
                </label>
                <div className="flex gap-3">
                  {(['outlined', 'filled', 'minimal'] as const).map((style) => (
                    <button
                      key={style}
                      onClick={() => setSettings({ ...settings, buttonStyle: style })}
                      className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                      style={{
                        border:
                          settings.buttonStyle === style
                            ? '2px solid var(--text-primary)'
                            : '2px solid var(--border-primary)',
                        backgroundColor:
                          settings.buttonStyle === style ? 'var(--bg-tertiary)' : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Layout
                </label>
                <div className="flex gap-3">
                  {(['grid', 'list'] as const).map((layout) => (
                    <button
                      key={layout}
                      onClick={() => setSettings({ ...settings, layout })}
                      className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                      style={{
                        border:
                          settings.layout === layout
                            ? '2px solid var(--text-primary)'
                            : '2px solid var(--border-primary)',
                        backgroundColor:
                          settings.layout === layout ? 'var(--bg-tertiary)' : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {layout}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Text */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Text
            </h3>
            <div className="space-y-3">
              <div>
                <label
                  className="text-xs font-medium mb-1 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Header Text
                </label>
                <input
                  type="text"
                  value={settings.headerText}
                  onChange={(e) => setSettings({ ...settings, headerText: e.target.value })}
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={inputStyle}
                />
              </div>
              <div>
                <label
                  className="text-xs font-medium mb-1 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Button Text
                </label>
                <input
                  type="text"
                  value={settings.buttonText}
                  onChange={(e) => setSettings({ ...settings, buttonText: e.target.value })}
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          {/* Display Toggles */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Display Options
            </h3>
            <ToggleSwitch
              label="Show verified badge"
              value={settings.showVerifiedBadge}
              onChange={(v) => setSettings({ ...settings, showVerifiedBadge: v })}
            />
            <ToggleSwitch
              label="Show variant info"
              value={settings.showVariant}
              onChange={(v) => setSettings({ ...settings, showVariant: v })}
            />
            <ToggleSwitch
              label="Show review date"
              value={settings.showDate}
              onChange={(v) => setSettings({ ...settings, showDate: v })}
            />
            <ToggleSwitch
              label="Show review photos"
              value={settings.showPhotos}
              onChange={(v) => setSettings({ ...settings, showPhotos: v })}
            />
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-tertiary)' }}
            >
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
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="relative" style={{ height: '520px' }}>
              <iframe
                ref={iframeRef}
                key={previewKey}
                src={`${backendUrl}/widget/preview-reviews?${[brandSlug ? `brand=${brandSlug}` : ''].filter(Boolean).join('&')}`}
                className="absolute inset-0 w-full h-full border-0"
                style={{ background: '#ffffff' }}
                title="Reviews Widget Preview"
              />
            </div>
            <div
              className="px-4 py-3 flex items-center justify-between"
              style={{ borderTop: '1px solid var(--border-primary)' }}
            >
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                {saved
                  ? 'Preview updated with saved design'
                  : hasChanges
                    ? 'Save to update preview'
                    : 'Showing current design'}
              </p>
              <a
                href={`${backendUrl}/widget/preview-reviews${brandSlug ? `?brand=${brandSlug}` : ''}`}
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
