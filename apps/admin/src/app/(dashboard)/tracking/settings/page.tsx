'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Check, Settings, ChevronDown, ChevronRight, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface CarrierEntry {
  slug: string;
  displayName: string;
}

interface TrackingSettings {
  apiKey: string;
  cacheTtlMinutes: number;
  carriers: CarrierEntry[];
}

const DEFAULT_CARRIERS: CarrierEntry[] = [
  { slug: 'usps', displayName: 'USPS' },
  { slug: 'ups', displayName: 'UPS' },
  { slug: 'fedex', displayName: 'FedEx' },
  { slug: 'dhl', displayName: 'DHL' },
  { slug: 'yanwen', displayName: 'Yanwen' },
  { slug: 'china-post', displayName: 'China Post' },
  { slug: 'china-ems', displayName: 'China EMS' },
];

const DEFAULTS: TrackingSettings = {
  apiKey: '',
  cacheTtlMinutes: 120,
  carriers: DEFAULT_CARRIERS,
};

export default function TrackingSettingsPage() {
  const { brandSlug } = useBrand();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  const [settings, setSettings] = useState<TrackingSettings>(DEFAULTS);
  const [original, setOriginal] = useState<TrackingSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // New carrier row state
  const [newCarrierSlug, setNewCarrierSlug] = useState('');
  const [newCarrierName, setNewCarrierName] = useState('');

  useEffect(() => {
    fetch('/api/tracking/settings')
      .then((r) => r.json())
      .then((data) => {
        const merged = { ...DEFAULTS, ...data };
        if (!Array.isArray(merged.carriers) || merged.carriers.length === 0) {
          merged.carriers = DEFAULT_CARRIERS;
        }
        setSettings(merged);
        setOriginal(merged);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/tracking/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const data = await res.json();
        const merged = { ...DEFAULTS, ...data };
        if (!Array.isArray(merged.carriers) || merged.carriers.length === 0) {
          merged.carriers = settings.carriers;
        }
        setSettings(merged);
        setOriginal(merged);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // ignore
    }
    setSaving(false);
  }, [settings]);

  async function handleTestConnection() {
    setTestStatus('testing');
    try {
      const res = await fetch(`${backendUrl}/api/tracking/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: '9400111899223397506355' }),
      });
      setTestStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setTestStatus('fail');
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  }

  function toggleSection(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function addCarrier() {
    const slug = newCarrierSlug.trim().toLowerCase();
    const displayName = newCarrierName.trim();
    if (!slug || !displayName) return;
    if (settings.carriers.some((c) => c.slug === slug)) return;
    setSettings({
      ...settings,
      carriers: [...settings.carriers, { slug, displayName }],
    });
    setNewCarrierSlug('');
    setNewCarrierName('');
  }

  function removeCarrier(slug: string) {
    setSettings({
      ...settings,
      carriers: settings.carriers.filter((c) => c.slug !== slug),
    });
  }

  function updateCarrierName(slug: string, displayName: string) {
    setSettings({
      ...settings,
      carriers: settings.carriers.map((c) => (c.slug === slug ? { ...c, displayName } : c)),
    });
  }

  function SectionCard({
    title,
    sectionKey,
    children,
  }: {
    title: string;
    sectionKey: string;
    children: React.ReactNode;
  }) {
    const isCollapsed = collapsed[sectionKey] ?? false;
    return (
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <button
          onClick={() => toggleSection(sectionKey)}
          className="w-full flex items-center justify-between px-5 py-4 text-left"
          style={{ background: 'none', border: 'none' }}
        >
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h3>
          {isCollapsed ? (
            <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
          ) : (
            <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} />
          )}
        </button>
        {!isCollapsed && (
          <div className="px-5 pb-5" style={{ borderTop: '1px solid var(--border-secondary)' }}>
            <div className="pt-3">{children}</div>
          </div>
        )}
      </div>
    );
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
        <div className="flex items-center gap-3">
          <Settings size={20} style={{ color: 'var(--text-primary)' }} />
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Tracking Settings
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Configure the order tracking integration and display options
            </p>
          </div>
        </div>
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

      <div className="space-y-4">
        {/* API Configuration */}
        <SectionCard title="API Configuration" sectionKey="api">
          <div className="space-y-4">
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                17track API Key
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={settings.apiKey}
                    onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                    placeholder="Enter your 17track API key"
                    className="w-full text-sm rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2"
                    style={inputStyle}
                  />
                  <button
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--text-tertiary)' }}
                    type="button"
                  >
                    {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button
                  onClick={handleTestConnection}
                  disabled={!settings.apiKey || testStatus === 'testing'}
                  className="flex-shrink-0 px-3 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    border: '1px solid var(--border-primary)',
                    color:
                      testStatus === 'ok'
                        ? '#22c55e'
                        : testStatus === 'fail'
                          ? '#ef4444'
                          : 'var(--text-secondary)',
                    backgroundColor:
                      testStatus === 'ok'
                        ? 'rgba(34,197,94,0.08)'
                        : testStatus === 'fail'
                          ? 'rgba(239,68,68,0.08)'
                          : 'transparent',
                  }}
                >
                  {testStatus === 'testing'
                    ? 'Testing...'
                    : testStatus === 'ok'
                      ? 'Connected'
                      : testStatus === 'fail'
                        ? 'Failed'
                        : 'Test Connection'}
                </button>
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                Get your API key from{' '}
                <a
                  href="https://www.17track.net/en/api"
                  target="_blank"
                  rel="noopener"
                  style={{ color: 'var(--color-accent)' }}
                >
                  17track.net/en/api
                </a>
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Cache */}
        <SectionCard title="Cache" sectionKey="cache">
          <div className="flex items-center gap-3">
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Cache TTL
            </label>
            <input
              type="number"
              min={1}
              max={1440}
              value={settings.cacheTtlMinutes}
              onChange={(e) =>
                setSettings({ ...settings, cacheTtlMinutes: parseInt(e.target.value) || 120 })
              }
              className="w-24 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
              style={inputStyle}
            />
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              minutes
            </span>
          </div>
          <p className="text-[10px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
            How long to cache tracking results before re-querying the carrier. Default: 120 minutes.
          </p>
        </SectionCard>

        {/* Carrier Display Names */}
        <SectionCard title="Carrier Display Names" sectionKey="carriers">
          <div className="space-y-3">
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Map internal carrier slugs to human-readable names shown in the widget.
            </p>

            {/* Carrier table */}
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--border-primary)' }}
            >
              <div
                className="grid grid-cols-[1fr_1fr_40px] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-tertiary)',
                  borderBottom: '1px solid var(--border-primary)',
                }}
              >
                <span>Slug</span>
                <span>Display Name</span>
                <span />
              </div>
              {settings.carriers.map((carrier) => (
                <div
                  key={carrier.slug}
                  className="grid grid-cols-[1fr_1fr_40px] items-center px-4 py-2"
                  style={{ borderBottom: '1px solid var(--border-primary)' }}
                >
                  <span
                    className="text-xs font-mono"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {carrier.slug}
                  </span>
                  <input
                    type="text"
                    value={carrier.displayName}
                    onChange={(e) => updateCarrierName(carrier.slug, e.target.value)}
                    className="text-sm rounded-lg px-2 py-1 focus:outline-none focus:ring-1 mr-2"
                    style={inputStyle}
                  />
                  <button
                    onClick={() => removeCarrier(carrier.slug)}
                    className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                    style={{ color: 'var(--text-tertiary)' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = '#ef4444';
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(239,68,68,0.08)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)';
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                    }}
                    title="Remove carrier"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add new carrier */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newCarrierSlug}
                onChange={(e) => setNewCarrierSlug(e.target.value)}
                placeholder="slug (e.g. laser-ship)"
                className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={inputStyle}
              />
              <input
                type="text"
                value={newCarrierName}
                onChange={(e) => setNewCarrierName(e.target.value)}
                placeholder="Display name"
                className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={inputStyle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCarrier();
                }}
              />
              <button
                onClick={addCarrier}
                disabled={!newCarrierSlug.trim() || !newCarrierName.trim()}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--color-accent)',
                  color: '#ffffff',
                }}
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
