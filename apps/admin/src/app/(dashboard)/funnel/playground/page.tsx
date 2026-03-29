'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  FlaskConical,
  Play,
  RotateCcw,
  Upload,
  Image as ImageIcon,
  Clock,
  Cpu,
  FileText,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Thermometer,
  Eye,
  Palette,
  Zap,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
} from 'lucide-react';

// ── Constants ───────────────────────────────────────────────────────────────

const ACCENT = '#10b981';
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || '';

const REVEAL_MOODS = [
  { key: 'Cozy & Warm', color: '#d4a853' },
  { key: 'Bright & Open', color: '#7cb9e8' },
  { key: 'Moody & Dramatic', color: '#4a3520' },
  { key: 'Soft & Editorial', color: '#b8a090' },
];

const STYLE_PROFILE_VIBES = {
  soft: [
    { key: 'Rustic Warm', color: '#c8a060' },
    { key: 'Bohemian Layered', color: '#d4956a' },
    { key: 'Modern Cozy', color: '#8cb4c0' },
    { key: 'Japandi Warm', color: '#c4b8a0' },
  ],
  dramatic: [
    { key: 'Art Deco Warm', color: '#c8a040' },
    { key: 'Dark Luxe', color: '#2a1f18' },
    { key: 'Warm Industrial', color: '#8a7060' },
    { key: 'Moody Maximalist', color: '#6a3040' },
  ],
};

const INTENSITIES = ['Understated', 'Balanced', 'Expressive', 'Statement'];

interface DebugInfo {
  styleKey: string;
  atmosphere: {
    colorTemp: string;
    lightQuality: string;
    shadowStyle: string;
    materialTones: string;
    emotionalTone: string;
    renderDirective: string;
  } | null;
  reviewPrompt: string;
  renderPrompt: string;
  generatePrompt: string;
  review: Record<string, unknown> | null;
  timings: { reviewMs?: number; renderMs?: number; productImageFetchMs?: number; totalMs: number };
  model: { review: string; image: string };
  agentTrace: string[];
  productImages?: Array<{ handle: string; title: string; imageUrl: string }>;
}

type Phase = 'idle' | 'uploading' | 'calling-api' | 'reviewing' | 'rendering' | 'done' | 'error';

// ── Component ───────────────────────────────────────────────────────────────

export default function FunnelPlaygroundPage() {
  // Concept selection
  const [concept, setConcept] = useState<'reveal' | 'style-profile'>('reveal');
  const [mood, setMood] = useState('Cozy & Warm');
  const [track, setTrack] = useState<'soft' | 'dramatic'>('soft');
  const [vibe, setVibe] = useState('Modern Cozy');
  const [intensity, setIntensity] = useState('Balanced');

  // Photo
  const [photoBase64, setPhotoBase64] = useState('');
  const [photoMimeType, setPhotoMimeType] = useState('image/jpeg');
  const [photoPreview, setPhotoPreview] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Generation state
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Results
  const [resultImage, setResultImage] = useState('');
  const [resultMimeType, setResultMimeType] = useState('');
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  const [suggestedProducts, setSuggestedProducts] = useState<string[]>([]);

  // Debug panel
  const [debugOpen, setDebugOpen] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    trace: true,
    atmosphere: true,
    timings: true,
    review: false,
    prompts: false,
  });

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Timer for elapsed time during generation
  useEffect(() => {
    if (phase === 'calling-api' || phase === 'reviewing' || phase === 'rendering') {
      startTimeRef.current = startTimeRef.current || Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  // Simulated progress based on elapsed time (average gen takes ~15-30s)
  useEffect(() => {
    if (phase === 'calling-api') setProgress(5);
    else if (phase === 'reviewing') setProgress(20);
    else if (phase === 'rendering') {
      // Ease from 30 to 90 over ~25 seconds
      const t = Math.min(elapsed / 25000, 1);
      setProgress(30 + t * 60);
    } else if (phase === 'done') setProgress(100);
    else if (phase === 'error') { /* keep current */ }
    else setProgress(0);
  }, [phase, elapsed]);

  // ── Photo upload ──

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const parts = dataUrl.split(',');
      setPhotoBase64(parts[1]);
      setPhotoMimeType(file.type || 'image/jpeg');
      setPhotoPreview(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function clearPhoto() {
    setPhotoBase64('');
    setPhotoMimeType('image/jpeg');
    setPhotoPreview('');
    if (fileRef.current) fileRef.current.value = '';
  }

  // ── Build context ──

  function buildContext() {
    if (concept === 'reveal') {
      return { concept: 'reveal' as const, mood };
    }
    const profileName = `${track === 'soft' ? 'Soft' : 'Dramatic'} ${vibe} ${intensity}`;
    return {
      concept: 'style-profile' as const,
      who: 'Just me',
      track,
      vibe,
      intensity,
      profileName,
    };
  }

  // ── Generate ──

  async function handleGenerate() {
    setPhase('calling-api');
    setError('');
    setResultImage('');
    setDebug(null);
    setSuggestedProducts([]);
    startTimeRef.current = Date.now();
    setElapsed(0);

    const ctx = buildContext();

    try {
      setPhase(photoBase64 ? 'reviewing' : 'rendering');

      const res = await fetch(`${BACKEND}/api/quiz/render-debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: photoBase64,
          mime_type: photoMimeType,
          context: ctx,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.details || data.error || `HTTP ${res.status}`);
      }

      setPhase('done');
      setResultImage(data.render?.imageBase64 || '');
      setResultMimeType(data.render?.mimeType || 'image/png');
      setDebug(data.debug || null);
      setSuggestedProducts(data.suggestedProducts || []);

      // Update elapsed from actual server timing
      if (data.debug?.timings?.totalMs) {
        setElapsed(data.debug.timings.totalMs);
      }
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Generation failed');
    }
  }

  function handleReset() {
    setPhase('idle');
    setProgress(0);
    setElapsed(0);
    setError('');
    setResultImage('');
    setDebug(null);
    setSuggestedProducts([]);
    startTimeRef.current = 0;
  }

  // ── Render helpers ──

  const isGenerating = phase === 'calling-api' || phase === 'reviewing' || phase === 'rendering';
  const isDone = phase === 'done';
  const isError = phase === 'error';

  function formatMs(ms: number) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const phaseLabel: Record<Phase, string> = {
    idle: 'Ready',
    uploading: 'Uploading...',
    'calling-api': 'Connecting to AI...',
    reviewing: 'Analyzing room...',
    rendering: photoBase64 ? 'Rendering visualization...' : 'Generating room from scratch...',
    done: 'Complete',
    error: 'Failed',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <FlaskConical size={20} style={{ color: ACCENT }} />
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Playground
        </h2>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: ACCENT,
            backgroundColor: `${ACCENT}18`,
            padding: '2px 8px',
            borderRadius: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Debug
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: debugOpen ? '1fr 420px' : '1fr', gap: '20px' }}>
        {/* ── Left: Controls + Result ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Config Card */}
          <div
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            {/* Concept Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', padding: '3px' }}>
              {[
                { key: 'reveal' as const, label: 'The Reveal' },
                { key: 'style-profile' as const, label: 'The Style Profile' },
              ].map((c) => (
                <button
                  key={c.key}
                  onClick={() => setConcept(c.key)}
                  disabled={isGenerating}
                  style={{
                    flex: 1,
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: concept === c.key ? 600 : 400,
                    color: concept === c.key ? '#fff' : 'var(--text-secondary)',
                    backgroundColor: concept === c.key ? ACCENT : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: isGenerating ? 'not-allowed' : 'pointer',
                    transition: 'all 150ms',
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Concept-specific options */}
            {concept === 'reveal' ? (
              <div>
                <label style={labelStyle}>Mood</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {REVEAL_MOODS.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setMood(m.key)}
                      disabled={isGenerating}
                      style={{
                        padding: '12px 8px',
                        fontSize: '12px',
                        fontWeight: mood === m.key ? 600 : 400,
                        color: mood === m.key ? '#fff' : 'var(--text-secondary)',
                        backgroundColor: mood === m.key ? m.color : 'var(--bg-secondary)',
                        border: mood === m.key ? `2px solid ${m.color}` : '1px solid var(--border-primary)',
                        borderRadius: '8px',
                        cursor: isGenerating ? 'not-allowed' : 'pointer',
                        transition: 'all 150ms',
                        textShadow: mood === m.key ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
                      }}
                    >
                      {m.key}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Track */}
                <div>
                  <label style={labelStyle}>Track</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {(['soft', 'dramatic'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => { setTrack(t); setVibe(STYLE_PROFILE_VIBES[t][0].key); }}
                        disabled={isGenerating}
                        style={{
                          flex: 1,
                          padding: '10px',
                          fontSize: '13px',
                          fontWeight: track === t ? 600 : 400,
                          color: track === t ? '#fff' : 'var(--text-secondary)',
                          backgroundColor: track === t ? ACCENT : 'var(--bg-secondary)',
                          border: track === t ? `2px solid ${ACCENT}` : '1px solid var(--border-primary)',
                          borderRadius: '8px',
                          cursor: isGenerating ? 'not-allowed' : 'pointer',
                          textTransform: 'capitalize',
                        }}
                      >
                        {t === 'soft' ? 'Soft & Cozy' : 'Dramatic & Moody'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Vibe */}
                <div>
                  <label style={labelStyle}>Vibe</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    {STYLE_PROFILE_VIBES[track].map((v) => (
                      <button
                        key={v.key}
                        onClick={() => setVibe(v.key)}
                        disabled={isGenerating}
                        style={{
                          padding: '10px 8px',
                          fontSize: '11px',
                          fontWeight: vibe === v.key ? 600 : 400,
                          color: vibe === v.key ? '#fff' : 'var(--text-secondary)',
                          backgroundColor: vibe === v.key ? v.color : 'var(--bg-secondary)',
                          border: vibe === v.key ? `2px solid ${v.color}` : '1px solid var(--border-primary)',
                          borderRadius: '8px',
                          cursor: isGenerating ? 'not-allowed' : 'pointer',
                          textShadow: vibe === v.key ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
                        }}
                      >
                        {v.key}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Intensity */}
                <div>
                  <label style={labelStyle}>Intensity</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    {INTENSITIES.map((i) => (
                      <button
                        key={i}
                        onClick={() => setIntensity(i)}
                        disabled={isGenerating}
                        style={{
                          padding: '8px',
                          fontSize: '12px',
                          fontWeight: intensity === i ? 600 : 400,
                          color: intensity === i ? ACCENT : 'var(--text-secondary)',
                          backgroundColor: intensity === i ? `${ACCENT}14` : 'var(--bg-secondary)',
                          border: intensity === i ? `2px solid ${ACCENT}` : '1px solid var(--border-primary)',
                          borderRadius: '8px',
                          cursor: isGenerating ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Photo Upload */}
            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border-primary)' }}>
              <label style={labelStyle}>Room Photo (optional — leave empty for AI-generated sample)</label>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
              {photoPreview ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    src={photoPreview}
                    alt="Room preview"
                    style={{ maxWidth: '200px', maxHeight: '140px', borderRadius: '8px', border: '1px solid var(--border-primary)' }}
                  />
                  <button
                    onClick={clearPhoto}
                    style={{
                      position: 'absolute',
                      top: '-8px',
                      right: '-8px',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={isGenerating}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 20px',
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px dashed var(--border-primary)',
                    borderRadius: '8px',
                    cursor: isGenerating ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Upload size={16} />
                  Upload room photo
                </button>
              )}
            </div>

            {/* Generate Button */}
            <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '14px 24px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#fff',
                  backgroundColor: isGenerating ? '#6b7280' : ACCENT,
                  border: 'none',
                  borderRadius: '10px',
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  transition: 'background-color 200ms',
                }}
              >
                {isGenerating ? (
                  <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Generating...</>
                ) : (
                  <><Play size={16} /> Generate</>
                )}
              </button>
              {(isDone || isError) && (
                <button
                  onClick={handleReset}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '14px 20px',
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <RotateCcw size={14} /> Reset
                </button>
              )}
              <button
                onClick={() => setDebugOpen(!debugOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '14px 16px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: debugOpen ? ACCENT : 'var(--text-tertiary)',
                  backgroundColor: debugOpen ? `${ACCENT}14` : 'var(--bg-secondary)',
                  border: `1px solid ${debugOpen ? `${ACCENT}40` : 'var(--border-primary)'}`,
                  borderRadius: '10px',
                  cursor: 'pointer',
                }}
              >
                <Cpu size={14} /> Debug
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          {(isGenerating || isDone || isError) && (
            <div
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '12px',
                padding: '16px 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isGenerating && <Loader2 size={14} style={{ color: ACCENT, animation: 'spin 1s linear infinite' }} />}
                  {isDone && <CheckCircle2 size={14} style={{ color: '#22c55e' }} />}
                  {isError && <AlertCircle size={14} style={{ color: '#ef4444' }} />}
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {phaseLabel[phase]}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock size={12} style={{ color: 'var(--text-tertiary)' }} />
                  <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-secondary)' }}>
                    {formatMs(elapsed)}
                  </span>
                </div>
              </div>
              <div style={{ height: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    backgroundColor: isError ? '#ef4444' : isDone ? '#22c55e' : ACCENT,
                    borderRadius: '2px',
                    transition: phase === 'done' ? 'width 300ms ease-out' : 'width 500ms linear',
                  }}
                />
              </div>
              {isError && (
                <p style={{ fontSize: '12px', color: '#ef4444', margin: '8px 0 0' }}>{error}</p>
              )}
            </div>
          )}

          {/* Result Image */}
          {resultImage && (
            <div
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ImageIcon size={16} style={{ color: ACCENT }} />
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Generated Result
                </span>
                {debug?.timings?.totalMs && (
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                    Generated in {formatMs(debug.timings.totalMs)}
                  </span>
                )}
              </div>
              <div style={{ padding: '16px', display: 'flex', gap: '16px' }}>
                {/* Before (if photo uploaded) */}
                {photoPreview && (
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                      Before
                    </p>
                    <img src={photoPreview} alt="Before" style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--border-primary)' }} />
                  </div>
                )}
                {/* After */}
                <div style={{ flex: 1 }}>
                  {photoPreview && (
                    <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                      After
                    </p>
                  )}
                  <img
                    src={`data:${resultMimeType};base64,${resultImage}`}
                    alt="Generated"
                    style={{ width: '100%', borderRadius: '8px', border: '1px solid var(--border-primary)' }}
                  />
                </div>
              </div>
              {/* Suggested products */}
              {suggestedProducts.length > 0 && (
                <div style={{ padding: '0 16px 16px' }}>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                    Suggested Products
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {suggestedProducts.slice(0, 8).map((p) => (
                      <span
                        key={p}
                        style={{
                          fontSize: '12px',
                          padding: '4px 10px',
                          backgroundColor: 'var(--bg-secondary)',
                          border: '1px solid var(--border-primary)',
                          borderRadius: '6px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Debug Panel ── */}
        {debugOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '12px',
                overflow: 'hidden',
                position: 'sticky',
                top: '20px',
                maxHeight: 'calc(100vh - 120px)',
                overflowY: 'auto',
              }}
            >
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cpu size={15} style={{ color: ACCENT }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>AI Debug Panel</span>
              </div>

              {!debug ? (
                <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                  <Sparkles size={24} style={{ color: 'var(--text-tertiary)', marginBottom: '8px' }} />
                  <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', margin: 0 }}>
                    Run a generation to see debug info
                  </p>
                </div>
              ) : (
                <div style={{ fontSize: '12px' }}>
                  {/* Style Key */}
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-secondary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <Zap size={12} style={{ color: ACCENT }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Style Key</span>
                    </div>
                    <code style={codeStyle}>{debug.styleKey}</code>
                  </div>

                  {/* Models */}
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-secondary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <Cpu size={12} style={{ color: ACCENT }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Models</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <span style={tagStyle}>Review: <strong>{debug.model.review}</strong></span>
                      <span style={tagStyle}>Image: <strong>{debug.model.image}</strong></span>
                    </div>
                  </div>

                  {/* Agent Trace */}
                  {debug.agentTrace && debug.agentTrace.length > 0 && (
                    <DebugSection
                      title={`Agent Trace (${debug.agentTrace.length} steps)`}
                      icon={<Sparkles size={12} style={{ color: ACCENT }} />}
                      open={expandedSections.trace}
                      onToggle={() => toggleSection('trace')}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                        {debug.agentTrace.map((line, i) => {
                          const tagMatch = line.match(/^\[([A-Z]+)\]\s/);
                          const tag = tagMatch ? tagMatch[1] : '';
                          const text = tagMatch ? line.slice(tagMatch[0].length) : line;
                          const tagColors: Record<string, string> = {
                            CONTEXT: '#8b5cf6',
                            RESOLVE: '#f59e0b',
                            ATMOSPHERE: '#ec4899',
                            PRODUCTS: '#06b6d4',
                            PIPELINE: '#3b82f6',
                            PROMPT: '#10b981',
                            MODELS: '#6366f1',
                            EXEC: '#f97316',
                            DONE: '#22c55e',
                          };
                          const color = tagColors[tag] || 'var(--text-tertiary)';
                          return (
                            <div
                              key={i}
                              style={{
                                display: 'flex',
                                gap: '6px',
                                padding: '4px 0',
                                borderBottom: i < debug.agentTrace.length - 1 ? '1px solid var(--border-secondary)' : 'none',
                                alignItems: 'flex-start',
                              }}
                            >
                              {tag && (
                                <span
                                  style={{
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    color,
                                    backgroundColor: `${color}15`,
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    flexShrink: 0,
                                    marginTop: '1px',
                                    fontFamily: 'var(--font-mono, monospace)',
                                  }}
                                >
                                  {tag}
                                </span>
                              )}
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                {text}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </DebugSection>
                  )}

                  {/* Timings */}
                  <DebugSection
                    title="Timings"
                    icon={<Clock size={12} style={{ color: ACCENT }} />}
                    open={expandedSections.timings}
                    onToggle={() => toggleSection('timings')}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '8px' }}>
                      {debug.timings.productImageFetchMs !== undefined && (
                        <TimingBox label="Img Fetch" ms={debug.timings.productImageFetchMs} />
                      )}
                      {debug.timings.reviewMs !== undefined && (
                        <TimingBox label="Review" ms={debug.timings.reviewMs} />
                      )}
                      {debug.timings.renderMs !== undefined && (
                        <TimingBox label="Render" ms={debug.timings.renderMs} />
                      )}
                      <TimingBox label="Total" ms={debug.timings.totalMs} highlight />
                    </div>
                    {/* Product reference images */}
                    {debug.productImages && debug.productImages.length > 0 && (
                      <div style={{ marginTop: '10px' }}>
                        <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                          Product Reference Images ({debug.productImages.length})
                        </p>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {debug.productImages.map((pi) => (
                            <div key={pi.handle} style={{ textAlign: 'center' }}>
                              {pi.imageUrl && (
                                <img
                                  src={pi.imageUrl}
                                  alt={pi.title}
                                  style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-secondary)' }}
                                />
                              )}
                              <p style={{ fontSize: '9px', color: 'var(--text-tertiary)', margin: '3px 0 0', maxWidth: '56px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {pi.handle}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </DebugSection>

                  {/* Atmosphere */}
                  {debug.atmosphere && (
                    <DebugSection
                      title="Atmosphere Profile"
                      icon={<Thermometer size={12} style={{ color: ACCENT }} />}
                      open={expandedSections.atmosphere}
                      onToggle={() => toggleSection('atmosphere')}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <AtmoRow icon={<Thermometer size={11} />} label="Color Temp" value={debug.atmosphere.colorTemp} />
                        <AtmoRow icon={<Eye size={11} />} label="Light Quality" value={debug.atmosphere.lightQuality} />
                        <AtmoRow icon={<Palette size={11} />} label="Materials" value={debug.atmosphere.materialTones} />
                        <AtmoRow icon={<Sparkles size={11} />} label="Emotional Tone" value={debug.atmosphere.emotionalTone} />
                        <div>
                          <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                            Render Directive
                          </p>
                          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                            {debug.atmosphere.renderDirective}
                          </p>
                        </div>
                      </div>
                    </DebugSection>
                  )}

                  {/* Review Result */}
                  {debug.review && (
                    <DebugSection
                      title="Room Review"
                      icon={<Eye size={12} style={{ color: ACCENT }} />}
                      open={expandedSections.review}
                      onToggle={() => toggleSection('review')}
                    >
                      <pre style={preStyle}>{JSON.stringify(debug.review, null, 2)}</pre>
                    </DebugSection>
                  )}

                  {/* Prompts */}
                  <DebugSection
                    title="AI Prompts"
                    icon={<FileText size={12} style={{ color: ACCENT }} />}
                    open={expandedSections.prompts}
                    onToggle={() => toggleSection('prompts')}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {photoBase64 && debug.reviewPrompt && (
                        <div>
                          <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '4px' }}>
                            Review Prompt ({debug.reviewPrompt.length} chars)
                          </p>
                          <pre style={preStyle}>{debug.reviewPrompt}</pre>
                        </div>
                      )}
                      <div>
                        <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '4px' }}>
                          {photoBase64 ? 'Render' : 'Generate'} Prompt ({(debug.renderPrompt || debug.generatePrompt).length} chars)
                        </p>
                        <pre style={preStyle}>{debug.renderPrompt || debug.generatePrompt}</pre>
                      </div>
                    </div>
                  </DebugSection>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Spin keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '8px',
};

const codeStyle: React.CSSProperties = {
  fontSize: '13px',
  fontFamily: 'var(--font-mono, monospace)',
  color: ACCENT,
  backgroundColor: `${ACCENT}10`,
  padding: '4px 10px',
  borderRadius: '4px',
  display: 'inline-block',
};

const tagStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  backgroundColor: 'var(--bg-secondary)',
  padding: '3px 8px',
  borderRadius: '4px',
  border: '1px solid var(--border-secondary)',
};

const preStyle: React.CSSProperties = {
  fontSize: '11px',
  fontFamily: 'var(--font-mono, monospace)',
  color: 'var(--text-secondary)',
  backgroundColor: 'var(--bg-secondary)',
  padding: '10px 12px',
  borderRadius: '6px',
  border: '1px solid var(--border-secondary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: '300px',
  overflow: 'auto',
  margin: 0,
  lineHeight: 1.5,
};

function DebugSection({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--border-secondary)' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '10px 16px',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        {title}
      </button>
      {open && <div style={{ padding: '0 16px 12px' }}>{children}</div>}
    </div>
  );
}

function TimingBox({ label, ms, highlight }: { label: string; ms: number; highlight?: boolean }) {
  const sec = ms / 1000;
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: '6px',
        backgroundColor: highlight ? `${ACCENT}10` : 'var(--bg-secondary)',
        border: `1px solid ${highlight ? `${ACCENT}30` : 'var(--border-secondary)'}`,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: '16px',
          fontWeight: 700,
          fontFamily: 'var(--font-mono, monospace)',
          color: highlight ? ACCENT : 'var(--text-primary)',
        }}
      >
        {sec < 10 ? sec.toFixed(1) : Math.round(sec)}s
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

function AtmoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
        <span style={{ color: 'var(--text-tertiary)' }}>{icon}</span>
        <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
      </div>
      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>{value}</p>
    </div>
  );
}
