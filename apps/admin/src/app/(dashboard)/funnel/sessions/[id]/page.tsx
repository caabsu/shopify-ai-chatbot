'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Monitor, Globe, Tag, Mail, User, Calendar, CheckCircle } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface QuizEvent {
  id: string;
  event_type: string;
  step_name: string | null;
  duration_ms: number | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

interface SessionDetail {
  id: string;
  session_id: string;
  concept: string;
  status: string;
  profile_name: string | null;
  email: string | null;
  device: string | null;
  referrer: string | null;
  utm_source: string | null;
  answers: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
  events: QuizEvent[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const ACCENT = '#10b981';

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  started:     { bg: 'rgba(107,114,128,0.12)', color: '#6b7280', label: 'Started' },
  in_progress: { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6', label: 'In Progress' },
  completed:   { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e', label: 'Completed' },
  abandoned:   { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', label: 'Abandoned' },
};

const CONCEPT_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  reveal:          { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', label: 'The Reveal' },
  'style-profile': { bg: 'rgba(139,92,246,0.12)', color: '#8b5cf6', label: 'The Style Profile' },
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  quiz_started:    '#3b82f6',
  step_completed:  ACCENT,
  step_viewed:     '#8b5cf6',
  email_captured:  '#f59e0b',
  photo_uploaded:  '#ec4899',
  quiz_completed:  '#22c55e',
  quiz_abandoned:  '#ef4444',
  recommendation:  '#6366f1',
};

function formatDate(d: string): string {
  return new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(d: string): string {
  return new Date(d).toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || '';
    fetch(`${base}/api/quiz/sessions/${sessionId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load session (${r.status})`);
        return r.json();
      })
      .then((data) => {
        setSession(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load session');
        setLoading(false);
      });
  }, [sessionId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <Link
          href="/funnel/sessions"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            color: 'var(--text-tertiary)',
            textDecoration: 'none',
          }}
        >
          <ArrowLeft size={14} /> Back to Sessions
        </Link>
        <div
          style={{
            height: '300px',
            borderRadius: '12px',
            backgroundColor: 'var(--bg-tertiary)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <Link
          href="/funnel/sessions"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            color: 'var(--text-tertiary)',
            textDecoration: 'none',
          }}
        >
          <ArrowLeft size={14} /> Back to Sessions
        </Link>
        <p style={{ fontSize: '14px', color: '#ef4444' }}>{error || 'Session not found'}</p>
      </div>
    );
  }

  const statusStyle = STATUS_STYLES[session.status] ?? STATUS_STYLES.started;
  const conceptStyle = CONCEPT_STYLES[session.concept];
  const answers = session.answers ? Object.entries(session.answers) : [];

  const infoItems = [
    { label: 'Email', value: session.email, icon: Mail },
    { label: 'Device', value: session.device, icon: Monitor },
    { label: 'Referrer', value: session.referrer, icon: Globe },
    { label: 'UTM Source', value: session.utm_source, icon: Tag },
    { label: 'Started', value: session.started_at ? formatDate(session.started_at) : null, icon: Calendar },
    { label: 'Completed', value: session.completed_at ? formatDate(session.completed_at) : null, icon: CheckCircle },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Header ── */}
      <div>
        <Link
          href="/funnel/sessions"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            color: 'var(--text-tertiary)',
            textDecoration: 'none',
            marginBottom: '16px',
          }}
        >
          <ArrowLeft size={14} /> Back to Sessions
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Session{' '}
            <span style={{ fontFamily: 'var(--font-mono, monospace)', color: ACCENT }}>
              {(session.session_id || session.id).slice(0, 12)}
            </span>
          </h2>

          {/* Status Badge */}
          <span
            style={{
              display: 'inline-block',
              fontSize: '11px',
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: '9999px',
              backgroundColor: statusStyle.bg,
              color: statusStyle.color,
            }}
          >
            {statusStyle.label}
          </span>

          {/* Concept Badge */}
          {conceptStyle && (
            <span
              style={{
                display: 'inline-block',
                fontSize: '11px',
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: '9999px',
                backgroundColor: conceptStyle.bg,
                color: conceptStyle.color,
              }}
            >
              {conceptStyle.label}
            </span>
          )}

          {/* Profile Name */}
          {session.profile_name && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
              }}
            >
              <User size={14} />
              {session.profile_name}
            </span>
          )}
        </div>
      </div>

      {/* ── Info Grid ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '16px',
        }}
      >
        {infoItems.map((item) => (
          <div
            key={item.label}
            style={{
              padding: '16px 20px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <item.icon size={14} style={{ color: 'var(--text-tertiary)' }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {item.label}
              </span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: item.value ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
              {item.value || '--'}
            </div>
          </div>
        ))}
      </div>

      {/* ── Answers ── */}
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
          }}
        >
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Answers
          </h3>
        </div>

        {answers.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: '14px', color: 'var(--text-tertiary)' }}>
            No answers recorded
          </div>
        ) : (
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {answers.map(([key, value]) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '16px',
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '8px',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: ACCENT,
                    minWidth: '140px',
                    flexShrink: 0,
                  }}
                >
                  {key}
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                  {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Events Timeline ── */}
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
          }}
        >
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Events Timeline
          </h3>
        </div>

        {(!session.events || session.events.length === 0) ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: '14px', color: 'var(--text-tertiary)' }}>
            No events recorded
          </div>
        ) : (
          <div style={{ padding: '16px 20px' }}>
            {session.events.map((event, idx) => {
              const eventColor = EVENT_TYPE_COLORS[event.event_type] || '#6b7280';
              const isLast = idx === session.events.length - 1;

              return (
                <div
                  key={event.id}
                  style={{
                    display: 'flex',
                    gap: '16px',
                    position: 'relative',
                    paddingBottom: isLast ? '0' : '20px',
                  }}
                >
                  {/* Timeline line */}
                  {!isLast && (
                    <div
                      style={{
                        position: 'absolute',
                        left: '7px',
                        top: '18px',
                        bottom: '0',
                        width: '2px',
                        backgroundColor: 'var(--border-primary)',
                      }}
                    />
                  )}

                  {/* Timeline dot */}
                  <div
                    style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: eventColor,
                      flexShrink: 0,
                      marginTop: '2px',
                      border: '3px solid var(--bg-primary)',
                      boxShadow: `0 0 0 2px ${eventColor}`,
                    }}
                  />

                  {/* Event content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      {/* Timestamp */}
                      <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', flexShrink: 0 }}>
                        <Clock size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                        {formatTime(event.created_at)}
                      </span>

                      {/* Event type badge */}
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          backgroundColor: `${eventColor}1a`,
                          color: eventColor,
                        }}
                      >
                        {event.event_type.replace(/_/g, ' ')}
                      </span>

                      {/* Step name */}
                      {event.step_name && (
                        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                          {event.step_name}
                        </span>
                      )}

                      {/* Duration */}
                      {event.duration_ms != null && (
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                          {event.duration_ms >= 1000
                            ? `${(event.duration_ms / 1000).toFixed(1)}s`
                            : `${event.duration_ms}ms`}
                        </span>
                      )}
                    </div>

                    {/* Data preview */}
                    {event.data && Object.keys(event.data).length > 0 && (
                      <pre
                        style={{
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono, monospace)',
                          color: 'var(--text-tertiary)',
                          backgroundColor: 'var(--bg-secondary)',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          overflow: 'auto',
                          maxHeight: '120px',
                          margin: '4px 0 0 0',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {JSON.stringify(event.data, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
