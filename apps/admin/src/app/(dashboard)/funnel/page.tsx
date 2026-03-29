'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  BarChart3,
  Users,
  CheckCircle,
  ShoppingCart,
  Mail,
  Camera,
  GitBranch,
  ArrowRight,
  Clock,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface OverviewStats {
  totalSessions: number;
  completionRate: number;
  conversionRate: number;
  emailCaptures: number;
  photoUploads: number;
  conversions: number;
  completedSessions: number;
  abandonedSessions: number;
}

interface ABComparisonItem {
  concept: string;
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
  conversions: number;
  conversionRate: number;
}

interface ABComparison {
  reveal: ABComparisonItem;
  style_profile: ABComparisonItem;
}

interface QuizSession {
  session_id: string;
  concept: string;
  status: 'started' | 'in_progress' | 'completed' | 'abandoned';
  profile_name: string | null;
  email: string | null;
  created_at: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(d: string): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  started: { bg: 'rgba(107,114,128,0.12)', color: '#6b7280', label: 'Started' },
  in_progress: { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6', label: 'In Progress' },
  completed: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', label: 'Completed' },
  abandoned: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', label: 'Abandoned' },
};

const ACCENT = '#10b981';

// ── Main Page ───────────────────────────────────────────────────────────────

export default function FunnelOverviewPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [comparison, setComparison] = useState<ABComparison | null>(null);
  const [sessions, setSessions] = useState<QuizSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || '';

    Promise.all([
      fetch(`${base}/api/quiz/analytics/overview`).then((r) => {
        if (!r.ok) throw new Error('Failed to load overview stats');
        return r.json();
      }),
      fetch(`${base}/api/quiz/analytics/comparison`).then((r) => {
        if (!r.ok) throw new Error('Failed to load A/B comparison');
        return r.json();
      }),
      fetch(`${base}/api/quiz/sessions?per_page=10`).then((r) => {
        if (!r.ok) throw new Error('Failed to load sessions');
        return r.json();
      }),
    ])
      .then(([overviewData, comparisonData, sessionsData]) => {
        setStats(overviewData);
        // Backend returns array — transform to keyed object
        const compArr = Array.isArray(comparisonData) ? comparisonData : [];
        const revealItem = compArr.find((c: ABComparisonItem) => c.concept === 'reveal') || { totalSessions: 0, completionRate: 0, conversionRate: 0, completedSessions: 0, conversions: 0, concept: 'reveal' };
        const spItem = compArr.find((c: ABComparisonItem) => c.concept === 'style-profile') || { totalSessions: 0, completionRate: 0, conversionRate: 0, completedSessions: 0, conversions: 0, concept: 'style-profile' };
        setComparison({ reveal: revealItem, style_profile: spItem });
        setSessions(sessionsData.sessions || sessionsData || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load funnel data');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Sparkles size={20} style={{ color: ACCENT }} />
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Quiz Funnel
          </h2>
        </div>
        <p style={{ fontSize: '14px', color: 'var(--text-tertiary)' }}>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Sparkles size={20} style={{ color: ACCENT }} />
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Quiz Funnel
          </h2>
        </div>
        <p style={{ fontSize: '14px', color: '#ef4444' }}>{error}</p>
      </div>
    );
  }

  const statCards = [
    {
      label: 'Total Sessions',
      value: stats?.totalSessions ?? 0,
      icon: Users,
    },
    {
      label: 'Completion Rate',
      value: `${stats?.completionRate ?? 0}%`,
      icon: CheckCircle,
    },
    {
      label: 'Conversion Rate',
      value: `${stats?.conversionRate ?? 0}%`,
      icon: ShoppingCart,
    },
    {
      label: 'Email Captures',
      value: stats?.emailCaptures ?? 0,
      icon: Mail,
    },
    {
      label: 'Photo Uploads',
      value: stats?.photoUploads ?? 0,
      icon: Camera,
    },
    {
      label: 'Conversions',
      value: stats?.conversions ?? 0,
      icon: GitBranch,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Sparkles size={20} style={{ color: ACCENT }} />
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Quiz Funnel
          </h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link
            href="/funnel/sessions"
            style={{
              fontSize: '13px',
              fontWeight: 500,
              color: ACCENT,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            All Sessions <ArrowRight size={14} />
          </Link>
          <Link
            href="/funnel/analytics"
            style={{
              fontSize: '13px',
              fontWeight: 500,
              color: ACCENT,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginLeft: '12px',
            }}
          >
            Analytics <BarChart3 size={14} />
          </Link>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: '16px',
        }}
      >
        {statCards.map((card) => (
          <div
            key={card.label}
            style={{
              padding: '20px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <card.icon size={16} style={{ color: ACCENT }} />
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{card.label}</span>
            </div>
            <div style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── A/B Comparison ── */}
      {comparison && (
        <div>
          <h3
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '12px',
            }}
          >
            A/B Comparison
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* The Reveal */}
            <div
              style={{
                padding: '20px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '16px',
                }}
              >
                <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  The Reveal
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    backgroundColor: 'var(--bg-tertiary)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {comparison.reveal.totalSessions} sessions
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                    Completion Rate
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {comparison.reveal.completionRate}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                    Conversion Rate
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 600, color: ACCENT }}>
                    {comparison.reveal.conversionRate}%
                  </div>
                </div>
              </div>
            </div>

            {/* The Style Profile */}
            <div
              style={{
                padding: '20px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '16px',
                }}
              >
                <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  The Style Profile
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    backgroundColor: 'var(--bg-tertiary)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {comparison.style_profile.totalSessions} sessions
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                    Completion Rate
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {comparison.style_profile.completionRate}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                    Conversion Rate
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 600, color: ACCENT }}>
                    {comparison.style_profile.conversionRate}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Recent Sessions Table ── */}
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-primary)',
          }}
        >
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Recent Sessions
          </h3>
          <Link
            href="/funnel/sessions"
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: ACCENT,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>

        {sessions.length === 0 ? (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              fontSize: '14px',
              color: 'var(--text-tertiary)',
            }}
          >
            No sessions yet
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--border-primary)',
                }}
              >
                {['Session ID', 'Concept', 'Status', 'Profile', 'Email', 'Created'].map(
                  (header) => (
                    <th
                      key={header}
                      style={{
                        padding: '10px 20px',
                        textAlign: 'left',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {header}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const statusStyle = STATUS_STYLES[session.status] || STATUS_STYLES.started;
                return (
                  <tr
                    key={session.session_id}
                    style={{ borderBottom: '1px solid var(--border-primary)' }}
                  >
                    <td
                      style={{
                        padding: '12px 20px',
                        fontSize: '13px',
                        fontFamily: 'monospace',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {session.session_id.slice(0, 8)}...
                    </td>
                    <td
                      style={{
                        padding: '12px 20px',
                        fontSize: '13px',
                        color: 'var(--text-primary)',
                        fontWeight: 500,
                      }}
                    >
                      {session.concept}
                    </td>
                    <td style={{ padding: '12px 20px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '3px 10px',
                          borderRadius: '6px',
                          backgroundColor: statusStyle.bg,
                          color: statusStyle.color,
                        }}
                      >
                        {statusStyle.label}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '12px 20px',
                        fontSize: '13px',
                        color: session.profile_name
                          ? 'var(--text-primary)'
                          : 'var(--text-tertiary)',
                      }}
                    >
                      {session.profile_name || '--'}
                    </td>
                    <td
                      style={{
                        padding: '12px 20px',
                        fontSize: '13px',
                        color: session.email ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                      }}
                    >
                      {session.email || '--'}
                    </td>
                    <td
                      style={{
                        padding: '12px 20px',
                        fontSize: '12px',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={12} />
                        {timeAgo(session.created_at)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
