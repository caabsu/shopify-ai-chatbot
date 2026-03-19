'use client';
import { useEffect, useState } from 'react';

interface Order {
  id: string;
  order_number: string;
  created_at: string;
  line_items_summary: string;
  total_price: string;
  financial_status: string;
  fulfillment_status: string;
}

function StatusBadge({ status, type }: { status: string; type?: 'financial' | 'fulfillment' }) {
  const s = (status || '').toLowerCase();
  let bg = '#f4f4f5', color = '#71717a';
  if (s === 'paid') { bg = '#f0fdf4'; color = '#16a34a'; }
  if (s === 'pending') { bg = '#fefce8'; color = '#ca8a04'; }
  if (s === 'refunded' || s === 'voided') { bg = '#fef2f2'; color = '#dc2626'; }
  if (s === 'fulfilled') { bg = '#eff6ff'; color = '#2563eb'; }
  if (s === 'unfulfilled') { bg = '#fefce8'; color = '#ca8a04'; }
  if (s === 'partially_fulfilled') { bg = '#fff7ed'; color = '#ea580c'; }
  return (
    <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 500, background: bg, color }}>
      {status ? status.replace(/_/g, ' ') : '—'}
    </span>
  );
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/portal/orders')
      .then(r => r.json())
      .then(d => {
        setOrders(Array.isArray(d) ? d : (d.orders || []));
        setLoading(false);
      })
      .catch(() => { setError('Failed to load orders.'); setLoading(false); });
  }, []);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Orders</h1>
        <p style={{ color: '#71717a', marginTop: '0.4rem', fontSize: '0.9rem' }}>Your complete B2B order history.</p>
      </div>

      {loading && <div style={{ color: '#71717a' }}>Loading orders...</div>}
      {error && <div style={{ color: '#dc2626' }}>{error}</div>}

      {!loading && !error && (
        <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, overflow: 'hidden' }}>
          {orders.length === 0 ? (
            <div style={{ padding: '3rem 2rem', textAlign: 'center', color: '#71717a' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📦</div>
              <div style={{ fontWeight: 500, marginBottom: '0.3rem' }}>No orders yet</div>
              <div style={{ fontSize: '0.85rem' }}>Your orders will appear here after your first purchase.</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fafaf9', borderBottom: '1px solid #e7e5e4' }}>
                  {['Order #', 'Date', 'Items', 'Total', 'Payment', 'Fulfillment'].map(h => (
                    <th key={h} style={{ padding: '0.75rem 1.25rem', textAlign: 'left', fontSize: '0.75rem', color: '#71717a', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order, i) => (
                  <tr
                    key={order.id}
                    style={{
                      borderTop: i === 0 ? 'none' : '1px solid #f4f4f5',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fafaf9')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '0.875rem 1.25rem', fontSize: '0.85rem', fontWeight: 600, color: '#1a1a1a' }}>#{order.order_number}</td>
                    <td style={{ padding: '0.875rem 1.25rem', fontSize: '0.85rem', color: '#71717a', whiteSpace: 'nowrap' }}>{new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                    <td style={{ padding: '0.875rem 1.25rem', fontSize: '0.85rem', color: '#52525b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.line_items_summary || '—'}</td>
                    <td style={{ padding: '0.875rem 1.25rem', fontSize: '0.85rem', fontWeight: 500, whiteSpace: 'nowrap' }}>{order.total_price}</td>
                    <td style={{ padding: '0.875rem 1.25rem' }}><StatusBadge status={order.financial_status} type="financial" /></td>
                    <td style={{ padding: '0.875rem 1.25rem' }}><StatusBadge status={order.fulfillment_status} type="fulfillment" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
