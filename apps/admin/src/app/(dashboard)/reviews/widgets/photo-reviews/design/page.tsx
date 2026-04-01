'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Save,
  Check,
  RotateCcw,
  RefreshCw,
  Copy,
  CheckCircle2,
  Code,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import { useBrand } from '@/components/brand-context';

interface PhotoWidgetDesign {
  imageAspectRatio: '1:1' | '4:5' | '3:4' | '16:9';
  imageObjectFit: 'cover' | 'contain';
  cardLayout: 'overlay' | 'below' | 'side';
  columns: 2 | 3 | 4;
  gap: 'tight' | 'normal' | 'relaxed';
  showStars: boolean;
  showReviewText: boolean;
  showAuthor: boolean;
  showProduct: boolean;
  showVerifiedBadge: boolean;
  maxTextLines: 2 | 3 | 4;
  overlayPosition: 'bottom' | 'top';
  overlayOpacity: number;
  borderRadius: 'none' | 'small' | 'medium' | 'large';
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  cardBackground: string;
  fontFamily: string;
  headerText: string;
  hoverEffect: 'zoom' | 'fade' | 'lift' | 'none';
}

const DEFAULTS: PhotoWidgetDesign = {
  imageAspectRatio: '4:5',
  imageObjectFit: 'cover',
  cardLayout: 'overlay',
  columns: 3,
  gap: 'normal',
  showStars: true,
  showReviewText: true,
  showAuthor: true,
  showProduct: true,
  showVerifiedBadge: true,
  maxTextLines: 3,
  overlayPosition: 'bottom',
  overlayOpacity: 70,
  borderRadius: 'medium',
  accentColor: '#C5A059',
  textColor: '#ffffff',
  backgroundColor: '#F9F9FB',
  cardBackground: '#ffffff',
  fontFamily: 'Manrope',
  headerText: 'WHAT OUR CUSTOMERS SAY',
  hoverEffect: 'zoom',
};

const COLOR_PRESETS = [
  { label: 'Gold', value: '#C5A059' },
  { label: 'Charcoal', value: '#131314' },
  { label: 'Brown', value: '#6B4A37' },
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Forest', value: '#2d5a3d' },
  { label: 'Slate', value: '#475569' },
];

const PRODUCT_PAGE_SNIPPET = `<!-- Photo Reviews Widget by Outlight -->
<div id="outlight-photo-reviews"
  data-product-handle="{{ product.handle }}"
  data-shop="put1rp-iq">
</div>
<script src="https://your-backend-url/widget/photo-reviews.js" defer></script>`;

const ALL_REVIEWS_SNIPPET = `<!-- Photo Reviews Widget — All Reviews Page -->
<div id="outlight-photo-reviews"
  data-show-all="true"
  data-shop="put1rp-iq">
</div>
<script src="https://your-backend-url/widget/photo-reviews.js" defer></script>`;

export default function PhotoReviewsDesignPage() {
  const [settings, setSettings] = useState<PhotoWidgetDesign>(DEFAULTS);
  const [original, setOriginal] = useState<PhotoWidgetDesign>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [copiedProduct, setCopiedProduct] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const { brandSlug } = useBrand();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  useEffect(() => {
    fetch('/api/reviews/design?widget=photo-reviews')
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
    try {
      await fetch('/api/reviews/design?widget=photo-reviews', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setOriginal({ ...settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    }
    setSaving(false);
  }, [settings]);

  const handleReset = useCallback(() => {
    setSettings(DEFAULTS);
  }, []);

  const copyToClipboard = useCallback(async (text: string, type: 'product' | 'all') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'product') {
        setCopiedProduct(true);
        setTimeout(() => setCopiedProduct(false), 2000);
      } else {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2000);
      }
    } catch {
      // ignore
    }
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

  const cardStyle = {
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-primary)',
  } as React.CSSProperties;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/reviews/widgets"
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
            style={{ border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            <ArrowLeft size={14} />
          </Link>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Photo Reviews Widget — Design
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Customize the photo-centric reviews widget appearance
            </p>
          </div>
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

      {/* Settings */}
      <div className="space-y-5 max-w-2xl">
        {/* Image Settings */}
        <div className="rounded-xl p-5" style={cardStyle}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            Image Settings
          </h3>
          <div className="space-y-4">
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Aspect Ratio
              </label>
              <div className="flex gap-3">
                {(['1:1', '4:5', '3:4', '16:9'] as const).map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => setSettings({ ...settings, imageAspectRatio: ratio })}
                    className="px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      border:
                        settings.imageAspectRatio === ratio
                          ? '2px solid var(--text-primary)'
                          : '2px solid var(--border-primary)',
                      backgroundColor:
                        settings.imageAspectRatio === ratio ? 'var(--bg-tertiary)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Image Fit
              </label>
              <div className="flex gap-3">
                {(['cover', 'contain'] as const).map((fit) => (
                  <button
                    key={fit}
                    onClick={() => setSettings({ ...settings, imageObjectFit: fit })}
                    className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                    style={{
                      border:
                        settings.imageObjectFit === fit
                          ? '2px solid var(--text-primary)'
                          : '2px solid var(--border-primary)',
                      backgroundColor:
                        settings.imageObjectFit === fit ? 'var(--bg-tertiary)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {fit}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Card Layout */}
        <div className="rounded-xl p-5" style={cardStyle}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            Card Layout
          </h3>
          <div className="space-y-4">
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Text Position
              </label>
              <div className="flex gap-3">
                {(['overlay', 'below', 'side'] as const).map((layout) => (
                  <button
                    key={layout}
                    onClick={() => setSettings({ ...settings, cardLayout: layout })}
                    className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                    style={{
                      border:
                        settings.cardLayout === layout
                          ? '2px solid var(--text-primary)'
                          : '2px solid var(--border-primary)',
                      backgroundColor:
                        settings.cardLayout === layout ? 'var(--bg-tertiary)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {layout}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Columns
              </label>
              <div className="flex gap-3">
                {([2, 3, 4] as const).map((col) => (
                  <button
                    key={col}
                    onClick={() => setSettings({ ...settings, columns: col })}
                    className="px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      border:
                        settings.columns === col
                          ? '2px solid var(--text-primary)'
                          : '2px solid var(--border-primary)',
                      backgroundColor:
                        settings.columns === col ? 'var(--bg-tertiary)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {col}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Gap
              </label>
              <div className="flex gap-3">
                {(['tight', 'normal', 'relaxed'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setSettings({ ...settings, gap: g })}
                    className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                    style={{
                      border:
                        settings.gap === g
                          ? '2px solid var(--text-primary)'
                          : '2px solid var(--border-primary)',
                      backgroundColor:
                        settings.gap === g ? 'var(--bg-tertiary)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Overlay Settings */}
        <div className="rounded-xl p-5" style={cardStyle}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            Overlay Settings
          </h3>
          <p className="text-[10px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
            These settings apply when card layout is set to &quot;overlay&quot;.
          </p>
          <div className="space-y-4">
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Overlay Position
              </label>
              <div className="flex gap-3">
                {(['bottom', 'top'] as const).map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setSettings({ ...settings, overlayPosition: pos })}
                    className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                    style={{
                      border:
                        settings.overlayPosition === pos
                          ? '2px solid var(--text-primary)'
                          : '2px solid var(--border-primary)',
                      backgroundColor:
                        settings.overlayPosition === pos ? 'var(--bg-tertiary)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Overlay Opacity ({settings.overlayOpacity}%)
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={settings.overlayOpacity}
                onChange={(e) =>
                  setSettings({ ...settings, overlayOpacity: parseInt(e.target.value, 10) })
                }
                className="w-full"
              />
              <div
                className="flex justify-between text-[10px] mt-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <span>Transparent</span>
                <span>Opaque</span>
              </div>
            </div>
          </div>
        </div>

        {/* Colors */}
        <div className="rounded-xl p-5" style={cardStyle}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            Colors
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {([
              { key: 'accentColor' as const, label: 'Accent Color' },
              { key: 'textColor' as const, label: 'Text Color' },
              { key: 'backgroundColor' as const, label: 'Background' },
              { key: 'cardBackground' as const, label: 'Card Background' },
            ]).map(({ key, label }) => (
              <div key={key}>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {label}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={settings[key]}
                    onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                    className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={settings[key]}
                    onChange={(e) => {
                      if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value))
                        setSettings({ ...settings, [key]: e.target.value });
                    }}
                    className="w-24 text-xs font-mono rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2"
                    style={inputStyle}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setSettings({ ...settings, accentColor: preset.value })}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-medium"
                style={{
                  borderColor:
                    settings.accentColor === preset.value
                      ? 'var(--text-primary)'
                      : 'var(--border-primary)',
                  backgroundColor:
                    settings.accentColor === preset.value ? 'var(--bg-tertiary)' : 'transparent',
                  color: 'var(--text-secondary)',
                }}
              >
                <span className="w-3 h-3 rounded-full" style={{ background: preset.value }} />
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Typography & Text */}
        <div className="rounded-xl p-5" style={cardStyle}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            Typography & Text
          </h3>
          <div className="space-y-3">
            <div>
              <label
                className="text-xs font-medium mb-1 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Font Family
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
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Max Text Lines
              </label>
              <div className="flex gap-3">
                {([2, 3, 4] as const).map((lines) => (
                  <button
                    key={lines}
                    onClick={() => setSettings({ ...settings, maxTextLines: lines })}
                    className="px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      border:
                        settings.maxTextLines === lines
                          ? '2px solid var(--text-primary)'
                          : '2px solid var(--border-primary)',
                      backgroundColor:
                        settings.maxTextLines === lines ? 'var(--bg-tertiary)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {lines} lines
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Shape & Effects */}
        <div className="rounded-xl p-5" style={cardStyle}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            Shape & Effects
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
                {(['none', 'small', 'medium', 'large'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setSettings({ ...settings, borderRadius: r })}
                    className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                    style={{
                      border:
                        settings.borderRadius === r
                          ? '2px solid var(--text-primary)'
                          : '2px solid var(--border-primary)',
                      backgroundColor:
                        settings.borderRadius === r ? 'var(--bg-tertiary)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Hover Effect
              </label>
              <div className="flex gap-3">
                {(['zoom', 'fade', 'lift', 'none'] as const).map((effect) => (
                  <button
                    key={effect}
                    onClick={() => setSettings({ ...settings, hoverEffect: effect })}
                    className="px-4 py-2 rounded-lg text-xs font-medium capitalize transition-colors"
                    style={{
                      border:
                        settings.hoverEffect === effect
                          ? '2px solid var(--text-primary)'
                          : '2px solid var(--border-primary)',
                      backgroundColor:
                        settings.hoverEffect === effect ? 'var(--bg-tertiary)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {effect}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Display Options */}
        <div className="rounded-xl p-5" style={cardStyle}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            Display Options
          </h3>
          <ToggleSwitch
            label="Show star rating"
            value={settings.showStars}
            onChange={(v) => setSettings({ ...settings, showStars: v })}
          />
          <ToggleSwitch
            label="Show review text"
            value={settings.showReviewText}
            onChange={(v) => setSettings({ ...settings, showReviewText: v })}
          />
          <ToggleSwitch
            label="Show author name"
            value={settings.showAuthor}
            onChange={(v) => setSettings({ ...settings, showAuthor: v })}
          />
          <ToggleSwitch
            label="Show product name"
            value={settings.showProduct}
            onChange={(v) => setSettings({ ...settings, showProduct: v })}
          />
          <ToggleSwitch
            label="Show verified badge"
            value={settings.showVerifiedBadge}
            onChange={(v) => setSettings({ ...settings, showVerifiedBadge: v })}
          />
        </div>

        {/* Shopify Installation */}
        <div className="rounded-xl" style={cardStyle}>
          <button
            onClick={() => setInstallOpen(!installOpen)}
            className="w-full flex items-center justify-between p-5"
          >
            <div className="flex items-center gap-2">
              <Code size={16} style={{ color: 'var(--text-secondary)' }} />
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Shopify Installation
              </h3>
            </div>
            {installOpen ? (
              <ChevronUp size={16} style={{ color: 'var(--text-tertiary)' }} />
            ) : (
              <ChevronDown size={16} style={{ color: 'var(--text-tertiary)' }} />
            )}
          </button>

          {installOpen && (
            <div className="px-5 pb-5 space-y-5" style={{ borderTop: '1px solid var(--border-primary)' }}>
              <div className="pt-4">
                <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                  Add this code to your Shopify product page template (product.liquid or a custom
                  section). The widget will automatically load reviews for the current product.
                </p>

                {/* Product Page Snippet */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label
                      className="text-xs font-medium"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Product Page
                    </label>
                    <button
                      onClick={() => copyToClipboard(PRODUCT_PAGE_SNIPPET, 'product')}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors"
                      style={{
                        border: '1px solid var(--border-primary)',
                        color: copiedProduct ? '#4caf50' : 'var(--text-secondary)',
                      }}
                    >
                      {copiedProduct ? (
                        <>
                          <CheckCircle2 size={10} /> Copied
                        </>
                      ) : (
                        <>
                          <Copy size={10} /> Copy Code
                        </>
                      )}
                    </button>
                  </div>
                  <div
                    className="rounded-lg p-4 overflow-x-auto"
                    style={{
                      backgroundColor: '#1e1e2e',
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    }}
                  >
                    <pre className="text-xs leading-relaxed" style={{ color: '#cdd6f4' }}>
                      <code>{PRODUCT_PAGE_SNIPPET}</code>
                    </pre>
                  </div>
                </div>

                {/* All Reviews Page Snippet */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label
                      className="text-xs font-medium"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      All Reviews Page
                    </label>
                    <button
                      onClick={() => copyToClipboard(ALL_REVIEWS_SNIPPET, 'all')}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors"
                      style={{
                        border: '1px solid var(--border-primary)',
                        color: copiedAll ? '#4caf50' : 'var(--text-secondary)',
                      }}
                    >
                      {copiedAll ? (
                        <>
                          <CheckCircle2 size={10} /> Copied
                        </>
                      ) : (
                        <>
                          <Copy size={10} /> Copy Code
                        </>
                      )}
                    </button>
                  </div>
                  <div
                    className="rounded-lg p-4 overflow-x-auto"
                    style={{
                      backgroundColor: '#1e1e2e',
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    }}
                  >
                    <pre className="text-xs leading-relaxed" style={{ color: '#cdd6f4' }}>
                      <code>{ALL_REVIEWS_SNIPPET}</code>
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
