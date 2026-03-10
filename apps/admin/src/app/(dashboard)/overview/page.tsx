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
  Mail,
  FormInput,
  Sparkles,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import {
  BarChart,
  Bar,
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

interface Analytics {
  totalConversations: number;
  activeConversations: number;
  escalatedConversations: number;
  totalTokens: number;
  avgLatency: number;
  avgSatisfaction: string | null;
  conversationsPerDay: { date: string; count: number }[];
  toolUsage: { tool: string; count: number }[];
}

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

export default function OverviewPage() {
  const [ticketStats, setTicketStats] = useState<TicketStats | null>(null);
  const [chatStats, setChatStats] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/tickets/stats').then((r) => r.json()).catch(() => null),
      fetch('/api/analytics').then((r) => r.json()).catch(() => null),
    ]).then(([tickets, chat]) => {
      setTicketStats(tickets);
      setChatStats(chat);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-40 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="h-48 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          <div className="h-48 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        </div>
      </div>
    );
  }

  const openCount = ticketStats?.openCount ?? 0;
  const urgentHighCount = ticketStats?.urgentHighCount ?? 0;
  const autoResolved = chatStats ? Math.round(((chatStats.totalConversations - chatStats.escalatedConversations) / Math.max(chatStats.totalConversations, 1)) * 100) : 0;
  const avgResponse = ticketStats?.avgFirstResponseMinutes ?? 0;
  const slaCompliance = ticketStats?.slaCompliancePercent ?? 100;

  const kpis = [
    { label: 'Open Tickets', value: formatNumber(openCount), icon: Inbox, color: 'var(--color-status-open)' },
    { label: 'Urgent / High', value: formatNumber(urgentHighCount), icon: AlertTriangle, color: 'var(--color-priority-urgent)' },
    { label: 'AI Auto-Resolved', value: `${autoResolved}%`, icon: Bot, color: 'var(--color-source-ai)' },
    { label: 'Avg First Response', value: avgResponse > 0 ? `${avgResponse}m` : 'N/A', icon: Clock, color: 'var(--color-status-pending)' },
    { label: 'SLA Compliance', value: `${slaCompliance}%`, icon: ShieldCheck, color: 'var(--color-status-resolved)' },
  ];

  const sourceData = ticketStats?.ticketsBySource
    ? [
        { name: 'Email', value: ticketStats.ticketsBySource.email },
        { name: 'Form', value: ticketStats.ticketsBySource.form },
        { name: 'AI Escalation', value: ticketStats.ticketsBySource.ai_escalation },
      ]
    : [];

  const volumeData = chatStats?.conversationsPerDay?.map((d) => ({
    date: d.date,
    conversations: d.count,
  })) ?? [];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Overview</h2>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `color-mix(in srgb, ${kpi.color} 12%, transparent)` }}
              >
                <kpi.icon size={16} style={{ color: kpi.color }} />
              </div>
            </div>
            <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{kpi.value}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Queue & Chatbot Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ticket Queue */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Ticket Queue</h3>
            <Link
              href="/tickets"
              className="text-xs flex items-center gap-1 transition-colors"
              style={{ color: 'var(--color-accent)' }}
            >
              View inbox <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {formatNumber(ticketStats?.unassignedCount ?? 0)}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Unassigned</p>
            </div>
            <div>
              <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {formatNumber(ticketStats?.pendingCount ?? 0)}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Pending</p>
            </div>
            <div>
              <p className="text-xl font-semibold" style={{ color: ticketStats?.breachingCount ? 'var(--color-priority-urgent)' : 'var(--text-primary)' }}>
                {formatNumber(ticketStats?.breachingCount ?? 0)}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>SLA Breaching</p>
            </div>
          </div>
        </div>

        {/* AI Chatbot */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>AI Chatbot</h3>
            <Link
              href="/chatbot/conversations"
              className="text-xs flex items-center gap-1 transition-colors"
              style={{ color: 'var(--color-accent)' }}
            >
              View conversations <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {formatNumber(chatStats?.activeConversations ?? 0)}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Active Today</p>
            </div>
            <div>
              <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {autoResolved}%
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Auto-Resolved</p>
            </div>
            <div>
              <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                {formatNumber(chatStats?.escalatedConversations ?? 0)}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Escalated</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Source pie chart */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Tickets by Source</h3>
          {sourceData.some((d) => d.value > 0) ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={sourceData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label>
                  {sourceData.map((_, i) => (
                    <Cell key={i} fill={SOURCE_COLORS[i]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No ticket data yet</p>
            </div>
          )}
        </div>

        {/* Volume trend */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>AI Conversations (30 days)</h3>
          {volumeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-secondary)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                  }}
                />
                <Line type="monotone" dataKey="conversations" stroke="var(--color-accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No conversation data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Recent Activity</h3>
        {ticketStats?.recentEvents && ticketStats.recentEvents.length > 0 ? (
          <div className="space-y-3">
            {ticketStats.recentEvents.slice(0, 10).map((event) => (
              <div key={event.id} className="flex items-center gap-3 text-sm">
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                />
                <span style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{event.actor}</span>
                  {' '}{event.event_type.replace(/_/g, ' ')}
                  {event.new_value && (
                    <> to <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{event.new_value}</span></>
                  )}
                </span>
                <span className="ml-auto text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                  {timeAgo(event.created_at)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No recent activity</p>
        )}
      </div>
    </div>
  );
}
