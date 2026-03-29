'use client';

import { useState, useRef, useCallback } from 'react';
import {
  FlaskConical,
  Smartphone,
  Monitor,
  Columns2,
  RotateCcw,
  Maximize2,
  Minimize2,
  ExternalLink,
} from 'lucide-react';

// ── Constants ───────────────────────────────────────────────────────────────

const ACCENT = '#10b981';
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || '';

const CONCEPTS = [
  { key: 'reveal', label: 'The Reveal', path: '/quiz/reveal', steps: 3, desc: 'Upload → Mood → Products' },
  { key: 'style-profile', label: 'The Style Profile', path: '/quiz/style-profile', steps: 5, desc: 'Audience → Track → Vibe → Intensity → Profile' },
] as const;

type ConceptKey = (typeof CONCEPTS)[number]['key'];
type ViewMode = 'mobile' | 'desktop' | 'split';

// ── Device frames ───────────────────────────────────────────────────────────

const DEVICE_SIZES: Record<string, { width: number; height: number; radius: number; bezel: number }> = {
  mobile: { width: 390, height: 844, radius: 44, bezel: 3 },
  desktop: { width: 1280, height: 800, radius: 12, bezel: 2 },
};

// ── Component ───────────────────────────────────────────────────────────────

export default function FunnelPlaygroundPage() {
  const [activeConcept, setActiveConcept] = useState<ConceptKey>('reveal');
  const [viewMode, setViewMode] = useState<ViewMode>('mobile');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeKeys, setIframeKeys] = useState({ reveal: 0, 'style-profile': 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const resetQuiz = useCallback((concept: ConceptKey) => {
    setIframeKeys((prev) => ({ ...prev, [concept]: prev[concept] + 1 }));
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  const conceptInfo = CONCEPTS.find((c) => c.key === activeConcept)!;

  function renderDeviceFrame(concept: typeof CONCEPTS[number], device: 'mobile' | 'desktop', maxWidth?: number) {
    const dim = DEVICE_SIZES[device];
    const key = iframeKeys[concept.key];
    const scale = device === 'desktop' && maxWidth ? Math.min(1, maxWidth / dim.width) : 1;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        {/* Device label (only in split mode) */}
        {viewMode === 'split' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: '0.02em',
              }}
            >
              {concept.label}
            </span>
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary)',
                padding: '2px 8px',
                backgroundColor: 'var(--bg-tertiary)',
                borderRadius: '4px',
              }}
            >
              {concept.steps} steps
            </span>
            <button
              onClick={() => resetQuiz(concept.key)}
              title="Reset quiz"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                color: 'var(--text-tertiary)',
                transition: 'all 150ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
            >
              <RotateCcw size={13} />
            </button>
          </div>
        )}

        {/* Frame */}
        <div
          style={{
            width: `${dim.width * scale}px`,
            height: `${dim.height * scale}px`,
            borderRadius: `${dim.radius * scale}px`,
            border: `${dim.bezel}px solid ${device === 'mobile' ? '#1a1a1a' : '#2a2a2a'}`,
            overflow: 'hidden',
            position: 'relative',
            backgroundColor: '#FAF8F5',
            flexShrink: 0,
            boxShadow: device === 'mobile'
              ? '0 20px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04), inset 0 0 0 1px rgba(255,255,255,0.06)'
              : '0 12px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
          }}
        >
          {/* Mobile notch */}
          {device === 'mobile' && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: `${126 * scale}px`,
                height: `${34 * scale}px`,
                backgroundColor: '#1a1a1a',
                borderRadius: `0 0 ${20 * scale}px ${20 * scale}px`,
                zIndex: 10,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: `${10 * scale}px`,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: `${10 * scale}px`,
                  height: `${10 * scale}px`,
                  borderRadius: '50%',
                  backgroundColor: '#0a0a0a',
                  border: `1px solid #222`,
                }}
              />
            </div>
          )}

          {/* Desktop toolbar */}
          {device === 'desktop' && (
            <div
              style={{
                height: `${36 * scale}px`,
                backgroundColor: '#f0f0f0',
                borderBottom: '1px solid #ddd',
                display: 'flex',
                alignItems: 'center',
                padding: `0 ${12 * scale}px`,
                gap: `${6 * scale}px`,
              }}
            >
              <div style={{ width: `${10 * scale}px`, height: `${10 * scale}px`, borderRadius: '50%', backgroundColor: '#ff5f57' }} />
              <div style={{ width: `${10 * scale}px`, height: `${10 * scale}px`, borderRadius: '50%', backgroundColor: '#ffbd2e' }} />
              <div style={{ width: `${10 * scale}px`, height: `${10 * scale}px`, borderRadius: '50%', backgroundColor: '#28c840' }} />
              <div
                style={{
                  flex: 1,
                  height: `${22 * scale}px`,
                  backgroundColor: '#fff',
                  borderRadius: `${6 * scale}px`,
                  border: '1px solid #ddd',
                  marginLeft: `${8 * scale}px`,
                  display: 'flex',
                  alignItems: 'center',
                  padding: `0 ${10 * scale}px`,
                }}
              >
                <span style={{ fontSize: `${11 * scale}px`, color: '#999', fontFamily: 'system-ui' }}>
                  outlight.us/pages/quiz-{concept.key}
                </span>
              </div>
            </div>
          )}

          <iframe
            key={key}
            src={`${BACKEND}${concept.path}`}
            style={{
              width: device === 'desktop' ? '100%' : `${dim.width}px`,
              height: device === 'desktop' ? `${dim.height * scale - 36 * scale}px` : `${dim.height}px`,
              border: 'none',
              display: 'block',
              transform: device === 'mobile' && scale !== 1 ? `scale(${scale})` : undefined,
              transformOrigin: 'top left',
            }}
            title={`${concept.label} Preview`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        ...(isFullscreen ? { backgroundColor: 'var(--bg-secondary)', padding: '20px' } : {}),
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <FlaskConical size={20} style={{ color: ACCENT }} />
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Playground
          </h2>
          <span style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginLeft: '4px' }}>
            Test quiz funnels as your customers see them
          </span>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '10px',
        }}
      >
        {/* Left: concept selector (non-split only) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {viewMode !== 'split' && (
            <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', padding: '3px' }}>
              {CONCEPTS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setActiveConcept(c.key)}
                  style={{
                    padding: '6px 16px',
                    fontSize: '12px',
                    fontWeight: activeConcept === c.key ? 600 : 400,
                    color: activeConcept === c.key ? '#fff' : 'var(--text-secondary)',
                    backgroundColor: activeConcept === c.key ? ACCENT : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 150ms',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {viewMode !== 'split' && (
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
              {conceptInfo.desc}
            </span>
          )}
        </div>

        {/* Right: view controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* View mode buttons */}
          {[
            { mode: 'mobile' as ViewMode, icon: Smartphone, label: 'Mobile' },
            { mode: 'desktop' as ViewMode, icon: Monitor, label: 'Desktop' },
            { mode: 'split' as ViewMode, icon: Columns2, label: 'Split' },
          ].map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              title={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: viewMode === mode ? 600 : 400,
                color: viewMode === mode ? ACCENT : 'var(--text-tertiary)',
                backgroundColor: viewMode === mode ? `${ACCENT}14` : 'transparent',
                border: `1px solid ${viewMode === mode ? `${ACCENT}40` : 'transparent'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 150ms',
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}

          <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-primary)', margin: '0 4px' }} />

          {/* Reset */}
          {viewMode !== 'split' && (
            <button
              onClick={() => resetQuiz(activeConcept)}
              title="Reset quiz"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 10px',
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 150ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
            >
              <RotateCcw size={13} />
              Reset
            </button>
          )}

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              fontSize: '12px',
              color: 'var(--text-tertiary)',
              backgroundColor: 'transparent',
              border: '1px solid var(--border-primary)',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 150ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {isFullscreen ? 'Exit' : 'Fullscreen'}
          </button>

          {/* Open in new tab */}
          {viewMode !== 'split' && (
            <a
              href={`${BACKEND}${conceptInfo.path}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in new tab"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 10px',
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                backgroundColor: 'transparent',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                cursor: 'pointer',
                textDecoration: 'none',
                transition: 'all 150ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
            >
              <ExternalLink size={13} />
              Open
            </a>
          )}
        </div>
      </div>

      {/* ── Device Preview Area ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          gap: '32px',
          padding: '24px 0',
          minHeight: viewMode === 'mobile' ? '900px' : viewMode === 'desktop' ? '860px' : '900px',
          overflow: 'auto',
        }}
      >
        {viewMode === 'split' ? (
          <>
            {CONCEPTS.map((c) => (
              <div key={c.key}>
                {renderDeviceFrame(c, 'mobile')}
              </div>
            ))}
          </>
        ) : viewMode === 'mobile' ? (
          renderDeviceFrame(conceptInfo, 'mobile')
        ) : (
          renderDeviceFrame(conceptInfo, 'desktop', 1200)
        )}
      </div>
    </div>
  );
}
