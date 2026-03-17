'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface BrandDesign {
  name: string;
  slug: string;
  design: {
    accentColor: string;
    bgColor: string;
    bgGradientTo: string;
    headingFont: string;
    bodyFont: string;
    fontLink: string;
  };
}

export default function BrandLoginPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;

  const [brand, setBrand] = useState<BrandDesign | null>(null);
  const [agentId, setAgentId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loginMode, setLoginMode] = useState<'admin' | 'agent'>('agent');

  useEffect(() => {
    fetch(`/api/auth/brands/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then((data: BrandDesign) => setBrand(data))
      .catch(() => setNotFound(true));
  }, [slug]);

  // Inject Google Fonts
  useEffect(() => {
    if (!brand?.design.fontLink) return;
    if (document.getElementById('brand-login-fonts')) return;
    const link = document.createElement('link');
    link.id = 'brand-login-fonts';
    link.rel = 'stylesheet';
    link.href = brand.design.fontLink;
    document.head.appendChild(link);
  }, [brand]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const body: Record<string, string> = { brandSlug: slug, password };
      if (loginMode === 'agent' && agentId) {
        body.agentId = agentId;
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid credentials');
        return;
      }

      // Route based on role
      if (data.role === 'agent') {
        router.push('/agent/tickets');
      } else {
        router.push('/overview');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Brand not found</h1>
          <p className="text-sm text-gray-500 mb-4">The portal you&apos;re looking for doesn&apos;t exist.</p>
          <a href="/login" className="text-sm text-blue-600 hover:underline">Back to portal selection</a>
        </div>
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f5f0eb' }}>
        <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { accentColor, bgColor, bgGradientTo, headingFont, bodyFont } = brand.design;

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background: `linear-gradient(135deg, ${bgColor} 0%, ${bgGradientTo} 100%)`,
        fontFamily: bodyFont || undefined,
      }}
    >
      <div className="w-full max-w-sm mx-4">
        <div
          className="rounded-2xl shadow-lg border p-8"
          style={{
            backgroundColor: 'rgba(255,255,255,0.92)',
            borderColor: `${accentColor}20`,
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Brand identity */}
          <div className="text-center mb-6">
            <h1
              className="text-2xl font-bold tracking-tight mb-1"
              style={{ fontFamily: headingFont || undefined, color: accentColor }}
            >
              {brand.name}
            </h1>
            <p className="text-xs uppercase tracking-widest" style={{ color: `${accentColor}99` }}>
              Support Hub
            </p>
          </div>

          {/* Login mode tabs */}
          <div className="flex rounded-lg overflow-hidden mb-6" style={{ border: `1px solid ${accentColor}25` }}>
            <button
              type="button"
              onClick={() => { setLoginMode('agent'); setError(''); }}
              className="flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors"
              style={{
                backgroundColor: loginMode === 'agent' ? accentColor : 'transparent',
                color: loginMode === 'agent' ? '#fff' : `${accentColor}88`,
              }}
            >
              Agent
            </button>
            <button
              type="button"
              onClick={() => { setLoginMode('admin'); setError(''); }}
              className="flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors"
              style={{
                backgroundColor: loginMode === 'admin' ? accentColor : 'transparent',
                color: loginMode === 'admin' ? '#fff' : `${accentColor}88`,
              }}
            >
              Admin
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {loginMode === 'agent' && (
              <div>
                <label
                  className="block text-xs font-medium mb-1.5 uppercase tracking-wider"
                  style={{ color: `${accentColor}cc` }}
                >
                  Agent ID
                </label>
                <input
                  type="text"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 transition-shadow"
                  style={{
                    borderColor: `${accentColor}30`,
                    color: '#1a1a1a',
                    // @ts-expect-error CSS custom property
                    '--tw-ring-color': `${accentColor}60`,
                  }}
                  placeholder="Your agent ID"
                  required
                  autoFocus
                />
              </div>
            )}

            <div>
              <label
                className="block text-xs font-medium mb-1.5 uppercase tracking-wider"
                style={{ color: `${accentColor}cc` }}
              >
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 transition-shadow"
                style={{
                  borderColor: `${accentColor}30`,
                  color: '#1a1a1a',
                  // @ts-expect-error CSS custom property
                  '--tw-ring-color': `${accentColor}60`,
                }}
                placeholder={loginMode === 'admin' ? 'Admin password' : 'Your password'}
                required
                autoFocus={loginMode === 'admin'}
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: accentColor }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center mt-6">
          <a
            href="/login"
            className="text-xs hover:underline transition-colors"
            style={{ color: `${accentColor}88` }}
          >
            Switch portal
          </a>
        </p>
      </div>
    </div>
  );
}
