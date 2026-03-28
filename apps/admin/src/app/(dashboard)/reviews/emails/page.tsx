'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Mail, Check, X, Send, Clock, ThumbsUp, ArrowRight,
  AlertCircle, BarChart3,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';

interface EmailTemplate {
  id: string;
  template_type: string;
  enabled: boolean;
  subject: string;
  body_html: string;
  updated_at: string;
}

interface ReviewEmailStats {
  totalRequests: number;
  emailsSent: number;
  queued: number;
  sent: number;
  reminded: number;
  bounced: number;
  expired: number;
  queuedEmails: Array<{ scheduled_for: string; status: string }>;
}

const TEMPLATE_INFO: Record<
  string,
  { label: string; icon: typeof Mail; description: string; color: string; bg: string }
> = {
  request: {
    label: 'Review Request',
    icon: Send,
    description: 'Sent after a purchase to ask the customer for a review',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.10)',
  },
  reminder: {
    label: 'Reminder',
    icon: Clock,
    description: 'Follow-up email if the customer has not left a review',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.10)',
  },
  thank_you: {
    label: 'Thank You',
    icon: ThumbsUp,
    description: 'Sent after a customer submits a review',
    color: '#22c55e',
    bg: 'rgba(34,197,94,0.10)',
  },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ReviewEmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [stats, setStats] = useState<ReviewEmailStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/reviews/emails').then((r) => r.json()).catch(() => ({ templates: [] })),
      fetch('/api/emails/stats').then((r) => r.json()).catch(() => null),
    ]).then(([emailData, statsData]) => {
      setTemplates(emailData.templates ?? []);
      if (statsData?.reviews) setStats(statsData.reviews);
      setLoading(false);
    });
  }, []);

  async function toggleEnabled(template: EmailTemplate) {
    const updated = !template.enabled;
    await fetch(`/api/reviews/emails/${template.template_type}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: updated }),
    });
    setTemplates((prev) =>
      prev.map((t) => (t.id === template.id ? { ...t, enabled: updated } : t)),
    );
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
      </div>
    );
  }

  const types = ['request', 'reminder', 'thank_you'];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Review Email Templates
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          Customize the emails sent during the review collection process
        </p>
      </div>

      {/* Email Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Send size={14} style={{ color: '#6366f1' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Total Sent</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {formatNumber(stats.emailsSent)}
            </p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: stats.queued > 0 ? 'color-mix(in srgb, #f59e0b 6%, var(--bg-primary))' : 'var(--bg-primary)',
              border: stats.queued > 0 ? '1px solid color-mix(in srgb, #f59e0b 25%, var(--border-primary))' : '1px solid var(--border-primary)',
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Clock size={14} style={{ color: '#f59e0b' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Queued</span>
            </div>
            <p className="text-xl font-bold" style={{ color: stats.queued > 0 ? '#f59e0b' : 'var(--text-primary)' }}>
              {stats.queued}
            </p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Mail size={14} style={{ color: '#22c55e' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Requests Sent</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{stats.sent}</p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Clock size={14} style={{ color: '#3b82f6' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Reminders Sent</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{stats.reminded}</p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: stats.bounced > 0 ? 'color-mix(in srgb, #ef4444 6%, var(--bg-primary))' : 'var(--bg-primary)',
              border: stats.bounced > 0 ? '1px solid color-mix(in srgb, #ef4444 25%, var(--border-primary))' : '1px solid var(--border-primary)',
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle size={14} style={{ color: stats.bounced > 0 ? '#ef4444' : 'var(--text-tertiary)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Bounced</span>
            </div>
            <p className="text-xl font-bold" style={{ color: stats.bounced > 0 ? '#ef4444' : 'var(--text-primary)' }}>
              {stats.bounced}
            </p>
          </div>
        </div>
      )}

      {/* Queued Emails */}
      {stats && stats.queuedEmails.length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
            Upcoming Scheduled Emails
          </h3>
          <div className="space-y-2">
            {stats.queuedEmails.map((email, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <Clock size={13} style={{ color: '#f59e0b' }} />
                <span style={{ color: 'var(--text-secondary)' }}>
                  Scheduled for{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>{formatDate(email.scheduled_for)}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {types.map((type) => {
          const info = TEMPLATE_INFO[type];
          const template = templates.find((t) => t.template_type === type);
          const Icon = info.icon;

          return (
            <div
              key={type}
              className="rounded-xl p-5"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: info.bg }}
                  >
                    <Icon size={16} style={{ color: info.color }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {info.label}
                    </h3>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {info.description}
                    </p>
                  </div>
                </div>

                {template && (
                  <button
                    onClick={() => toggleEnabled(template)}
                    className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0"
                    style={{
                      backgroundColor: template.enabled ? 'var(--color-accent)' : 'var(--border-primary)',
                    }}
                  >
                    <div
                      className="w-4 h-4 bg-white rounded-full absolute top-1 transition-transform"
                      style={{ left: template.enabled ? '20px' : '4px' }}
                    />
                  </button>
                )}
              </div>

              {template ? (
                <>
                  <div
                    className="text-xs rounded-lg px-3 py-2 mb-3 truncate"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span style={{ color: 'var(--text-tertiary)' }}>Subject: </span>
                    {template.subject}
                  </div>

                  <div className="flex items-center justify-between">
                    <span
                      className="flex items-center gap-1 text-[10px]"
                      style={{ color: template.enabled ? '#22c55e' : 'var(--text-tertiary)' }}
                    >
                      {template.enabled ? <Check size={10} /> : <X size={10} />}
                      {template.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <Link
                      href={`/reviews/emails/${type}`}
                      className="text-xs font-medium flex items-center gap-1 transition-colors"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      Edit <ArrowRight size={12} />
                    </Link>
                  </div>
                </>
              ) : (
                <div className="text-xs py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  Template not configured yet.{' '}
                  <Link
                    href={`/reviews/emails/${type}`}
                    className="underline"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    Set up
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
