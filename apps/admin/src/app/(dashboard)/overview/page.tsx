'use client';

import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Radio,
  AlertTriangle,
  Coins,
  Clock,
  Star,
} from 'lucide-react';
import { formatNumber, formatDuration } from '@/lib/utils';
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
} from 'recharts';

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

export default function OverviewPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/analytics')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="animate-pulse space-y-4"><div className="h-32 bg-gray-200 rounded-xl" /><div className="h-64 bg-gray-200 rounded-xl" /></div>;
  }

  if (!data) return <p className="text-gray-500">Failed to load analytics</p>;

  const stats = [
    { label: 'Total Conversations', value: formatNumber(data.totalConversations), icon: MessageSquare },
    { label: 'Active', value: formatNumber(data.activeConversations), icon: Radio },
    { label: 'Escalated', value: formatNumber(data.escalatedConversations), icon: AlertTriangle },
    { label: 'Total Tokens', value: formatNumber(data.totalTokens), icon: Coins },
    { label: 'Avg Latency', value: formatDuration(data.avgLatency), icon: Clock },
    { label: 'Avg Satisfaction', value: data.avgSatisfaction ?? 'N/A', icon: Star },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Overview</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-gray-500 mb-2">
              <s.icon size={14} />
              <span className="text-xs">{s.label}</span>
            </div>
            <p className="text-xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium mb-4">Conversations (30 days)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data.conversationsPerDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#000" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium mb-4">Tool Usage</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.toolUsage} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis dataKey="tool" type="category" width={140} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#000" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
