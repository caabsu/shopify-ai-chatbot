'use client';
import { useEffect, useState } from 'react';

interface Resource {
  id: string;
  title: string;
  description: string;
  url: string;
  type?: string;
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ResourceCard({ resource }: { resource: Resource }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e7e5e4',
      borderRadius: 12,
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
    }}>
      {resource.type && (
        <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, background: '#fafaf9', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.06em', alignSelf: 'flex-start', border: '1px solid #e7e5e4' }}>
          {resource.type}
        </span>
      )}
      <div>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1a1a1a', margin: 0, marginBottom: '0.4rem' }}>{resource.title}</h3>
        <p style={{ fontSize: '0.85rem', color: '#71717a', margin: 0, lineHeight: 1.5 }}>{resource.description}</p>
      </div>
      <a
        href={resource.url}
        target="_blank"
        rel="noopener noreferrer"
        download
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 1rem',
          background: '#fafaf9',
          border: '1px solid #e7e5e4',
          borderRadius: 8,
          fontSize: '0.85rem',
          fontWeight: 500,
          color: '#1a1a1a',
          textDecoration: 'none',
          alignSelf: 'flex-start',
          marginTop: 'auto',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#f4f4f5')}
        onMouseLeave={e => (e.currentTarget.style.background = '#fafaf9')}
      >
        <DownloadIcon />
        Download
      </a>
    </div>
  );
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/portal/resources')
      .then(r => r.json())
      .then(d => {
        setResources(Array.isArray(d) ? d : (d.resources || []));
        setLoading(false);
      })
      .catch(() => { setError('Failed to load resources.'); setLoading(false); });
  }, []);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Resources</h1>
        <p style={{ color: '#71717a', marginTop: '0.4rem', fontSize: '0.9rem' }}>
          Trade-exclusive downloads: product sheets, lookbooks, and more.
        </p>
      </div>

      {loading && <div style={{ color: '#71717a' }}>Loading resources...</div>}
      {error && <div style={{ color: '#dc2626' }}>{error}</div>}

      {!loading && !error && resources.length === 0 && (
        <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '3rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📄</div>
          <div style={{ fontWeight: 500, color: '#1a1a1a', marginBottom: '0.4rem' }}>No resources yet</div>
          <div style={{ fontSize: '0.85rem', color: '#71717a' }}>
            Trade resources haven't been configured yet. Check back soon or contact your account manager.
          </div>
        </div>
      )}

      {!loading && !error && resources.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
          {resources.map(r => <ResourceCard key={r.id} resource={r} />)}
        </div>
      )}
    </div>
  );
}
