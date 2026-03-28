'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Inbox,
  AlertTriangle,
  Bot,
  Clock,
  ShieldCheck,
  ArrowRight,
  MessageSquare,
  Package,
  Star,
  Truck,
  RotateCcw,
  Users,
  Briefcase,
  TrendingUp,
  FileText,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

// ── Types ───────────────────────────────────────────────────────────────────

interface TicketStats {
  openCount: number;
  urgentHighCount: number;
  pendingCount: number;
  unassignedCount: number;
  breachingCount: number;
  avgFirstResponseMinutes: number;
  slaCompliancePercent: number;
  ticketsBySource: { email: number; form: number; ai_escalation: number };
  recentEvents: Array<{
    id: string;
    ticket_id: string;
    event_type: string;
    actor: string;
    old_value: string | null;
    new_value: string | null;
    created_at: string;
  }>;
}

interface ChatAnalytics {
  totalConversations: number;
  activeConversations: number;
  escalatedConversations: number;
  totalTokens: number;
  avgLatency: number;
  avgSatisfaction: string | null;
  conversationsPerDay: { date: string; count: number }[];
  toolUsage: { tool: string; count: number }[];
}

interface ReviewStats {
  all: number;
  published: number;
  pending: number;
  rejected: number;
  archived: number;
  with_photos: number;
  with_replies: number;
}

interface ReturnStats {
  [key: string]: number;
}

interface TradeAnalytics {
  activeMembers: number;
  pendingApplications: number;
  totalApplications: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const SOURCE_COLORS = ['#6366f1', '#10b981', '#a855f7'];

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Card component ──────────────────────────────────────────────────────────

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

function CardHeader({ title, href, linkText }: { title: string; href?: string; linkText?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      {href && (
        <Link
          href={href}
          className="text-xs flex items-center gap-1 transition-colors"
          style={{ color: 'var(--color-accent)' }}
        >
          {linkText || 'View all'} <ArrowRight size={12} />
        </Link>
      )}
    </div>
  );
}

function Metric({ value, label, color }: { value: string | number; label: string; color?: string }) {
  return (
    <div>
      <p className="text-xl font-semibold" style={{ color: color || 'var(--text-primary)' }}>
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, color, href }: {
  icon: typeof Inbox;
  label: string;
  value: string | number;
  color: string;
  href?: string;
}) {
  const content = (
    <div
      className="rounded-xl p-4 flex items-center gap-3 transition-colors"
      style={{
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-primary)',
        boxShadow: 'var(--shadow-sm)',
      }}
      onMouseEnter={(e) => { if (href) e.currentTarget.style.borderColor = color; }}
      onMouseLeave={(e) => { if (href) e.currentTarget.style.borderColor = 'var(--border-primary)'; }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
      >
        <Icon size={18} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {typeof value === 'number' ? formatNumber(value) : value}
        </p>
        <p className="text-[11px] leading-tight" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href} className="block">{content}</Link>;
  }
  return content;
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [ticketStats, setTicketStats] = useState<TicketStats | null>(null);
  const [chatStats, setChatStats] = useState<ChatAnalytics | null>(null);
  const [reviewStats, setReviewStats] = useState<ReviewStats | null>(null);
  const [returnStats, setReturnStats] = useState<ReturnStats | null>(null);
  const [tradeStats, setTradeStats] = useState<TradeAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/tickets/stats').then((r) => r.json()).catch(() => null),
      fetch('/api/analytics').then((r) => r.json()).catch(() => null),
      fetch('/api/reviews/stats').then((r) => r.json()).catch(() => null),
      fetch('/api/returns/analytics').then((r) => r.json()).catch(() => null),
      fetch('/api/trade/analytics').then((r) => r.json()).catch(() => null),
    ]).then(([tickets, chat, reviews, returns, trade]) => {
      setTicketStats(tickets);
      setChatStats(chat);
      setReviewStats(reviews);
      if (returns?.stats) setReturnStats(returns.stats);
      else if (returns && !returns.error) setReturnStats(returns);
      setTradeStats(trade);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-52 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
      </div>
    );
  }

  const openCount = ticketStats?.openCount ?? 0;
  const urgentHighCount = ticketStats?.urgentHighCount ?? 0;
  const autoResolved = chatStats
    ? Math.round(((chatStats.totalConversations - chatStats.escalatedConversations) / Math.max(chatStats.totalConversations, 1)) * 100)
    : 0;
  const avgResponse = ticketStats?.avgFirstResponseMinutes ?? 0;
  const slaCompliance = ticketStats?.slaCompliancePercent ?? 100;

  const pendingReturns = returnStats?.pending_review ?? 0;
  const totalReturns = Object.values(returnStats ?? {}).reduce((a, b) => a + b, 0);
  const pendingReviews = reviewStats?.pending ?? 0;
  const publishedReviews = reviewStats?.published ?? 0;
  const pendingApps = tradeStats?.pendingApplications ?? 0;
  const activeMembers = tradeStats?.activeMembers ?? 0;

  const sourceData = ticketStats?.ticketsBySource
    ? [
        { name: 'Email', value: ticketStats.ticketsBySource.email },
        { name: 'Contact Form', value: ticketStats.ticketsBySource.form },
        { name: 'AI Escalation', value: ticketStats.ticketsBySource.ai_escalation },
      ]
    : [];

  const volumeData = chatStats?.conversationsPerDay?.map((d) => ({
    date: d.date,
    conversations: d.count,
  })) ?? [];

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Overview</h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          Your support hub at a glance
        </p>
      </div>

      {/* ── Top KPI Strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniStat icon={Inbox} label="Open Tickets" value={openCount} color="var(--color-status-open)" href="/tickets" />
        <MiniStat icon={AlertTriangle} label="Urgent / High" value={urgentHighCount} color="var(--color-priority-urgent)" href="/tickets" />
        <MiniStat icon={Package} label="Pending Returns" value={pendingReturns} color="#f59e0b" href="/returns" />
        <MiniStat icon={Star} label="Pending Reviews" value={pendingReviews} color="#eab308" href="/reviews" />
        <MiniStat icon={Bot} label="AI Resolution" value={`${autoResolved}%`} color="var(--color-source-ai)" href="/chatbot/conversations" />
        <MiniStat icon={ShieldCheck} label="SLA Compliance" value={`${slaCompliance}%`} color="var(--color-status-resolved)" />
      </div>

      {/* ── Row 2: Ticket Queue + AI Chatbot + Returns ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Ticket Queue */}
        <Card>
          <CardHeader title="Ticket Queue" href="/tickets" linkText="Inbox" />
          <div className="grid grid-cols-3 gap-3">
            <Metric value={ticketStats?.unassignedCount ?? 0} label="Unassigned" />
            <Metric value={ticketStats?.pendingCount ?? 0} label="Pending" />
            <Metric
              value={ticketStats?.breachingCount ?? 0}
              label="SLA Breach"
              color={ticketStats?.breachingCount ? 'var(--color-priority-urgent)' : undefined}
            />
          </div>
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <Clock size={12} />
              <span>Avg first response: <strong style={{ color: 'var(--text-secondary)' }}>{avgResponse > 0 ? `${avgResponse}m` : 'N/A'}</strong></span>
            </div>
          </div>
        </Card>

        {/* AI Chatbot */}
        <Card>
          <CardHeader title="AI Chatbot" href="/chatbot/conversations" linkText="Conversations" />
          <div className="grid grid-cols-3 gap-3">
            <Metric value={chatStats?.activeConversations ?? 0} label="Active Today" />
            <Metric value={`${autoResolved}%`} label="Auto-Resolved" />
            <Metric value={chatStats?.escalatedConversations ?? 0} label="Escalated" />
          </div>
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <MessageSquare size={12} />
              <span>Total: <strong style={{ color: 'var(--text-secondary)' }}>{formatNumber(chatStats?.totalConversations ?? 0)}</strong> conversations</span>
            </div>
          </div>
        </Card>

        {/* Returns */}
        <Card>
          <CardHeader title="Returns" href="/returns" linkText="All returns" />
          <div className="grid grid-cols-3 gap-3">
            <Metric value={pendingReturns} label="Pending" color={pendingReturns > 0 ? '#f59e0b' : undefined} />
            <Metric value={returnStats?.approved ?? 0} label="Approved" />
            <Metric value={returnStats?.refunded ?? 0} label="Refunded" color={returnStats?.refunded ? '#22c55e' : undefined} />
          </div>
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <RotateCcw size={12} />
              <span>Total: <strong style={{ color: 'var(--text-secondary)' }}>{formatNumber(totalReturns)}</strong> return requests</span>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Row 3: Reviews + Trade Program ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Reviews */}
        <Card>
          <CardHeader title="Reviews" href="/reviews" linkText="Manage" />
          <div className="grid grid-cols-4 gap-3">
            <Metric value={publishedReviews} label="Published" color="#22c55e" />
            <Metric value={pendingReviews} label="Pending" color={pendingReviews > 0 ? '#eab308' : undefined} />
            <Metric value={reviewStats?.with_photos ?? 0} label="With Photos" />
            <Metric value={reviewStats?.with_replies ?? 0} label="Replied" />
          </div>
          <div className="mt-4 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--border-secondary)' }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <Star size={12} />
              <span>Total: <strong style={{ color: 'var(--text-secondary)' }}>{formatNumber(reviewStats?.all ?? 0)}</strong> reviews</span>
            </div>
            {(reviewStats?.rejected ?? 0) > 0 && (
              <span className="text-[11px] flex items-center gap-1" style={{ color: '#ef4444' }}>
                <XCircle size={11} /> {reviewStats?.rejected} rejected
              </span>
            )}
          </div>
        </Card>

        {/* Trade Program */}
        <Card>
          <CardHeader title="Trade Program" href="/trade" linkText="Manage" />
          <div className="grid grid-cols-3 gap-3">
            <Metric value={activeMembers} label="Active Members" color="#6366f1" />
            <Metric value={pendingApps} label="Pending Apps" color={pendingApps > 0 ? '#f59e0b' : undefined} />
            <Metric value={tradeStats?.totalApplications ?? 0} label="Total Apps" />
          </div>
          <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <Briefcase size={12} />
              <span>B2B wholesale program</span>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Row 4: Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tickets by Source */}
        <Card>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Tickets by Source</h3>
          {sourceData.some((d) => d.value > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={sourceData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {sourceData.map((_, i) => (
                    <Cell key={i} fill={SOURCE_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No ticket data yet</p>
            </div>
          )}
        </Card>

        {/* Conversation Volume */}
        <Card>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>AI Conversations (30 days)</h3>
          {volumeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-secondary)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => v.slice(5)} />
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
                <Line type="monotone" dataKey="conversations" stroke="var(--color-accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No conversation data yet</p>
            </div>
          )}
        </Card>
      </div>

      {/* ── Row 5: Recent Activity ── */}
      <Card>
        <CardHeader title="Recent Activity" href="/tickets" linkText="View tickets" />
        {ticketStats?.recentEvents && ticketStats.recentEvents.length > 0 ? (
          <div className="space-y-2.5">
            {ticketStats.recentEvents.slice(0, 8).map((event) => (
              <div key={event.id} className="flex items-center gap-3 text-sm">
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                />
                <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{event.actor}</span>
                  {' '}{event.event_type.replace(/_/g, ' ')}
                  {event.new_value && (
                    <> to <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{event.new_value}</span></>
                  )}
                </span>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                  {timeAgo(event.created_at)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No recent activity</p>
        )}
      </Card>
    </div>
  );
}
