'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const errorMessages: Record<string, string> = {
    NOT_MEMBER: 'You are not a trade program member. Apply at outlight.com/pages/trade-program',
    SUSPENDED: 'Your trade account is suspended. Contact us for assistance.',
    REVOKED: 'Your trade account has been revoked.',
    token_failed: 'Authentication failed. Please try again.',
    auth_failed: 'Could not verify your account. Please try again.',
    unknown: 'Something went wrong. Please try again.',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafaf9', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 400, width: '100%', padding: '3rem 2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem', color: '#1a1a1a' }}>Outlight Trade Portal</h1>
        <p style={{ color: '#71717a', marginBottom: '2rem', fontSize: '0.9rem' }}>Sign in to access your trade account</p>
        {error && (
          <div style={{ padding: '0.75rem 1rem', marginBottom: '1.5rem', borderRadius: 8, background: '#fef2f2', color: '#dc2626', fontSize: '0.85rem', border: '1px solid #fecaca' }}>
            {errorMessages[error] || errorMessages.unknown}
          </div>
        )}
        <a href="/api/auth/login" style={{ display: 'inline-block', padding: '0.75rem 2rem', background: '#1a1a1a', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>
          Sign in with Shopify
        </a>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense><LoginContent /></Suspense>
  );
}
