'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface MemberData {
  company_name: string;
  contact_name: string;
  email: string;
  discount_code: string;
  payment_terms: string;
  member_since: string;
  total_orders: number;
  recent_orders: Order[];
}

interface Order {
  id: string;
  order_number: string;
  created_at: string;
  total_price: string;
  financial_status: string;
  fulfillment_status: string;
  line_items_summary: string;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e7e5e4',
      borderRadius: 12,
      padding: '1.25rem 1.5rem',
      flex: 1,
    }}>
      <div style={{ fontSize: '0.75rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#1a1a1a' }}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  let bg = '#f4f4f5', color = '#71717a';
  if (s === 'paid' || s === 'fulfilled') { bg = '#f0fdf4'; color = '#16a34a'; }
  if (s === 'pending' || s === 'unfulfilled') { bg = '#fefce8'; color = '#ca8a04'; }
  if (s === 'refunded' || s === 'cancelled') { bg = '#fef2f2'; color = '#dc2626'; }
  return (
    <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 500, background: bg, color }}>
      {status || '—'}
    </span>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<MemberData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/portal/me')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function copyCode() {
    if (!data?.discount_code) return;
    navigator.clipboard.writeText(data.discount_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return <div style={{ color: '#71717a', padding: '2rem 0' }}>Loading...</div>;
  }

  if (!data) {
    return <div style={{ color: '#dc2626', padding: '2rem 0' }}>Failed to load dashboard data.</div>;
  }

  const memberSince = data.member_since
    ? new Date(data.member_since).getFullYear()
    : '—';

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>
          Welcome back, {data.company_name}
        </h1>
        <p style={{ color: '#71717a', marginTop: '0.4rem', fontSize: '0.9rem' }}>
          Here's your trade account overview.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <StatCard label="Total orders" value={data.total_orders ?? 0} />
        <StatCard label="Member since" value={memberSince} />
        <StatCard label="Payment terms" value={data.payment_terms || 'Standard'} />
      </div>

      {/* Discount code */}
      <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Your trade discount code</div>
          <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 600, color: '#1a1a1a', letterSpacing: '0.1em' }}>
            {data.discount_code || 'N/A'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={copyCode}
            style={{
              padding: '0.5rem 1rem',
              background: copied ? '#f0fdf4' : '#1a1a1a',
              color: copied ? '#16a34a' : '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {copied ? 'Copied!' : 'Copy code'}
          </button>
          <a
            href="https://outlight.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: '0.5rem 1rem', background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: '0.85rem', fontWeight: 500, color: '#1a1a1a', textDecoration: 'none' }}
          >
            Shop now
          </a>
        </div>
      </div>

      {/* Recent orders */}
      <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, marginBottom: '1.5rem', overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #f4f4f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Recent orders</span>
          <Link href="/orders" style={{ fontSize: '0.8rem', color: '#71717a', textDecoration: 'none' }}>View all</Link>
        </div>
        {data.recent_orders && data.recent_orders.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fafaf9' }}>
                {['Order', 'Date', 'Items', 'Total', 'Status'].map(h => (
                  <th key={h} style={{ padding: '0.625rem 1.5rem', textAlign: 'left', fontSize: '0.75rem', color: '#71717a', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.recent_orders.slice(0, 3).map((order, i) => (
                <tr key={order.id} style={{ borderTop: '1px solid #f4f4f5', background: i % 2 === 0 ? '#fff' : '#fafaf9' }}>
                  <td style={{ padding: '0.75rem 1.5rem', fontSize: '0.85rem', fontWeight: 500 }}>#{order.order_number}</td>
                  <td style={{ padding: '0.75rem 1.5rem', fontSize: '0.85rem', color: '#71717a' }}>{new Date(order.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '0.75rem 1.5rem', fontSize: '0.85rem', color: '#71717a', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.line_items_summary}</td>
                  <td style={{ padding: '0.75rem 1.5rem', fontSize: '0.85rem', fontWeight: 500 }}>{order.total_price}</td>
                  <td style={{ padding: '0.75rem 1.5rem' }}><StatusBadge status={order.financial_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '2rem 1.5rem', color: '#71717a', fontSize: '0.9rem' }}>No recent orders.</div>
        )}
      </div>

      {/* Concierge CTA */}
      <div style={{
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2a2520 100%)',
        borderRadius: 12,
        padding: '1.5rem 2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
      }}>
        <div>
          <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.3rem' }}>Need personalized help?</div>
          <div style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>Our trade concierge team is ready to assist with orders, products, and projects.</div>
        </div>
        <Link
          href="/concierge"
          style={{
            padding: '0.625rem 1.25rem',
            background: '#c8a96e',
            color: '#1a1a1a',
            borderRadius: 8,
            textDecoration: 'none',
            fontSize: '0.85rem',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          Contact concierge
        </Link>
      </div>
    </div>
  );
}
