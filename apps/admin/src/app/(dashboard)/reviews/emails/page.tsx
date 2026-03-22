'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Mail, Check, X, Send, Clock, ThumbsUp } from 'lucide-react';

interface EmailTemplate {
  id: string;
  template_type: string;
  enabled: boolean;
  subject: string;
  body_html: string;
  updated_at: string;
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

export default function ReviewEmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reviews/emails')
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates ?? []))
      .finally(() => setLoading(false));
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
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
          Email Templates
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          Customize the emails sent during the review collection process
        </p>
      </div>

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
                      className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                      style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-primary)',
                      }}
                    >
                      Edit Template
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
