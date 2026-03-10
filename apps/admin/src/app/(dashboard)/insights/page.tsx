'use client';

import { useState, useEffect } from 'react';
import {
  MessageSquare, Inbox, CheckCircle, Clock, ShieldCheck, TrendingUp,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
  AreaChart, Area,
} from 'recharts';

interface InsightData {
  totalInquiries: number;
  aiAutoResolvedPercent: number;
  ticketsCreated: number;
  resolutionRate: number;
  avgResponseMinutes: number;
  slaCompliance: number;
  volumeOverTime: Array<{ date: string; ai_resolved: number; tickets: number }>;
  ticketsBySource: Array<{ name: string; value: number }>;
  ticketsByCategory: Array<{ category: string; count: number }>;
  toolUsage: Array<{ tool: string; count: number }>;
  satisfactionTrend: Array<{ date: string; score: number }>;
  topIssues: Array<{ category: string; count: number; percentage: number }>;
}

const SOURCE_COLORS = ['#6366f1', '#10b981', '#a855f7'];
const DATE_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export default function InsightsPage() {
  const [data, setData] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/tickets/stats').then((r) => r.json()).catch(() => ({})),
      fetch('/api/analytics').then((r) => r.json()).catch(() => ({})),
    ]).then(([ticketStats, chatStats]) => {
      const totalConvos = chatStats.totalConversations ?? 0;
      const escalated = chatStats.escalatedConversations ?? 0;
      const resolved = totalConvos - escalated;

      setData({
        totalInquiries: totalConvos + (ticketStats.openCount ?? 0) + (ticketStats.pendingCount ?? 0) + (ticketStats.resolvedCount ?? 0) + (ticketStats.closedCount ?? 0),
        aiAutoResolvedPercent: totalConvos > 0 ? Math.round((resolved / totalConvos) * 100) : 0,
        ticketsCreated: (ticketStats.openCount ?? 0) + (ticketStats.pendingCount ?? 0) + (ticketStats.resolvedCount ?? 0) + (ticketStats.closedCount ?? 0),
        resolutionRate: ticketStats.slaCompliancePercent ?? 0,
        avgResponseMinutes: ticketStats.avgFirstResponseMinutes ?? 0,
        slaCompliance: ticketStats.slaCompliancePercent ?? 100,
        volumeOverTime: (chatStats.conversationsPerDay ?? []).map((d: { date: string; count: number }) => ({
          date: d.date,
          ai_resolved: Math.floor(d.count * 0.7),
          tickets: Math.ceil(d.count * 0.3),
        })),
        ticketsBySource: [
          { name: 'Email', value: ticketStats.ticketsBySource?.email ?? 0 },
          { name: 'Form', value: ticketStats.ticketsBySource?.form ?? 0 },
          { name: 'AI Escalation', value: ticketStats.ticketsBySource?.ai_escalation ?? 0 },
        ],
        ticketsByCategory: [],
        toolUsage: chatStats.toolUsage ?? [],
        satisfactionTrend: [],
        topIssues: [],
      });
      setLoading(false);
    });
  }, [range]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-40 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return <p style={{ color: 'var(--text-tertiary)' }}>Failed to load insights</p>;

  const kpis = [
    { label: 'Total Inquiries', value: formatNumber(data.totalInquiries), icon: MessageSquare, color: 'var(--color-accent)' },
    { label: 'AI Auto-Resolved', value: `${data.aiAutoResolvedPercent}%`, icon: TrendingUp, color: 'var(--color-source-ai)' },
    { label: 'Tickets Created', value: formatNumber(data.ticketsCreated), icon: Inbox, color: 'var(--color-status-open)' },
    { label: 'Resolution Rate', value: `${data.resolutionRate}%`, icon: CheckCircle, color: 'var(--color-status-resolved)' },
    { label: 'Avg Response', value: data.avgResponseMinutes > 0 ? `${data.avgResponseMinutes}m` : 'N/A', icon: Clock, color: 'var(--color-status-pending)' },
    { label: 'SLA Compliance', value: `${data.slaCompliance}%`, icon: ShieldCheck, color: 'var(--color-status-resolved)' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Insights</h2>
        <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          {DATE_RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setRange(r.days)}
              className="px-3 py-1 text-xs font-medium rounded-md transition-colors"
              style={{
                backgroundColor: range === r.days ? 'var(--bg-primary)' : 'transparent',
                color: range === r.days ? 'var(--text-primary)' : 'var(--text-tertiary)',
                boxShadow: range === r.days ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
            <div className="flex items-center gap-2 mb-2">
              <kpi.icon size={14} style={{ color: kpi.color }} />
              <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-tertiary)' }}>
                {kpi.label}
              </span>
            </div>
            <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Volume over time */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Volume Over Time</h3>
          {data.volumeOverTime.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={data.volumeOverTime}>
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
                <Area type="monotone" dataKey="ai_resolved" stackId="1" stroke="#a855f7" fill="rgba(168,85,247,0.2)" name="AI Resolved" />
                <Area type="monotone" dataKey="tickets" stackId="1" stroke="#6366f1" fill="rgba(99,102,241,0.2)" name="Tickets" />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No data yet</p>
            </div>
          )}
        </div>

        {/* Tickets by source */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Tickets by Source</h3>
          {data.ticketsBySource.some((s) => s.value > 0) ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={data.ticketsBySource} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" label>
                  {data.ticketsBySource.map((_, i) => (
                    <Cell key={i} fill={SOURCE_COLORS[i]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No ticket data</p>
            </div>
          )}
        </div>

        {/* Tool usage */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>AI Tool Usage</h3>
          {data.toolUsage.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.toolUsage} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-secondary)" />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} allowDecimals={false} />
                <YAxis dataKey="tool" type="category" width={130} tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                  }}
                />
                <Bar dataKey="count" fill="var(--color-accent)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No tool usage data</p>
            </div>
          )}
        </div>

        {/* Top issues placeholder */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Top Issues</h3>
          {data.topIssues.length > 0 ? (
            <div className="space-y-3">
              {data.topIssues.map((issue) => (
                <div key={issue.category} className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{issue.category}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${issue.percentage}%`,
                          backgroundColor: 'var(--color-accent)',
                        }}
                      />
                    </div>
                    <span className="text-xs w-8 text-right" style={{ color: 'var(--text-tertiary)' }}>{issue.count}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[250px] flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Category data will populate as tickets are categorized
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
