'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Save,
  Check,
  RotateCcw,
  Copy,
  CheckCircle2,
  Code,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import { useBrand } from '@/components/brand-context';

/* ------------------------------------------------------------------ */
/*  Types & defaults                                                   */
/* ------------------------------------------------------------------ */

interface FullBleedDesign {
  starColor: string;
  noPhotoBg: string;
  cardWidth: number;
  cardHeight: number;
  maxCards: number;
  photosFirst: boolean;
  showVerifiedBadge: boolean;
  showDate: boolean;
  showVariant: boolean;
  showHelpful: boolean;
  gradientOpacity: number;
  headerText: string;
  borderRadius: 'none' | 'small' | 'medium';
}

const DEFAULTS: FullBleedDesign = {
  starColor: '#C5A059',
  noPhotoBg: '#f4f0eb',
  cardWidth: 360,
  cardHeight: 400,
  maxCards: 12,
  photosFirst: true,
  showVerifiedBadge: true,
  showDate: true,
  showVariant: true,
  showHelpful: true,
  gradientOpacity: 70,
  headerText: 'Customer Reviews',
  borderRadius: 'small',
};

const BORDER_RADIUS_MAP: Record<FullBleedDesign['borderRadius'], number> = {
  none: 0,
  small: 6,
  medium: 12,
};

const COLOR_PRESETS = [
  { label: 'Gold', value: '#C5A059' },
  { label: 'Charcoal', value: '#131314' },
  { label: 'Brown', value: '#6B4A37' },
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Forest', value: '#2d5a3d' },
  { label: 'Slate', value: '#475569' },
];

const PRODUCT_PAGE_SNIPPET = `<!-- Full-Bleed Carousel Widget by Outlight -->
<div id="outlight-fullbleed-carousel"
  data-product-handle="{{ product.handle }}"
  data-shop="put1rp-iq">
</div>
<script src="https://your-backend-url/widget/full-bleed-carousel.js" defer></script>`;

const ALL_REVIEWS_SNIPPET = `<!-- Full-Bleed Carousel Widget — All Reviews Page -->
<div id="outlight-fullbleed-carousel"
  data-show-all="true"
  data-shop="put1rp-iq">
</div>
<script src="https://your-backend-url/widget/full-bleed-carousel.js" defer></script>`;

/* ------------------------------------------------------------------ */
/*  Mock preview data                                                  */
/* ------------------------------------------------------------------ */

const PREVIEW_REVIEWS = [
  {
    id: '1',
    author: 'Sarah M.',
    rating: 5,
    date: 'Mar 15, 2026',
    verified: true,
    snippet: 'The Aven light transformed our outdoor space completely.',
    variant: 'Brass / Warm White',
    helpful: 12,
    gradient: 'linear-gradient(160deg, #C49A3C 0%, #7A6322 50%, #2D2A1F 100%)',
    hasPhoto: true,
  },
  {
    id: '2',
    author: 'James K.',
    rating: 5,
    date: 'Feb 28, 2026',
    verified: true,
    snippet: 'Professional grade quality. Survived a harsh winter without any issues.',
    variant: 'Brass / Daylight',
    helpful: 8,
    gradient: 'linear-gradient(145deg, #D4A846 0%, #8B6914 45%, #342E1C 100%)',
    hasPhoto: true,
  },
  {
    id: '3',
    author: 'Rachel T.',
    rating: 4,
    date: 'Feb 10, 2026',
    verified: true,
    snippet: 'Love the minimalist design. Only wish the cable was a bit longer.',
    variant: 'Black / Warm White',
    helpful: 5,
    gradient: null,
    hasPhoto: false,
  },
];

/* ------------------------------------------------------------------ */
/*  Live preview component                                             */
/* ------------------------------------------------------------------ */

function LivePreview({ settings }: { settings: FullBleedDesign }) {
  const br = BORDER_RADIUS_MAP[settings.borderRadius];
  const gradAlpha = settings.gradientOpacity / 100;
  const FONT = "'Manrope', system-ui, sans-serif";

  return (
    <div
      style={{
        padding: '24px 20px',
        background: '#FEFDFB',
        fontFamily: FONT,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: settings.starColor,
          marginBottom: 14,
          marginTop: 0,
        }}
      >
        {settings.headerText || 'Customer Reviews'}
      </p>

      {/* Carousel */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          paddingBottom: 4,
        }}
      >
        {PREVIEW_REVIEWS.map((review) => {
          const isPhoto = review.hasPhoto;
          return (
            <div
              key={review.id}
              style={{
                flex: `0 0 ${Math.round(settings.cardWidth * 0.52)}px`,
                height: Math.round(settings.cardHeight * 0.52),
                scrollSnapAlign: 'start',
                borderRadius: br,
                overflow: 'hidden',
                position: 'relative',
                background: isPhoto ? 'transparent' : settings.noPhotoBg,
                boxShadow: '0 1px 2px rgba(0,0,0,0.03), 0 4px 16px rgba(0,0,0,0.06)',
                flexShrink: 0,
              }}
            >
              {isPhoto && review.gradient && (
                <>
                  {/* BG image substitute */}
                  <div style={{ position: 'absolute', inset: 0, background: review.gradient }} />
                  {/* Gradient overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: `linear-gradient(transparent 30%, rgba(0,0,0,${gradAlpha}))`,
                    }}
                  />
                </>
              )}

              {/* Content */}
              <div
                style={{
                  position: isPhoto ? 'absolute' : 'relative',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: isPhoto ? '14px 14px' : '16px 14px',
                }}
              >
                {/* Stars */}
                <div style={{ display: 'flex', gap: 1, marginBottom: 4 }}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={9}
                      fill={s <= review.rating ? (isPhoto ? '#fff' : settings.starColor) : 'none'}
                      stroke={isPhoto ? '#fff' : settings.starColor}
                      strokeWidth={1.5}
                    />
                  ))}
                </div>

                {/* Author */}
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 500,
                    color: isPhoto ? '#fff' : '#2D3338',
                    marginBottom: 2,
                  }}
                >
                  {review.author}
                  {settings.showVerifiedBadge && review.verified && (
                    <span
                      style={{
                        marginLeft: 4,
                        fontSize: 8,
                        color: settings.starColor,
                        fontWeight: 400,
                      }}
                    >
                      Verified
                    </span>
                  )}
                </div>

                {/* Date */}
                {settings.showDate && (
                  <div
                    style={{
                      fontSize: 7,
                      fontWeight: 300,
                      color: isPhoto ? 'rgba(255,255,255,0.4)' : 'rgba(45,51,56,0.35)',
                      marginBottom: 4,
                    }}
                  >
                    {review.date}
                  </div>
                )}

                {/* Snippet */}
                <div
                  style={{
                    fontSize: 8,
                    fontWeight: 300,
                    color: isPhoto ? 'rgba(255,255,255,0.65)' : 'rgba(45,51,56,0.55)',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: isPhoto ? 2 : 4,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {review.snippet}
                </div>

                {/* Variant */}
                {settings.showVariant && (
                  <div
                    style={{
                      marginTop: 5,
                      paddingTop: 5,
                      borderTop: `1px solid ${isPhoto ? 'rgba(255,255,255,0.12)' : 'rgba(45,51,56,0.1)'}`,
                      fontSize: 7,
                      color: isPhoto ? 'rgba(255,255,255,0.3)' : 'rgba(45,51,56,0.28)',
                    }}
                  >
                    {review.variant}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function FullBleedCarouselDesignPage() {
  const [settings, setSettings] = useState<FullBleedDesign>(DEFAULTS);
  const [original, setOriginal] = useState<FullBleedDesign>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [copiedProduct, setCopiedProduct] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const { brandSlug } = useBrand();

  useEffect(() => {
    fetch('/api/reviews/design?widget=full-bleed-carousel')
      .then((r) => r.json())
      .then((data) => {
        if (data.design) {
          const merged = { ...DEFAULTS, ...data.design };
          setSettings(merged);
          setOriginal(merged);
        }
      })
      .catch(() => {
        // use defaults if endpoint not available
      })
      .finally(() => setLoading(false));
  }, []);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/reviews/design?widget=full-bleed-carousel', {
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
              Full-Bleed Carousel — Design
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Customize the cinematic full-bleed carousel widget appearance
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

      {/* Two-column layout: settings + live preview */}
      <div className="flex gap-6 items-start">
        {/* Settings column */}
        <div className="space-y-5 flex-1 min-w-0 max-w-lg">

          {/* Card Dimensions */}
          <div className="rounded-xl p-5" style={cardStyle}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Card Dimensions
            </h3>
            <div className="space-y-4">
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Card Width ({settings.cardWidth}px)
                </label>
                <input
                  type="range"
                  min={280}
                  max={420}
                  value={settings.cardWidth}
                  onChange={(e) =>
                    setSettings({ ...settings, cardWidth: parseInt(e.target.value, 10) })
                  }
                  className="w-full"
                />
                <div
                  className="flex justify-between text-[10px] mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <span>280px</span>
                  <span>420px</span>
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Card Height ({settings.cardHeight}px)
                </label>
                <input
                  type="range"
                  min={320}
                  max={500}
                  value={settings.cardHeight}
                  onChange={(e) =>
                    setSettings({ ...settings, cardHeight: parseInt(e.target.value, 10) })
                  }
                  className="w-full"
                />
                <div
                  className="flex justify-between text-[10px] mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <span>320px</span>
                  <span>500px</span>
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Max Cards ({settings.maxCards})
                </label>
                <input
                  type="range"
                  min={4}
                  max={20}
                  value={settings.maxCards}
                  onChange={(e) =>
                    setSettings({ ...settings, maxCards: parseInt(e.target.value, 10) })
                  }
                  className="w-full"
                />
                <div
                  className="flex justify-between text-[10px] mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <span>4</span>
                  <span>20</span>
                </div>
              </div>
            </div>
          </div>

          {/* Gradient & Shape */}
          <div className="rounded-xl p-5" style={cardStyle}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Gradient &amp; Shape
            </h3>
            <div className="space-y-4">
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Gradient Opacity ({settings.gradientOpacity}%)
                </label>
                <input
                  type="range"
                  min={40}
                  max={90}
                  value={settings.gradientOpacity}
                  onChange={(e) =>
                    setSettings({ ...settings, gradientOpacity: parseInt(e.target.value, 10) })
                  }
                  className="w-full"
                />
                <div
                  className="flex justify-between text-[10px] mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <span>Lighter</span>
                  <span>Darker</span>
                </div>
              </div>
              <div>
                <label
                  className="text-xs font-medium mb-1.5 block"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Corner Radius
                </label>
                <div className="flex gap-3">
                  {(['none', 'small', 'medium'] as const).map((r) => (
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
            </div>
          </div>

          {/* Colors */}
          <div className="rounded-xl p-5" style={cardStyle}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Colors
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {([
                { key: 'starColor' as const, label: 'Star / Accent Color' },
                { key: 'noPhotoBg' as const, label: 'No-Photo Card Background' },
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

          {/* Text */}
          <div className="rounded-xl p-5" style={cardStyle}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Header Text
            </h3>
            <input
              type="text"
              value={settings.headerText}
              onChange={(e) => setSettings({ ...settings, headerText: e.target.value })}
              className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
              style={inputStyle}
              placeholder="Customer Reviews"
            />
          </div>

          {/* Display Options */}
          <div className="rounded-xl p-5" style={cardStyle}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              Display Options
            </h3>
            <ToggleSwitch
              label="Photos first (sort photo reviews to the front)"
              value={settings.photosFirst}
              onChange={(v) => setSettings({ ...settings, photosFirst: v })}
            />
            <ToggleSwitch
              label="Show verified badge"
              value={settings.showVerifiedBadge}
              onChange={(v) => setSettings({ ...settings, showVerifiedBadge: v })}
            />
            <ToggleSwitch
              label="Show review date"
              value={settings.showDate}
              onChange={(v) => setSettings({ ...settings, showDate: v })}
            />
            <ToggleSwitch
              label="Show product variant"
              value={settings.showVariant}
              onChange={(v) => setSettings({ ...settings, showVariant: v })}
            />
            <ToggleSwitch
              label="Show helpful button"
              value={settings.showHelpful}
              onChange={(v) => setSettings({ ...settings, showHelpful: v })}
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
              <div
                className="px-5 pb-5 space-y-5"
                style={{ borderTop: '1px solid var(--border-primary)' }}
              >
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

        {/* Live preview column */}
        <div
          className="flex-shrink-0 rounded-xl overflow-hidden sticky top-6"
          style={{
            width: 340,
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ borderBottom: '1px solid var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Live Preview
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              3 sample cards
            </span>
          </div>
          <LivePreview settings={settings} />
        </div>
      </div>
    </div>
  );
}
