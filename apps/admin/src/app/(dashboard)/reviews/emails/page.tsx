'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Mail, Check, X, Send, Clock, ThumbsUp, ArrowRight,
  AlertCircle, Star, TrendingUp, CalendarClock, User,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

interface EmailTemplate {
  id: string;
  template_type: string;
  enabled: boolean;
  subject: string;
  body_html: string;
  updated_at: string;
}

interface QueuedEmail {
  scheduled_for: string;
  status: string;
  customer_email: string;
  customer_name: string | null;
  order_id: string;
  type: 'request' | 'reminder';
}

interface DailyActivity {
  date: string;
  sent: number;
  reminded: number;
  bounced: number;
}

interface ReviewEmailStats {
  totalRequests: number;
  emailsSent: number;
  queued: number;
  sent: number;
  reminded: number;
  bounced: number;
  expired: number;
  reviewsCollected: number;
  conversionRate: number;
  queuedEmails: QueuedEmail[];
  dailyActivity: DailyActivity[];
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

function formatShortDate(dateStr: string): string {
  return dateStr.slice(5); // "MM-DD"
}

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return 'overdue';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'less than 1h';
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl p-5 ${className}`}
      style={{
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-primary)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {children}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  highlight,
  subtext,
}: {
  icon: typeof Mail;
  label: string;
  value: string | number;
  color: string;
  highlight?: boolean;
  subtext?: string;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: highlight
          ? `color-mix(in srgb, ${color} 6%, var(--bg-primary))`
          : 'var(--bg-primary)',
        border: highlight
          ? `1px solid color-mix(in srgb, ${color} 25%, var(--border-primary))`
          : '1px solid var(--border-primary)',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} style={{ color }} />
        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      </div>
      <p
        className="text-xl font-bold"
        style={{ color: highlight ? color : 'var(--text-primary)' }}
      >
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
      {subtext && (
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{subtext}</p>
      )}
    </div>
  );
}

export default function ReviewEmailsPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [stats, setStats] = useState<ReviewEmailStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'schedule' | 'templates' | 'test'>('overview');
  const [products, setProducts] = useState<Array<{ title: string; handle: string }>>([]);
  const [testEmail, setTestEmail] = useState('');
  const [testCustomerName, setTestCustomerName] = useState('');
  const [testProduct, setTestProduct] = useState('');
  const [testSending, setTestSending] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  useEffect(() => {
    Promise.all([
      fetch('/api/reviews/emails').then((r) => r.json()).catch(() => ({ templates: [] })),
      fetch('/api/emails/stats').then((r) => r.json()).catch(() => null),
      fetch('/api/reviews/products').then((r) => r.json()).catch(() => ({ items: [] })),
    ]).then(([emailData, statsData, productsData]) => {
      setTemplates(emailData.templates ?? []);
      if (statsData?.reviews) setStats(statsData.reviews);
      const items = (productsData?.items ?? []) as Array<{ title: string; handle: string }>;
      setProducts(items);
      if (items.length > 0) setTestProduct(items[0].title);
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

  async function sendTestEmail(templateType: string) {
    if (!testEmail.includes('@')) return;
    setTestSending((prev) => ({ ...prev, [templateType]: true }));
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[templateType];
      return next;
    });
    try {
      const res = await fetch(`/api/reviews/emails/${templateType}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail, product_title: testProduct || undefined, customer_name: testCustomerName || undefined }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [templateType]: data.success
          ? { success: true, message: 'Sent' }
          : { success: false, message: data.error || 'Failed' },
      }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [templateType]: { success: false, message: 'Network error' },
      }));
    }
    setTestSending((prev) => ({ ...prev, [templateType]: false }));
  }

  async function sendAllTests() {
    if (!testEmail.includes('@')) return;
    for (const t of ['request', 'reminder', 'thank_you']) {
      await sendTestEmail(t);
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
        <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  const tabs = [
    { key: 'overview' as const, label: 'Analytics' },
    { key: 'schedule' as const, label: `Schedule${stats?.queuedEmails?.length ? ` (${stats.queuedEmails.length})` : ''}` },
    { key: 'templates' as const, label: 'Templates' },
    { key: 'test' as const, label: 'Send Test' },
  ];

  const types = ['request', 'reminder', 'thank_you'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Review Emails
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Automated review collection emails, analytics, and scheduling
          </p>
        </div>
        <Link
          href="/reviews/settings"
          className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
          style={{
            color: 'var(--text-secondary)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          Email Settings <ArrowRight size={12} />
        </Link>
      </div>

      {/* KPI Strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={Send} label="Emails Sent" value={stats.emailsSent} color="#6366f1" />
          <StatCard
            icon={CalendarClock}
            label="Queued"
            value={stats.queued}
            color="#f59e0b"
            highlight={stats.queued > 0}
          />
          <StatCard icon={Mail} label="Requests Sent" value={stats.sent} color="#3b82f6" />
          <StatCard icon={Clock} label="Reminders Sent" value={stats.reminded} color="#8b5cf6" />
          <StatCard
            icon={Star}
            label="Reviews Collected"
            value={stats.reviewsCollected}
            color="#22c55e"
            subtext={`${stats.conversionRate}% conversion`}
          />
          <StatCard
            icon={AlertCircle}
            label="Bounced"
            value={stats.bounced}
            color="#ef4444"
            highlight={stats.bounced > 0}
          />
        </div>
      )}

      {/* Conversion Highlight */}
      {stats && stats.emailsSent > 0 && (
        <Card>
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(34,197,94,0.10)' }}
            >
              <TrendingUp size={20} style={{ color: '#22c55e' }} />
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {stats.conversionRate}%
                </span>
                <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  email-to-review conversion rate
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {stats.reviewsCollected} reviews collected from {stats.emailsSent} emails sent
                {stats.queued > 0 && ` \u00b7 ${stats.queued} emails pending delivery`}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Tabs */}
      <div
        className="flex gap-1 p-1 rounded-lg"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex-1 text-xs font-medium py-2 px-3 rounded-md transition-colors"
            style={{
              backgroundColor: activeTab === tab.key ? 'var(--bg-primary)' : 'transparent',
              color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-tertiary)',
              boxShadow: activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Email Activity Chart */}
          <Card>
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Email Activity (30 days)
            </h3>
            {stats?.dailyActivity && stats.dailyActivity.some((d) => d.sent > 0 || d.reminded > 0 || d.bounced > 0) ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stats.dailyActivity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-secondary)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                    tickFormatter={formatShortDate}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} allowDecimals={false} width={30} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="sent" name="Requests" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="reminded" name="Reminders" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="bounced" name="Bounced" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[240px] flex items-center justify-center">
                <div className="text-center">
                  <Mail size={32} style={{ color: 'var(--text-tertiary)', margin: '0 auto 8px' }} />
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No email activity yet</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    Emails will appear here once orders are fulfilled and review requests are sent
                  </p>
                </div>
              </div>
            )}
          </Card>

          {/* Funnel Breakdown */}
          {stats && stats.totalRequests > 0 && (
            <Card>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Email Funnel
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'Orders Received', value: stats.totalRequests, color: '#6366f1', pct: 100 },
                  { label: 'Emails Sent', value: stats.sent, color: '#3b82f6', pct: stats.totalRequests > 0 ? (stats.sent / stats.totalRequests) * 100 : 0 },
                  { label: 'Reminders Sent', value: stats.reminded, color: '#8b5cf6', pct: stats.totalRequests > 0 ? (stats.reminded / stats.totalRequests) * 100 : 0 },
                  { label: 'Reviews Collected', value: stats.reviewsCollected, color: '#22c55e', pct: stats.totalRequests > 0 ? (stats.reviewsCollected / stats.totalRequests) * 100 : 0 },
                ].map((step) => (
                  <div key={step.label} className="flex items-center gap-3">
                    <div className="w-28 text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
                      {step.label}
                    </div>
                    <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                      <div
                        className="h-full rounded-full transition-all flex items-center justify-end pr-2"
                        style={{
                          width: `${Math.max(step.pct, 2)}%`,
                          backgroundColor: step.color,
                          minWidth: step.value > 0 ? '40px' : '0',
                        }}
                      >
                        {step.value > 0 && (
                          <span className="text-[10px] font-medium text-white">{step.value}</span>
                        )}
                      </div>
                    </div>
                    <div className="w-12 text-right text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {Math.round(step.pct)}%
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Status Breakdown */}
          {stats && (
            <Card>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                Request Status Breakdown
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Scheduled', value: stats.queued, color: '#f59e0b' },
                  { label: 'Sent', value: stats.sent, color: '#3b82f6' },
                  { label: 'Reminded', value: stats.reminded, color: '#8b5cf6' },
                  { label: 'Bounced', value: stats.bounced, color: '#ef4444' },
                  { label: 'Expired', value: stats.expired, color: '#9ca3af' },
                  { label: 'Total', value: stats.totalRequests, color: 'var(--text-primary)' },
                ].map((item) => (
                  <div key={item.label} className="text-center py-2">
                    <p className="text-lg font-semibold" style={{ color: item.color }}>
                      {formatNumber(item.value)}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{item.label}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="space-y-4">
          {stats && stats.queuedEmails.length > 0 ? (
            <Card>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Upcoming Emails ({stats.queuedEmails.length})
              </h3>
              <div className="space-y-0">
                {stats.queuedEmails.map((email, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-3 text-sm"
                    style={{
                      borderBottom: i < stats.queuedEmails.length - 1
                        ? '1px solid var(--border-secondary)'
                        : 'none',
                    }}
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: email.type === 'request' ? '#3b82f6' : '#8b5cf6',
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {email.customer_name || email.customer_email}
                        </span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: email.type === 'request' ? 'rgba(59,130,246,0.10)' : 'rgba(139,92,246,0.10)',
                            color: email.type === 'request' ? '#3b82f6' : '#8b5cf6',
                          }}
                        >
                          {email.type === 'request' ? 'Request' : 'Reminder'}
                        </span>
                      </div>
                      {email.customer_name && (
                        <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                          {email.customer_email}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {formatDate(email.scheduled_for)}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {timeUntil(email.scheduled_for)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card>
              <div className="py-12 text-center">
                <CalendarClock size={32} style={{ color: 'var(--text-tertiary)', margin: '0 auto 8px' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  No emails scheduled
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Review request emails are automatically scheduled when orders are fulfilled via Shopify webhook
                </p>
              </div>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'test' && (
        <div className="space-y-4">
          {/* Email + Product inputs */}
          <Card>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Recipient Email
                </label>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <div style={{ width: '200px', flexShrink: 0 }}>
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Customer Name
                </label>
                <input
                  type="text"
                  value={testCustomerName}
                  onChange={(e) => setTestCustomerName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-medium mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Product (for template preview)
                </label>
                <select
                  value={testProduct}
                  onChange={(e) => setTestProduct(e.target.value)}
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {products.length === 0 && <option value="">No products found</option>}
                  {products.map((p) => (
                    <option key={p.handle} value={p.title}>{p.title}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* Template test cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {types.map((type) => {
              const info = TEMPLATE_INFO[type];
              const Icon = info.icon;
              const sending = testSending[type];
              const result = testResults[type];

              return (
                <div
                  key={type}
                  className="rounded-xl p-5"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                  }}
                >
                  <div className="flex items-center gap-3 mb-4">
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

                  <button
                    onClick={() => sendTestEmail(type)}
                    disabled={sending || !testEmail.includes('@')}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
                    style={{ backgroundColor: info.color }}
                  >
                    {sending ? (
                      'Sending...'
                    ) : result?.success ? (
                      <><Check size={14} /> Sent</>
                    ) : (
                      <><Send size={14} /> Send Test</>
                    )}
                  </button>

                  {result && !result.success && (
                    <p className="text-[11px] mt-2 text-center" style={{ color: '#ef4444' }}>
                      {result.message}
                    </p>
                  )}
                  {result?.success && (
                    <p className="text-[11px] mt-2 text-center" style={{ color: '#22c55e' }}>
                      {result.message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Send All */}
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Send All 3 Templates
                </h4>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  Send request, reminder, and thank you emails one after another
                </p>
              </div>
              <button
                onClick={sendAllTests}
                disabled={Object.values(testSending).some(Boolean) || !testEmail.includes('@')}
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                <Send size={14} /> Send All
              </button>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'templates' && (
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
      )}
    </div>
  );
}
