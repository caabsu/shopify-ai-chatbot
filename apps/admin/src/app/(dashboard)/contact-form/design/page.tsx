'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Check, RotateCcw } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface ContactFormDesign {
  // Colors
  primaryColor: string;
  backgroundColor: string;
  inputBackground: string;
  borderColor: string;
  textColor: string;
  labelColor: string;
  placeholderColor: string;
  accentColor: string;
  // Typography
  headingFontFamily: string;
  bodyFontFamily: string;
  headingFontSize: string;
  labelFontSize: string;
  inputFontSize: string;
  // Border radius
  cardBorderRadius: string;
  inputBorderRadius: string;
  buttonBorderRadius: string;
  // Labels & Text
  headerTitle: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  messageLabel: string;
  messagePlaceholder: string;
  buttonText: string;
  buttonShowArrow: boolean;
  successMessage: string;
  // Layout
  showSubjectField: boolean;
  cardPadding: string;
}

const DEFAULTS: ContactFormDesign = {
  primaryColor: '#3C2415',
  backgroundColor: '#FDFAF6',
  inputBackground: '#FAF7F2',
  borderColor: '#E8E0D5',
  textColor: '#2C1810',
  labelColor: '#2C1810',
  placeholderColor: '#B5A898',
  accentColor: '#C5A059',
  headingFontFamily: 'Georgia, serif',
  bodyFontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  headingFontSize: '22px',
  labelFontSize: '14px',
  inputFontSize: '15px',
  cardBorderRadius: '16px',
  inputBorderRadius: '12px',
  buttonBorderRadius: '12px',
  headerTitle: 'Send a Message',
  nameLabel: 'Name',
  namePlaceholder: 'Your full name',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  subjectLabel: 'Subject',
  subjectPlaceholder: 'e.g., Subscription help',
  messageLabel: 'Message',
  messagePlaceholder: 'Describe your question or concern...',
  buttonText: 'Send Message',
  buttonShowArrow: true,
  successMessage: "Message sent! We'll get back to you soon.",
  showSubjectField: true,
  cardPadding: '36px 32px',
};

const PRIMARY_PRESETS = [
  { label: 'Chocolate', value: '#3C2415' },
  { label: 'Black', value: '#18181b' },
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Forest', value: '#2d5a3d' },
  { label: 'Slate', value: '#475569' },
];

export default function ContactFormDesignPage() {
  const [settings, setSettings] = useState<ContactFormDesign>(DEFAULTS);
  const [original, setOriginal] = useState<ContactFormDesign>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { brandSlug } = useBrand();

  useEffect(() => {
    fetch('/api/contact-form/design')
      .then((r) => r.json())
      .then((data) => {
        if (data.widget_design) {
          const merged = { ...DEFAULTS, ...data.widget_design };
          setSettings(merged);
          setOriginal(merged);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(original);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/contact-form/design', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widget_design: settings }),
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
    field: keyof ContactFormDesign;
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

  function TextRow({ label, field }: { label: string; field: keyof ContactFormDesign }) {
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

  function CheckboxRow({ label, field }: { label: string; field: keyof ContactFormDesign }) {
    return (
      <label className="flex items-center gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={settings[field] as boolean}
          onChange={(e) => setSettings({ ...settings, [field]: e.target.checked })}
          className="w-4 h-4 rounded border-gray-300 accent-current"
          style={{ accentColor: 'var(--color-accent)' }}
        />
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          {label}
        </span>
      </label>
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
            Contact Form Design
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Customize the contact form appearance and labels
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

      <div className="space-y-5">
        {/* Colors */}
        <SectionCard title="Colors">
          <div className="space-y-5">
            <ColorRow label="Primary Color" field="primaryColor" presets={PRIMARY_PRESETS} />
            <div className="grid grid-cols-2 gap-4">
              <ColorRow label="Background Color" field="backgroundColor" />
              <ColorRow label="Input Background" field="inputBackground" />
              <ColorRow label="Border Color" field="borderColor" />
              <ColorRow label="Text Color" field="textColor" />
              <ColorRow label="Label Color" field="labelColor" />
              <ColorRow label="Placeholder Color" field="placeholderColor" />
              <ColorRow label="Accent Color" field="accentColor" />
            </div>
          </div>
        </SectionCard>

        {/* Typography */}
        <SectionCard title="Typography">
          <div className="space-y-3">
            <TextRow label="Heading Font Family" field="headingFontFamily" />
            <TextRow label="Body Font Family" field="bodyFontFamily" />
            <TextRow label="Heading Font Size" field="headingFontSize" />
            <TextRow label="Label Font Size" field="labelFontSize" />
            <TextRow label="Input Font Size" field="inputFontSize" />
          </div>
        </SectionCard>

        {/* Border Radius */}
        <SectionCard title="Border Radius">
          <div className="space-y-3">
            <TextRow label="Card Border Radius" field="cardBorderRadius" />
            <TextRow label="Input Border Radius" field="inputBorderRadius" />
            <TextRow label="Button Border Radius" field="buttonBorderRadius" />
          </div>
        </SectionCard>

        {/* Labels & Text */}
        <SectionCard title="Labels & Text">
          <div className="space-y-3">
            <TextRow label="Header Title" field="headerTitle" />
            <TextRow label="Name Label" field="nameLabel" />
            <TextRow label="Name Placeholder" field="namePlaceholder" />
            <TextRow label="Email Label" field="emailLabel" />
            <TextRow label="Email Placeholder" field="emailPlaceholder" />
            <TextRow label="Subject Label" field="subjectLabel" />
            <TextRow label="Subject Placeholder" field="subjectPlaceholder" />
            <TextRow label="Message Label" field="messageLabel" />
            <TextRow label="Message Placeholder" field="messagePlaceholder" />
            <TextRow label="Button Text" field="buttonText" />
            <TextRow label="Success Message" field="successMessage" />
          </div>
        </SectionCard>

        {/* Layout */}
        <SectionCard title="Layout">
          <div className="space-y-4">
            <CheckboxRow label="Show Subject Field" field="showSubjectField" />
            <CheckboxRow label="Show Arrow on Button" field="buttonShowArrow" />
            <TextRow label="Card Padding" field="cardPadding" />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
