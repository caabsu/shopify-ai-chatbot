'use client';
import { useState } from 'react';

const CATEGORIES = [
  { value: 'general', label: 'General inquiry' },
  { value: 'order_issue', label: 'Order issue' },
  { value: 'product_inquiry', label: 'Product inquiry' },
  { value: 'project_consultation', label: 'Project consultation' },
];

export default function ConciergePage() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('general');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/portal/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message, category }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      setSuccess(true);
    } catch {
      setError('Failed to send message. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div style={{ maxWidth: 600 }}>
        <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '3rem 2.5rem', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, background: '#f0fdf4', borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: '#1a1a1a', marginBottom: '0.5rem' }}>Message sent</h2>
          <p style={{ color: '#71717a', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Our concierge team will get back to you within 1 business day.
          </p>
          <button
            onClick={() => { setSuccess(false); setSubject(''); setMessage(''); setCategory('general'); }}
            style={{ padding: '0.625rem 1.25rem', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer' }}
          >
            Send another message
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Concierge</h1>
        <p style={{ color: '#71717a', marginTop: '0.4rem', fontSize: '0.9rem' }}>
          Our trade concierge team is here for personalized support.
        </p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 12, padding: '2rem' }}>
        <form onSubmit={handleSubmit}>
          {/* Category */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              Category
            </label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{ width: '100%', padding: '0.625rem 0.875rem', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: '0.9rem', color: '#1a1a1a', background: '#fff', outline: 'none', appearance: 'none' }}
            >
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Brief subject of your message"
              style={{ width: '100%', padding: '0.625rem 0.875rem', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: '0.9rem', color: '#1a1a1a', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {/* Message */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              Message
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Describe how we can help you..."
              rows={6}
              style={{ width: '100%', padding: '0.625rem 0.875rem', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: '0.9rem', color: '#1a1a1a', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
          </div>

          {error && (
            <div style={{ padding: '0.75rem 1rem', marginBottom: '1.25rem', borderRadius: 8, background: '#fef2f2', color: '#dc2626', fontSize: '0.85rem', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: submitting ? '#a1a1aa' : '#1a1a1a',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {submitting ? 'Sending...' : 'Send message'}
          </button>
        </form>
      </div>

      {/* Info callout */}
      <div style={{ marginTop: '1.25rem', background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 10, padding: '1rem 1.25rem', fontSize: '0.85rem', color: '#71717a', display: 'flex', gap: '0.625rem', alignItems: 'flex-start' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        Response time is typically within 1 business day. For urgent order issues, please call us directly.
      </div>
    </div>
  );
}
