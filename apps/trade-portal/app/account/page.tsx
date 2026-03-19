'use client';
import { useEffect, useState } from 'react';

interface AccountData {
  company_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  business_type?: string;
  website?: string;
  payment_terms?: string;
  member_since?: string;
  shopify_account_url?: string;
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={{ paddingBottom: '1.25rem', borderBottom: '1px solid #f4f4f5' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.375rem' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: value ? '#1a1a1a' : '#a1a1aa' }}>{value || '—'}</div>
    </div>
  );
}

export default function AccountPage() {
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/portal/me')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ color: '#71717a', padding: '2rem 0' }}>Loading...</div>;
  }

  if (!data) {
    return <div style={{ color: '#dc2626', padding: '2rem 0' }}>Failed to load account data.</div>;
  }

  const memberSince = data.member_since
    ? new Date(data.member_since).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : undefined;

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Account</h1>
        <p style={{ color: '#71717a', marginTop: '0.4rem', fontSize: '0.9rem' }}>
          Your trade account information.
        </p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, overflow: 'hidden' }}>
        {/* Header band */}
        <div style={{ padding: '1.25rem 1.5rem', background: '#fafaf9', borderBottom: '1px solid #e7e5e4', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 999,
            background: '#1a1a1a', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1rem', fontWeight: 700, flexShrink: 0,
          }}>
            {data.company_name?.[0]?.toUpperCase() || 'T'}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#1a1a1a' }}>{data.company_name}</div>
            <div style={{ fontSize: '0.8rem', color: '#71717a' }}>{data.email}</div>
          </div>
        </div>

        {/* Fields */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <Field label="Company name" value={data.company_name} />
          <Field label="Contact name" value={data.contact_name} />
          <Field label="Email" value={data.email} />
          <Field label="Phone" value={data.phone} />
          <Field label="Business type" value={data.business_type} />
          <Field label="Website" value={data.website} />
          <Field label="Payment terms" value={data.payment_terms} />
          <div style={{ paddingBottom: 0 }}>
            <Field label="Member since" value={memberSince} />
          </div>
        </div>
      </div>

      {/* Admin note */}
      <div style={{ marginTop: '1rem', padding: '1rem 1.25rem', background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 10, fontSize: '0.85rem', color: '#71717a', display: 'flex', gap: '0.625rem', alignItems: 'flex-start' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div>
          To update your account information, <a href="/concierge" style={{ color: '#1a1a1a', fontWeight: 500 }}>contact your account manager</a>.
          {' '}To change your password, visit your{' '}
          <a href={data.shopify_account_url || '/account'} style={{ color: '#1a1a1a', fontWeight: 500 }}>Shopify account</a>.
        </div>
      </div>
    </div>
  );
}
