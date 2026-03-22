'use client';

import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, ExternalLink } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface DebugEvent {
  id: number;
  type: string;
  label: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export default function ReviewsPlaygroundPage() {
  const [iframeKey, setIframeKey] = useState(0);
  const [events, setEvents] = useState<DebugEvent[]>([]);

  const { brandSlug } = useBrand();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const brandQs = brandSlug && brandSlug !== 'outlight' ? `brand=${brandSlug}` : '';

  let eventCounter = 0;

  const handleReset = useCallback(() => {
    setIframeKey((k) => k + 1);
    setEvents([]);
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const { type, data } = event.data || {};
      if (!type?.startsWith('orw:')) return;

      const newEvent: DebugEvent = {
        id: ++eventCounter,
        type,
        label: type.replace('orw:', ''),
        data,
        timestamp: Date.now(),
      };
      setEvents((prev) => [...prev, newEvent]);
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const eventColors: Record<string, { color: string; bg: string }> = {
    loaded: { color: '#22c55e', bg: 'rgba(34,197,94,0.10)' },
    review_submitted: { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
    form_opened: { color: '#a855f7', bg: 'rgba(168,85,247,0.10)' },
    error: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Reviews Playground
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Test the reviews widget with debug information
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${backendUrl}/widget/preview-reviews${brandQs ? `?${brandQs}` : ''}`}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            <ExternalLink size={12} /> Standalone
          </a>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={{ border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 min-h-0">
        {/* Widget iframe (70%) */}
        <div
          className="relative rounded-2xl overflow-hidden min-h-[500px]"
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          <iframe
            key={iframeKey}
            src={`${backendUrl}/widget/preview-reviews?${[brandQs, 'debug=1'].filter(Boolean).join('&')}`}
            className="absolute inset-0 w-full h-full border-0"
            style={{ background: 'var(--bg-primary)' }}
            title="Reviews Widget Preview"
          />
        </div>

        {/* Debug panel (30%) */}
        <div
          className="rounded-xl p-4 overflow-y-auto flex flex-col gap-4"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Debug Events
          </h3>

          {events.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              No events captured yet. Interact with the widget to see events here.
            </p>
          ) : (
            <div className="space-y-2">
              {events
                .slice()
                .reverse()
                .map((evt) => {
                  const style = eventColors[evt.label] || {
                    color: 'var(--text-secondary)',
                    bg: 'var(--bg-secondary)',
                  };
                  return (
                    <div
                      key={evt.id}
                      className="rounded-lg p-2.5 space-y-1"
                      style={{ backgroundColor: style.bg, border: `1px solid ${style.color}20` }}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="text-[11px] font-medium font-mono"
                          style={{ color: style.color }}
                        >
                          {evt.type}
                        </span>
                        <span className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>
                          {new Date(evt.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {evt.data && Object.keys(evt.data).length > 0 && (
                        <pre
                          className="text-[9px] font-mono overflow-x-auto"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {JSON.stringify(evt.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          <div className="mt-auto pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Listening for <code className="font-mono text-[10px]">orw:*</code> events from the
              reviews widget iframe.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
