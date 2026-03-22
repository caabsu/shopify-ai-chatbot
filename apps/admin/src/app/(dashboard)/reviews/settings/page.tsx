'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Check, Settings, ChevronDown, ChevronRight } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface ReviewSettings {
  // Collection
  request_enabled: boolean;
  request_delay_days: number;
  reminder_enabled: boolean;
  reminder_delay_days: number;
  // Moderation
  auto_publish: boolean;
  auto_publish_min_rating: number;
  auto_publish_verified_only: boolean;
  profanity_filter: boolean;
  // Display
  reviews_per_page: number;
  default_sort: string;
  show_verified_badge: boolean;
  show_incentivized_disclosure: boolean;
  // FTC
  incentivized_disclosure_text: string;
  // Email sender
  sender_name: string;
  sender_email: string;
}

const DEFAULTS: ReviewSettings = {
  request_enabled: true,
  request_delay_days: 14,
  reminder_enabled: true,
  reminder_delay_days: 7,
  auto_publish: false,
  auto_publish_min_rating: 4,
  auto_publish_verified_only: true,
  profanity_filter: true,
  reviews_per_page: 10,
  default_sort: 'newest',
  show_verified_badge: true,
  show_incentivized_disclosure: false,
  incentivized_disclosure_text:
    'This reviewer received a discount for leaving this review.',
  sender_name: '',
  sender_email: '',
};

export default function ReviewSettingsPage() {
  const { brandSlug } = useBrand();
  const [settings, setSettings] = useState<ReviewSettings>(DEFAULTS);
  const [original, setOriginal] = useState<ReviewSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/reviews/settings')
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
    try {
      const res = await fetch('/api/reviews/settings', {
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
    } catch {
      // ignore
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  function toggleSection(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

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
      <div className="flex items-center justify-between py-2">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <button
          onClick={() => onChange(!value)}
          className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0"
          style={{
            backgroundColor: value ? 'var(--color-accent)' : 'var(--border-primary)',
          }}
        >
          <div
            className="w-4 h-4 bg-white rounded-full absolute top-1 transition-transform"
            style={{ left: value ? '20px' : '4px' }}
          />
        </button>
      </div>
    );
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
              Review Settings
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Configure review collection, moderation, and display settings
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
        {/* Collection Settings */}
        <SectionCard title="Collection Settings" sectionKey="collection">
          <div className="space-y-1">
            <ToggleSwitch
              label="Send review request emails"
              value={settings.request_enabled}
              onChange={(v) => setSettings({ ...settings, request_enabled: v })}
            />
            {settings.request_enabled && (
              <div className="flex items-center gap-2 pl-4 pb-2">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Send after
                </span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={settings.request_delay_days}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      request_delay_days: parseInt(e.target.value) || 14,
                    })
                  }
                  className="w-16 text-sm rounded-lg px-2 py-1 focus:outline-none focus:ring-2"
                  style={inputStyle}
                />
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  days
                </span>
              </div>
            )}
            <ToggleSwitch
              label="Send reminder emails"
              value={settings.reminder_enabled}
              onChange={(v) => setSettings({ ...settings, reminder_enabled: v })}
            />
            {settings.reminder_enabled && (
              <div className="flex items-center gap-2 pl-4 pb-2">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Send after
                </span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={settings.reminder_delay_days}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      reminder_delay_days: parseInt(e.target.value) || 7,
                    })
                  }
                  className="w-16 text-sm rounded-lg px-2 py-1 focus:outline-none focus:ring-2"
                  style={inputStyle}
                />
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  days after first request
                </span>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Moderation Rules */}
        <SectionCard title="Moderation Rules" sectionKey="moderation">
          <div className="space-y-1">
            <ToggleSwitch
              label="Auto-publish reviews"
              value={settings.auto_publish}
              onChange={(v) => setSettings({ ...settings, auto_publish: v })}
            />
            {settings.auto_publish && (
              <div className="space-y-2 pl-4 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    Minimum rating
                  </span>
                  <select
                    value={settings.auto_publish_min_rating}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        auto_publish_min_rating: parseInt(e.target.value),
                      })
                    }
                    className="text-sm rounded-lg px-2 py-1 focus:outline-none focus:ring-2"
                    style={inputStyle}
                  >
                    {[1, 2, 3, 4, 5].map((r) => (
                      <option key={r} value={r}>
                        {r} star{r > 1 ? 's' : ''} and above
                      </option>
                    ))}
                  </select>
                </div>
                <ToggleSwitch
                  label="Only auto-publish verified purchases"
                  value={settings.auto_publish_verified_only}
                  onChange={(v) =>
                    setSettings({ ...settings, auto_publish_verified_only: v })
                  }
                />
              </div>
            )}
            <ToggleSwitch
              label="Profanity filter"
              value={settings.profanity_filter}
              onChange={(v) => setSettings({ ...settings, profanity_filter: v })}
            />
          </div>
        </SectionCard>

        {/* Display Options */}
        <SectionCard title="Display Options" sectionKey="display">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Reviews per page
              </label>
              <input
                type="number"
                min={5}
                max={50}
                value={settings.reviews_per_page}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    reviews_per_page: parseInt(e.target.value) || 10,
                  })
                }
                className="w-20 text-sm rounded-lg px-2 py-1 focus:outline-none focus:ring-2"
                style={inputStyle}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Default sort
              </label>
              <select
                value={settings.default_sort}
                onChange={(e) => setSettings({ ...settings, default_sort: e.target.value })}
                className="text-sm rounded-lg px-2 py-1 focus:outline-none focus:ring-2"
                style={inputStyle}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="highest">Highest rated</option>
                <option value="lowest">Lowest rated</option>
                <option value="helpful">Most helpful</option>
              </select>
            </div>
            <ToggleSwitch
              label="Show verified purchase badge"
              value={settings.show_verified_badge}
              onChange={(v) => setSettings({ ...settings, show_verified_badge: v })}
            />
            <ToggleSwitch
              label="Show incentivized review disclosure"
              value={settings.show_incentivized_disclosure}
              onChange={(v) =>
                setSettings({ ...settings, show_incentivized_disclosure: v })
              }
            />
          </div>
        </SectionCard>

        {/* FTC Compliance */}
        <SectionCard title="FTC Compliance" sectionKey="ftc">
          <div>
            <label
              className="text-xs font-medium mb-1.5 block"
              style={{ color: 'var(--text-secondary)' }}
            >
              Incentivized disclosure text
            </label>
            <textarea
              value={settings.incentivized_disclosure_text}
              onChange={(e) =>
                setSettings({ ...settings, incentivized_disclosure_text: e.target.value })
              }
              rows={3}
              className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 resize-y"
              style={inputStyle}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
              This text appears on reviews where the customer received a discount or incentive
            </p>
          </div>
        </SectionCard>

        {/* Email Sender */}
        <SectionCard title="Email Sender" sectionKey="sender">
          <div className="space-y-3">
            <div>
              <label
                className="text-xs font-medium mb-1 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Sender name
              </label>
              <input
                type="text"
                value={settings.sender_name}
                onChange={(e) => setSettings({ ...settings, sender_name: e.target.value })}
                placeholder="e.g. Outlight Reviews"
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={inputStyle}
              />
            </div>
            <div>
              <label
                className="text-xs font-medium mb-1 block"
                style={{ color: 'var(--text-secondary)' }}
              >
                Sender email
              </label>
              <input
                type="email"
                value={settings.sender_email}
                onChange={(e) => setSettings({ ...settings, sender_email: e.target.value })}
                placeholder="e.g. reviews@outlight.com"
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={inputStyle}
              />
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
