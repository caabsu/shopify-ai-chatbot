'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Check, RotateCcw, RefreshCw } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface TrackingDesign {
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  headingColor: string;
  buttonColor: string;
  buttonTextColor: string;
  headingFont: string;
  bodyFont: string;
  statusFont: string;
  headerText: string;
  subtitle: string;
  buttonText: string;
  orderTabLabel: string;
  trackingTabLabel: string;
  timelineSectionLabel: string;
  orderDetailsSectionLabel: string;
  statusDelivered: string;
  statusInTransit: string;
  statusOutForDelivery: string;
  statusInfoReceived: string;
  statusException: string;
  statusExpired: string;
  statusNotFound: string;
}

const DEFAULTS: TrackingDesign = {
  accentColor: '#C5A059',
  backgroundColor: '#F9F9FB',
  textColor: '#2D3338',
  headingColor: '#C5A059',
  buttonColor: '#C5A059',
  buttonTextColor: '#ffffff',
  headingFont: 'Newsreader',
  bodyFont: 'Manrope',
  statusFont: 'Newsreader',
  headerText: 'Track Your Order',
  subtitle: 'Enter your details below to view real-time shipping updates.',
  buttonText: 'TRACK ORDER',
  orderTabLabel: 'ORDER NUMBER',
  trackingTabLabel: 'TRACKING NUMBER',
  timelineSectionLabel: 'TRACKING TIMELINE',
  orderDetailsSectionLabel: 'ORDER DETAILS',
  statusDelivered: 'Your order has arrived.',
  statusInTransit: 'Your order is on its way.',
  statusOutForDelivery: 'Out for delivery today.',
  statusInfoReceived: 'Shipping label created.',
  statusException: 'Delivery exception — contact support.',
  statusExpired: 'Tracking information expired.',
  statusNotFound: 'Tracking information not available yet.',
};

const ACCENT_PRESETS = [
  { label: 'Gold', value: '#C5A059' },
  { label: 'Black', value: '#18181b' },
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Forest', value: '#2d5a3d' },
  { label: 'Plum', value: '#5b3256' },
  { label: 'Slate', value: '#475569' },
];

export default function TrackingWidgetDesignPage() {
  const [settings, setSettings] = useState<TrackingDesign>(DEFAULTS);
  const [original, setOriginal] = useState<TrackingDesign>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { brandSlug } = useBrand();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  useEffect(() => {
    fetch('/api/tracking/design')
      .then((r) => r.json())
      .then((data) => {
        if (data.design) {
          const merged = { ...DEFAULTS, ...data.design };
          setSettings(merged);
          setOriginal(merged);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const [previewKey, setPreviewKey] = useState(0);
  const saveCountRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Send live design updates to the iframe via postMessage
  useEffect(() => {
    if (!loading && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'otw:design_update', design: settings },
        '*',
      );
    }
  }, [settings, loading]);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/tracking/design', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design: settings }),
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

  function ColorRow({
    label,
    field,
    presets,
  }: {
    label: string;
    field: keyof TrackingDesign;
    presets?: { label: string; value: string }[];
  }) {
    const value = settings[field] as string;
    return (
      <div className="space-y-1.5">
        <label className="text-xs font-medium block" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={value}
            onChange={(e) => setSettings({ ...settings, [field]: e.target.value })}
            className="w-9 h-9 rounded-lg border border-gray-200 cursor-pointer p-0.5"
          />
          <input
            type="text"
            value={value}
            onChange={(e) => {
              if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value))
                setSettings({ ...settings, [field]: e.target.value });
            }}
            className="w-28 text-sm font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
            style={inputStyle}
          />
        </div>
        {presets && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {presets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setSettings({ ...settings, [field]: preset.value })}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-medium"
                style={{
                  borderColor:
                    value === preset.value ? 'var(--text-primary)' : 'var(--border-primary)',
                  backgroundColor:
                    value === preset.value ? 'var(--bg-tertiary)' : 'transparent',
                  color: 'var(--text-secondary)',
                }}
              >
                <span className="w-3 h-3 rounded-full" style={{ background: preset.value }} />
                {preset.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function TextRow({ label, field }: { label: string; field: keyof TrackingDesign }) {
    return (
      <div>
        <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </label>
        <input
          type="text"
          value={settings[field] as string}
          onChange={(e) => setSettings({ ...settings, [field]: e.target.value })}
          className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
          style={inputStyle}
        />
      </div>
    );
  }

  function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div
        className="rounded-xl p-5"
        style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
      >
        <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h3>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Tracking Widget Design
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Customize the order tracking widget appearance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            <RotateCcw size={12} /> Reset to Defaults
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
          {/* Colors */}
          <SectionCard title="Colors">
            <div className="space-y-5">
              <ColorRow label="Accent Color" field="accentColor" presets={ACCENT_PRESETS} />
              <div className="grid grid-cols-2 gap-4">
                <ColorRow label="Background Color" field="backgroundColor" />
                <ColorRow label="Text Color" field="textColor" />
                <ColorRow label="Heading Color" field="headingColor" />
                <ColorRow label="Button Color" field="buttonColor" />
                <ColorRow label="Button Text Color" field="buttonTextColor" />
              </div>
            </div>
          </SectionCard>

          {/* Typography */}
          <SectionCard title="Typography">
            <div className="space-y-3">
              <TextRow label="Heading Font" field="headingFont" />
              <TextRow label="Body Font" field="bodyFont" />
              <TextRow label="Status Font" field="statusFont" />
            </div>
          </SectionCard>

          {/* Labels & Text */}
          <SectionCard title="Labels & Text">
            <div className="space-y-3">
              <TextRow label="Header Text" field="headerText" />
              <TextRow label="Subtitle" field="subtitle" />
              <TextRow label="Button Text" field="buttonText" />
              <TextRow label="Order Tab Label" field="orderTabLabel" />
              <TextRow label="Tracking Tab Label" field="trackingTabLabel" />
              <TextRow label="Timeline Section Label" field="timelineSectionLabel" />
              <TextRow label="Order Details Section Label" field="orderDetailsSectionLabel" />
            </div>
          </SectionCard>

          {/* Status Messages */}
          <SectionCard title="Status Messages">
            <div className="space-y-3">
              <TextRow label="Delivered" field="statusDelivered" />
              <TextRow label="In Transit" field="statusInTransit" />
              <TextRow label="Out for Delivery" field="statusOutForDelivery" />
              <TextRow label="Info Received" field="statusInfoReceived" />
              <TextRow label="Exception" field="statusException" />
              <TextRow label="Expired" field="statusExpired" />
              <TextRow label="Not Found" field="statusNotFound" />
            </div>
          </SectionCard>
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
                src={`${backendUrl}/widget/preview-tracking?${[brandSlug ? `brand=${brandSlug}` : ''].filter(Boolean).join('&')}`}
                className="absolute inset-0 w-full h-full border-0"
                style={{ background: '#ffffff' }}
                title="Order Tracking Widget Preview"
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
                href={`${backendUrl}/widget/preview-tracking${brandSlug ? `?brand=${brandSlug}` : ''}`}
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
