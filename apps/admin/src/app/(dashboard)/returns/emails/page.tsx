'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Mail, Check, X, FileText, ThumbsUp, ThumbsDown, DollarSign, Gift,
  Send, BarChart3, ArrowRight,
} from 'lucide-react';

interface EmailTemplate {
  id: string;
  template_type: string;
  enabled: boolean;
  subject: string;
  body_html: string;
  body_text: string;
  updated_at: string;
}

interface ReturnEmailStats {
  totalRequests: number;
  emailsEstimate: number;
  byType: { confirmation: number; approved: number; denied: number; refunded: number };
}

const TEMPLATE_INFO: Record<string, { label: string; icon: typeof Mail; description: string; color: string; bg: string }> = {
  confirmation: {
    label: 'Confirmation',
    icon: FileText,
    description: 'Sent when a customer submits a return request',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.10)',
  },
  approved: {
    label: 'Approved (with shipping)',
    icon: ThumbsUp,
    description: 'Sent when a return is approved and customer needs to ship items back',
    color: '#22c55e',
    bg: 'rgba(34,197,94,0.10)',
  },
  approved_no_return: {
    label: 'Approved (refund only)',
    icon: Gift,
    description: 'Sent when a return is approved without requiring items to be shipped back',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.10)',
  },
  denied: {
    label: 'Denied',
    icon: ThumbsDown,
    description: 'Sent when a return request is denied',
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.10)',
  },
  refunded: {
    label: 'Refunded',
    icon: DollarSign,
    description: 'Sent when a refund has been processed',
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.10)',
  },
};

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [stats, setStats] = useState<ReturnEmailStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/returns/emails').then((r) => r.json()).catch(() => ({ templates: [] })),
      fetch('/api/emails/stats').then((r) => r.json()).catch(() => null),
    ]).then(([emailData, statsData]) => {
      setTemplates(emailData.templates ?? []);
      if (statsData?.returns) setStats(statsData.returns);
      setLoading(false);
    });
  }, []);

  async function toggleEnabled(template: EmailTemplate) {
    const updated = !template.enabled;
    await fetch(`/api/returns/emails/${template.template_type}`, {
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
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
      </div>
    );
  }

  const types = ['confirmation', 'approved', 'approved_no_return', 'denied', 'refunded'];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Return Email Templates</h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          Customize the emails sent during the return process
        </p>
      </div>

      {/* Email Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Send size={14} style={{ color: '#6366f1' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Total Emails (est.)</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{stats.emailsEstimate}</p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <ThumbsUp size={14} style={{ color: '#22c55e' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Approved</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{stats.byType.approved}</p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <ThumbsDown size={14} style={{ color: '#ef4444' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Denied</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{stats.byType.denied}</p>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <DollarSign size={14} style={{ color: '#a855f7' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Refunded</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{stats.byType.refunded}</p>
          </div>
        </div>
      )}

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                    <span className="flex items-center gap-1 text-[10px]" style={{ color: template.enabled ? '#22c55e' : 'var(--text-tertiary)' }}>
                      {template.enabled ? <Check size={10} /> : <X size={10} />}
                      {template.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <Link
                      href={`/returns/emails/${type}`}
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
                    href={`/returns/emails/${type}`}
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
