'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Check, RotateCcw } from 'lucide-react';

interface DesignSettings {
  primaryColor: string;
  backgroundColor: string;
  headerTitle: string;
  position: 'bottom-right' | 'bottom-left';
}

const DEFAULTS: DesignSettings = {
  primaryColor: '#6B4A37',
  backgroundColor: '#ffffff',
  headerTitle: 'Outlight Assistant',
  position: 'bottom-right',
};

const COLOR_PRESETS = [
  { label: 'Brown', value: '#6B4A37' },
  { label: 'Black', value: '#1a1a1a' },
  { label: 'Navy', value: '#1e3a5f' },
  { label: 'Forest', value: '#2d5a3d' },
  { label: 'Plum', value: '#5b3256' },
  { label: 'Slate', value: '#475569' },
];

export default function DesignPage() {
  const [settings, setSettings] = useState<DesignSettings>(DEFAULTS);
  const [original, setOriginal] = useState<DesignSettings>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

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
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  const handleReset = useCallback(() => {
    setSettings(DEFAULTS);
  }, []);

  function darkenColor(hex: string, amount: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (num >> 16) - amount);
    const g = Math.max(0, ((num >> 8) & 0x00ff) - amount);
    const b = Math.max(0, (num & 0x0000ff) - amount);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  if (loading) return <div className="animate-pulse"><div className="h-96 bg-gray-200 rounded-xl" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Widget Design</h2>
          <p className="text-xs text-gray-400 mt-0.5">Customize how the chat widget looks on your store</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RotateCcw size={14} /> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving...' : <><Save size={14} /> Save Changes</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Settings */}
        <div className="space-y-5">
          {/* Primary Color */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-medium">Primary Color</h3>
              <p className="text-xs text-gray-400 mt-0.5">Used for the header, chat bubble, buttons, and user messages</p>
            </div>
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
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setSettings({ ...settings, primaryColor: v });
                }}
                className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setSettings({ ...settings, primaryColor: preset.value })}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    settings.primaryColor === preset.value
                      ? 'border-black bg-gray-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-full border border-gray-200"
                    style={{ background: preset.value }}
                  />
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Background Color */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-medium">Background Color</h3>
              <p className="text-xs text-gray-400 mt-0.5">Chat window background behind messages</p>
            </div>
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
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setSettings({ ...settings, backgroundColor: v });
                }}
                className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
              />
              <button
                onClick={() => setSettings({ ...settings, backgroundColor: '#ffffff' })}
                className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50"
              >
                White
              </button>
              <button
                onClick={() => setSettings({ ...settings, backgroundColor: '#f9fafb' })}
                className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50"
              >
                Light Gray
              </button>
            </div>
          </div>

          {/* Header Title */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-medium">Header Title</h3>
              <p className="text-xs text-gray-400 mt-0.5">Name shown at the top of the chat window</p>
            </div>
            <input
              type="text"
              value={settings.headerTitle}
              onChange={(e) => setSettings({ ...settings, headerTitle: e.target.value })}
              placeholder="e.g. Support Assistant"
              className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          {/* Widget Position */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-medium">Widget Position</h3>
              <p className="text-xs text-gray-400 mt-0.5">Where the chat bubble appears on the page</p>
            </div>
            <div className="flex gap-3">
              {(['bottom-right', 'bottom-left'] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => setSettings({ ...settings, position: pos })}
                  className={`flex-1 max-w-[180px] relative rounded-lg border-2 p-4 transition-colors ${
                    settings.position === pos
                      ? 'border-black bg-gray-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="w-full h-16 bg-gray-100 rounded relative">
                    <div
                      className="absolute bottom-1 w-4 h-4 rounded-full"
                      style={{
                        background: settings.primaryColor,
                        ...(pos === 'bottom-right' ? { right: 4 } : { left: 4 }),
                      }}
                    />
                  </div>
                  <p className="text-xs font-medium text-center mt-2 capitalize">{pos.replace('-', ' ')}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live Preview */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Preview</h3>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden sticky top-20">
            {/* Mini widget preview */}
            <div className="p-4" style={{ background: '#f5f5f5' }}>
              <div className="w-full rounded-lg overflow-hidden shadow-lg" style={{ background: settings.backgroundColor }}>
                {/* Header */}
                <div
                  className="flex items-center gap-2 px-4 py-3"
                  style={{ background: `linear-gradient(180deg, ${settings.primaryColor} 0%, ${darkenColor(settings.primaryColor, 15)} 100%)` }}
                >
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-white text-xs font-semibold">{settings.headerTitle || 'Assistant'}</span>
                </div>
                {/* Messages */}
                <div className="p-3 space-y-2" style={{ background: settings.backgroundColor, minHeight: 120 }}>
                  <div className="flex gap-2">
                    <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: settings.primaryColor }} />
                    <div className="bg-white border border-gray-100 rounded-xl rounded-bl-sm px-3 py-2 text-[11px] text-gray-700 max-w-[85%]">
                      Hi there! How can I help you today?
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div
                      className="rounded-xl rounded-br-sm px-3 py-2 text-[11px] text-white max-w-[85%]"
                      style={{ background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${darkenColor(settings.primaryColor, 15)} 100%)` }}
                    >
                      I need help with my order
                    </div>
                  </div>
                </div>
                {/* Input */}
                <div className="px-3 pb-3 flex gap-2" style={{ background: settings.backgroundColor }}>
                  <div className="flex-1 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-[10px] text-gray-400">
                    Type a message...
                  </div>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: settings.primaryColor }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </div>
                </div>
              </div>
            </div>

            {/* FAB preview */}
            <div className="px-4 py-3 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 mb-2">Chat Bubble</p>
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shadow-md"
                  style={{ background: `linear-gradient(145deg, ${settings.primaryColor} 0%, ${darkenColor(settings.primaryColor, 15)} 100%)` }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </div>
                <span className="text-xs text-gray-500">
                  {settings.position === 'bottom-right' ? 'Bottom right' : 'Bottom left'} of page
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
