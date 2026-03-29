'use client';

import { useState } from 'react';
import { Play, Sparkles, Send, FlaskConical, Smartphone } from 'lucide-react';

// ── Constants ───────────────────────────────────────────────────────────────

const ACCENT = '#10b981';

const TABS = [
  { key: 'reveal', label: 'The Reveal' },
  { key: 'style-profile', label: 'The Style Profile' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

// ── Component ───────────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('reveal');
  const [profileKey, setProfileKey] = useState('');
  const [apiResult, setApiResult] = useState<string | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  const base = process.env.NEXT_PUBLIC_BACKEND_URL || '';

  async function testCreateSession() {
    setApiLoading(true);
    setApiResult(null);
    try {
      const sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch(`${base}/api/quiz/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          concept: activeTab,
          device: 'desktop',
          referrer: 'playground',
          utm_source: 'admin-test',
        }),
      });
      const data = await res.json();
      setApiResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setApiResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    setApiLoading(false);
  }

  async function testTrackEvent() {
    setApiLoading(true);
    setApiResult(null);
    try {
      const res = await fetch(`${base}/api/quiz/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: `test-${Date.now()}`,
          event_type: 'step_completed',
          step_name: 'playground-test',
          data: { source: 'admin-playground', timestamp: new Date().toISOString() },
        }),
      });
      const data = await res.json();
      setApiResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setApiResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    setApiLoading(false);
  }

  async function testRecommendations() {
    setApiLoading(true);
    setApiResult(null);
    try {
      const key = profileKey.trim() || 'bold-minimalist';
      const res = await fetch(`${base}/api/quiz/recommendations/${encodeURIComponent(key)}`);
      const data = await res.json();
      setApiResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setApiResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    setApiLoading(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <FlaskConical size={20} style={{ color: ACCENT }} />
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Playground
        </h2>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-secondary)', borderRadius: '10px', padding: '4px', width: 'fit-content' }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 20px',
              fontSize: '13px',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#fff' : 'var(--text-secondary)',
              backgroundColor: activeTab === tab.key ? ACCENT : 'transparent',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 200ms ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Phone Frame + iframe ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '420px',
            height: '680px',
            border: '3px solid var(--border-primary)',
            borderRadius: '32px',
            overflow: 'hidden',
            backgroundColor: 'var(--bg-primary)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            position: 'relative',
          }}
        >
          {/* Phone notch */}
          <div
            style={{
              position: 'absolute',
              top: '0',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '120px',
              height: '24px',
              backgroundColor: 'var(--border-primary)',
              borderRadius: '0 0 16px 16px',
              zIndex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Smartphone size={12} style={{ color: 'var(--text-tertiary)' }} />
          </div>

          <iframe
            src={`${base}/quiz/${activeTab === 'reveal' ? 'reveal' : 'style-profile'}`}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
            }}
            title={`Quiz Preview: ${activeTab}`}
          />
        </div>
      </div>

      {/* ── API Testing Section ── */}
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
          <Sparkles size={16} style={{ color: ACCENT }} />
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            API Testing
          </h3>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Test buttons row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
            {/* Create Session */}
            <button
              onClick={testCreateSession}
              disabled={apiLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 500,
                color: '#fff',
                backgroundColor: apiLoading ? '#9ca3af' : ACCENT,
                border: 'none',
                borderRadius: '8px',
                cursor: apiLoading ? 'not-allowed' : 'pointer',
              }}
            >
              <Play size={14} />
              Create Session
            </button>

            {/* Track Event */}
            <button
              onClick={testTrackEvent}
              disabled={apiLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 500,
                color: '#fff',
                backgroundColor: apiLoading ? '#9ca3af' : '#8b5cf6',
                border: 'none',
                borderRadius: '8px',
                cursor: apiLoading ? 'not-allowed' : 'pointer',
              }}
            >
              <Send size={14} />
              Track Event
            </button>

            {/* Recommendations */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                value={profileKey}
                onChange={(e) => setProfileKey(e.target.value)}
                placeholder="Profile key..."
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-primary)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  width: '180px',
                }}
              />
              <button
                onClick={testRecommendations}
                disabled={apiLoading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#fff',
                  backgroundColor: apiLoading ? '#9ca3af' : '#f59e0b',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: apiLoading ? 'not-allowed' : 'pointer',
                }}
              >
                <Sparkles size={14} />
                Get Recommendations
              </button>
            </div>
          </div>

          {/* API Response */}
          {apiResult !== null && (
            <pre
              style={{
                fontSize: '12px',
                fontFamily: 'var(--font-mono, monospace)',
                color: 'var(--text-secondary)',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                padding: '16px',
                borderRadius: '8px',
                overflow: 'auto',
                maxHeight: '300px',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {apiResult}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
