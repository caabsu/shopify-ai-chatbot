'use client';

import { useState, useEffect } from 'react';
import { Settings, Save, Check, GitBranch, Mail, Camera, Cpu } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface QuizConfig {
  active_concepts: string;          // comma-separated: "reveal,style-profile"
  ab_split: string;                 // e.g. "50" (percent for reveal, rest for style-profile)
  email_capture_enabled: string;    // "true" | "false"
  photo_upload_enabled: string;     // "true" | "false"
  gemini_review_model: string;
  gemini_image_model: string;
  [key: string]: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const ACCENT = '#10b981';

const DEFAULT_CONFIG: QuizConfig = {
  active_concepts: 'reveal,style-profile',
  ab_split: '50',
  email_capture_enabled: 'true',
  photo_upload_enabled: 'true',
  gemini_review_model: 'gemini-2.0-flash',
  gemini_image_model: 'gemini-2.0-flash',
};

// ── Component ───────────────────────────────────────────────────────────────

export default function QuizSettingsPage() {
  const [config, setConfig] = useState<QuizConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = process.env.NEXT_PUBLIC_BACKEND_URL || '';

  useEffect(() => {
    fetch(`${base}/api/quiz/config`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load config (${r.status})`);
        return r.json();
      })
      .then((data) => {
        setConfig({ ...DEFAULT_CONFIG, ...data });
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load config');
        setLoading(false);
      });
  }, [base]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`${base}/api/quiz/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`Failed to save config (${res.status})`);

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    }
    setSaving(false);
  }

  // ── Helpers for concept checkboxes ──

  const activeConcepts = config.active_concepts
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  function toggleConcept(concept: string) {
    const current = new Set(activeConcepts);
    if (current.has(concept)) {
      current.delete(concept);
    } else {
      current.add(concept);
    }
    setConfig({ ...config, active_concepts: Array.from(current).join(',') });
  }

  const abSplit = parseInt(config.ab_split) || 50;

  function setAbSplit(value: number) {
    setConfig({ ...config, ab_split: String(Math.max(0, Math.min(100, value))) });
  }

  function toggleBool(key: 'email_capture_enabled' | 'photo_upload_enabled') {
    setConfig({ ...config, [key]: config[key] === 'true' ? 'false' : 'true' });
  }

  // ── Render ──

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Settings size={20} style={{ color: ACCENT }} />
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Settings
          </h2>
        </div>
        <div
          style={{
            height: '400px',
            borderRadius: '12px',
            backgroundColor: 'var(--bg-tertiary)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Settings size={20} style={{ color: ACCENT }} />
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Settings
          </h2>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 20px',
            fontSize: '13px',
            fontWeight: 500,
            color: '#fff',
            backgroundColor: saved ? '#22c55e' : saving ? '#9ca3af' : ACCENT,
            border: 'none',
            borderRadius: '8px',
            cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'background-color 200ms ease',
          }}
        >
          {saved ? (
            <><Check size={14} /> Saved</>
          ) : saving ? (
            'Saving...'
          ) : (
            <><Save size={14} /> Save Changes</>
          )}
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            backgroundColor: 'rgba(239,68,68,0.08)',
            color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          {error}
        </div>
      )}

      {/* ── Section: A/B Testing ── */}
      <div
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <GitBranch size={16} style={{ color: ACCENT }} />
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            A/B Testing
          </h3>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Active Concepts */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
              Active Concepts
            </label>
            <div style={{ display: 'flex', gap: '16px' }}>
              {[
                { key: 'reveal', label: 'The Reveal' },
                { key: 'style-profile', label: 'The Style Profile' },
              ].map((concept) => {
                const isActive = activeConcepts.includes(concept.key);
                return (
                  <label
                    key={concept.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 16px',
                      borderRadius: '8px',
                      border: `1px solid ${isActive ? ACCENT : 'var(--border-primary)'}`,
                      backgroundColor: isActive ? `${ACCENT}0d` : 'transparent',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 500,
                      color: isActive ? ACCENT : 'var(--text-secondary)',
                      transition: 'all 200ms ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => toggleConcept(concept.key)}
                      style={{ accentColor: ACCENT }}
                    />
                    {concept.label}
                  </label>
                );
              })}
            </div>
          </div>

          {/* A/B Split */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
              A/B Split (Reveal / Style Profile)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <input
                type="range"
                min={0}
                max={100}
                value={abSplit}
                onChange={(e) => setAbSplit(parseInt(e.target.value))}
                style={{
                  flex: 1,
                  accentColor: ACCENT,
                  height: '6px',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(245,158,11,0.1)',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#f59e0b',
                    minWidth: '70px',
                    justifyContent: 'center',
                  }}
                >
                  {abSplit}% Reveal
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(139,92,246,0.1)',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#8b5cf6',
                    minWidth: '70px',
                    justifyContent: 'center',
                  }}
                >
                  {100 - abSplit}% Style
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section: Features ── */}
      <div
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Mail size={16} style={{ color: ACCENT }} />
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Features
          </h3>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Email Capture Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                <Mail size={14} style={{ color: 'var(--text-tertiary)' }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Email Capture
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: 0 }}>
                Ask for email before showing results
              </p>
            </div>
            <button
              onClick={() => toggleBool('email_capture_enabled')}
              style={{
                width: '44px',
                height: '24px',
                borderRadius: '12px',
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                backgroundColor: config.email_capture_enabled === 'true' ? ACCENT : 'var(--border-primary)',
                transition: 'background-color 200ms ease',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: config.email_capture_enabled === 'true' ? '22px' : '2px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: '#fff',
                  transition: 'left 200ms ease',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </button>
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--border-primary)' }} />

          {/* Photo Upload Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                <Camera size={14} style={{ color: 'var(--text-tertiary)' }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Photo Upload
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: 0 }}>
                Allow users to upload outfit photos for AI analysis
              </p>
            </div>
            <button
              onClick={() => toggleBool('photo_upload_enabled')}
              style={{
                width: '44px',
                height: '24px',
                borderRadius: '12px',
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                backgroundColor: config.photo_upload_enabled === 'true' ? ACCENT : 'var(--border-primary)',
                transition: 'background-color 200ms ease',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: config.photo_upload_enabled === 'true' ? '22px' : '2px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: '#fff',
                  transition: 'left 200ms ease',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </button>
          </div>
        </div>
      </div>

      {/* ── Section: AI Models ── */}
      <div
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Cpu size={16} style={{ color: ACCENT }} />
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            AI Models
          </h3>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Gemini Review Model */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Gemini Review Model
            </label>
            <input
              value={config.gemini_review_model}
              onChange={(e) => setConfig({ ...config, gemini_review_model: e.target.value })}
              placeholder="gemini-2.0-flash"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                fontFamily: 'var(--font-mono, monospace)',
                borderRadius: '8px',
                border: '1px solid var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px', margin: '4px 0 0' }}>
              Used for style analysis and written reviews
            </p>
          </div>

          {/* Gemini Image Model */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Gemini Image Model
            </label>
            <input
              value={config.gemini_image_model}
              onChange={(e) => setConfig({ ...config, gemini_image_model: e.target.value })}
              placeholder="gemini-2.0-flash"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                fontFamily: 'var(--font-mono, monospace)',
                borderRadius: '8px',
                border: '1px solid var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px', margin: '4px 0 0' }}>
              Used for photo analysis and image-based recommendations
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
