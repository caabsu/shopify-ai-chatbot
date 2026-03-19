'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Users, FileText, DollarSign, ShoppingCart, ArrowRight, Clock } from 'lucide-react';

interface Analytics {
  total_members: number;
  pending_applications: number;
  total_trade_revenue: number;
  avg_order_value: number;
}

interface Application {
  id: string;
  full_name: string;
  company_name: string;
  business_type: string;
  status: string;
  created_at: string;
}

export default function TradeOverviewPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [recentApps, setRecentApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/trade/analytics').then((r) => r.json()),
      fetch('/api/trade/applications?status=pending&limit=5&sort=created_at&order=desc').then((r) => r.json()),
    ]).then(([analyticsData, appsData]) => {
      setAnalytics(analyticsData);
      setRecentApps(appsData.applications || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Trade Program</h2>
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl p-5 animate-pulse" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)', height: 100 }} />
          ))}
        </div>
      </div>
    );
  }

  const kpis = [
    { label: 'Active Members', value: analytics?.total_members || 0, icon: Users, color: 'var(--color-accent)' },
    { label: 'Pending Applications', value: analytics?.pending_applications || 0, icon: Clock, color: 'var(--color-status-pending)' },
    { label: 'Trade Revenue (30d)', value: `$${(analytics?.total_trade_revenue || 0).toLocaleString()}`, icon: DollarSign, color: 'var(--color-status-resolved)' },
    { label: 'Avg Order Value', value: `$${(analytics?.avg_order_value || 0).toFixed(0)}`, icon: ShoppingCart, color: 'var(--color-accent-light)' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Trade Program</h2>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-xl p-5" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{kpi.label}</span>
              <kpi.icon size={16} style={{ color: kpi.color }} />
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Recent Pending Applications */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-primary)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Pending Applications</h3>
          <Link href="/trade/applications?status=pending" className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {recentApps.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>No pending applications</div>
        ) : (
          recentApps.map((app) => (
            <Link key={app.id} href={`/trade/applications/${app.id}`} className="flex items-center justify-between p-4 transition-colors" style={{ borderBottom: '1px solid var(--border-primary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{app.full_name}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{app.company_name} &middot; {app.business_type.replace('_', ' ')}</div>
              </div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {new Date(app.created_at).toLocaleDateString()}
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Link href="/trade/applications" className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ backgroundColor: 'var(--color-accent)' }}>
          Review Applications
        </Link>
        <Link href="/trade/members" className="px-4 py-2 text-sm font-medium rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
          View Members
        </Link>
        <Link href="/trade/settings" className="px-4 py-2 text-sm font-medium rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
          Program Settings
        </Link>
      </div>
    </div>
  );
}
