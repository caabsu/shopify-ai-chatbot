'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Save, Check, Eye, Code, Send, X } from 'lucide-react';
import Link from 'next/link';

interface EmailTemplate {
  id: string;
  template_type: string;
  enabled: boolean;
  subject: string;
  body_html: string;
}

const TYPE_LABELS: Record<string, string> = {
  request: 'Review Request',
  reminder: 'Reminder',
  thank_you: 'Thank You',
};

const AVAILABLE_VARIABLES = ['customer_name', 'product_title', 'review_link', 'brand_name'];

const DEFAULT_SAMPLE_VARS: Record<string, string> = {
  customer_name: 'Jane',
  product_title: 'Aven',
  review_link: 'https://shopify-ai-chatbot-production-9ab4.up.railway.app/review?token=preview',
  brand_name: 'Outlight',
};

export default function ReviewEmailTemplateEditorPage() {
  const params = useParams();
  const router = useRouter();
  const type = params.type as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'html' | 'preview'>('html');

  const [enabled, setEnabled] = useState(true);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [originalSubject, setOriginalSubject] = useState('');
  const [originalBody, setOriginalBody] = useState('');
  const [originalEnabled, setOriginalEnabled] = useState(true);

  // Test email state
  const [showTestModal, setShowTestModal] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testProductTitle, setTestProductTitle] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [products, setProducts] = useState<Array<{ title: string; handle: string }>>([]);
  const [sendAllSending, setSendAllSending] = useState(false);
  const [sendAllResults, setSendAllResults] = useState<Record<string, { success: boolean; message: string }>>({});

  useEffect(() => {
    if (!TYPE_LABELS[type]) {
      router.replace('/reviews/emails');
      return;
    }
    Promise.all([
      fetch(`/api/reviews/emails/${type}`)
        .then((r) => { if (!r.ok) throw new Error('Not found'); return r.json(); })
        .catch(() => null),
      fetch('/api/reviews/products')
        .then((r) => r.json())
        .catch(() => ({ items: [] })),
    ]).then(([data, productsData]) => {
      if (data) {
        setEnabled(data.enabled ?? true);
        setSubject(data.subject ?? '');
        setBodyHtml(data.body_html ?? '');
        setOriginalEnabled(data.enabled ?? true);
        setOriginalSubject(data.subject ?? '');
        setOriginalBody(data.body_html ?? '');
      }
      const items = (productsData?.items ?? []) as Array<{ title: string; handle: string }>;
      setProducts(items);
      if (items.length > 0) setTestProductTitle(items[0].title);
      setLoading(false);
    });
  }, [type, router]);

  const hasChanges =
    subject !== originalSubject || bodyHtml !== originalBody || enabled !== originalEnabled;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await fetch(`/api/reviews/emails/${type}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, subject, body_html: bodyHtml }),
      });
      setOriginalSubject(subject);
      setOriginalBody(bodyHtml);
      setOriginalEnabled(enabled);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  }, [type, enabled, subject, bodyHtml]);

  async function handleSendTest() {
    if (!testEmail.includes('@')) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/reviews/emails/${type}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail, product_title: testProductTitle || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ success: true, message: `Sent to ${testEmail}` });
      } else {
        setTestResult({ success: false, message: data.error || 'Failed to send' });
      }
    } catch {
      setTestResult({ success: false, message: 'Network error' });
    }
    setTestSending(false);
  }

  const ALL_TYPES = ['request', 'reminder', 'thank_you'] as const;
  const ALL_TYPE_LABELS: Record<string, string> = {
    request: 'Request',
    reminder: 'Reminder',
    thank_you: 'Thank You',
  };

  async function handleSendAllTests() {
    if (!testEmail.includes('@')) return;
    setSendAllSending(true);
    setSendAllResults({});
    for (const t of ALL_TYPES) {
      try {
        const res = await fetch(`/api/reviews/emails/${t}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: testEmail, product_title: testProductTitle || undefined }),
        });
        const data = await res.json();
        setSendAllResults((prev) => ({
          ...prev,
          [t]: data.success
            ? { success: true, message: `${ALL_TYPE_LABELS[t]} sent` }
            : { success: false, message: data.error || 'Failed' },
        }));
      } catch {
        setSendAllResults((prev) => ({
          ...prev,
          [t]: { success: false, message: 'Network error' },
        }));
      }
    }
    setSendAllSending(false);
  }

  function renderPreview(html: string): string {
    const vars = { ...DEFAULT_SAMPLE_VARS, product_title: testProductTitle || DEFAULT_SAMPLE_VARS.product_title };
    let rendered = html;
    for (const [key, value] of Object.entries(vars)) {
      rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return rendered;
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="h-96 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/reviews/emails" className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {TYPE_LABELS[type]} Email
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Edit the {TYPE_LABELS[type]?.toLowerCase()} email template
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Enable toggle */}
          <div className="flex items-center gap-2 mr-2">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              onClick={() => setEnabled(!enabled)}
              className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0"
              style={{
                backgroundColor: enabled ? 'var(--color-accent)' : 'var(--border-primary)',
              }}
            >
              <div
                className="w-4 h-4 bg-white rounded-full absolute top-1 transition-transform"
                style={{ left: enabled ? '20px' : '4px' }}
              />
            </button>
          </div>
          {/* Send Test */}
          <button
            onClick={() => setShowTestModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <Send size={14} /> Send Test
          </button>
          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving...' : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>

      {/* Test Email Panel */}
      {showTestModal && (
        <div
          className="rounded-xl p-4 space-y-3"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {/* Row 1: Email + Product */}
          <div className="flex items-center gap-3">
            <Send size={16} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
            <div className="flex-1 flex gap-3">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="Enter email address..."
                className="flex-1 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSendTest(); }}
                autoFocus
              />
              <select
                value={testProductTitle}
                onChange={(e) => setTestProductTitle(e.target.value)}
                className="text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 flex-shrink-0"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  minWidth: '180px',
                  maxWidth: '260px',
                }}
              >
                {products.length === 0 && <option value="">No products</option>}
                {products.map((p) => (
                  <option key={p.handle} value={p.title}>{p.title}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => { setShowTestModal(false); setTestResult(null); setSendAllResults({}); }}
              className="p-1 flex-shrink-0"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Row 2: Send buttons */}
          <div className="flex items-center gap-2 pl-7">
            <button
              onClick={handleSendTest}
              disabled={testSending || !testEmail.includes('@')}
              className="px-4 py-1.5 text-sm font-medium text-white rounded-lg disabled:opacity-50 flex-shrink-0"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {testSending ? 'Sending...' : `Send ${TYPE_LABELS[type]}`}
            </button>
            <button
              onClick={handleSendAllTests}
              disabled={sendAllSending || !testEmail.includes('@')}
              className="px-4 py-1.5 text-sm font-medium rounded-lg disabled:opacity-50 flex-shrink-0 transition-colors"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              {sendAllSending ? 'Sending...' : 'Send All 3'}
            </button>

            {/* Status indicators */}
            <div className="flex items-center gap-2 ml-2">
              {testResult && (
                <span
                  className="text-xs font-medium"
                  style={{ color: testResult.success ? '#22c55e' : '#ef4444' }}
                >
                  {testResult.message}
                </span>
              )}
              {Object.entries(sendAllResults).map(([t, r]) => (
                <span
                  key={t}
                  className="text-[11px] font-medium flex items-center gap-1"
                  style={{ color: r.success ? '#22c55e' : '#ef4444' }}
                >
                  {r.success ? <Check size={10} /> : <X size={10} />}
                  {ALL_TYPE_LABELS[t]}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Editor */}
        <div className="space-y-4">
          {/* Subject */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>
              Subject Line
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {/* Body editor with tabs */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="flex" style={{ borderBottom: '1px solid var(--border-primary)' }}>
              <button
                onClick={() => setActiveTab('html')}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors"
                style={{
                  color: activeTab === 'html' ? 'var(--color-accent)' : 'var(--text-tertiary)',
                  borderBottom: activeTab === 'html' ? '2px solid var(--color-accent)' : '2px solid transparent',
                }}
              >
                <Code size={12} /> HTML
              </button>
              <button
                onClick={() => setActiveTab('preview')}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors"
                style={{
                  color: activeTab === 'preview' ? 'var(--color-accent)' : 'var(--text-tertiary)',
                  borderBottom: activeTab === 'preview' ? '2px solid var(--color-accent)' : '2px solid transparent',
                }}
              >
                <Eye size={12} /> Preview
              </button>
            </div>
            <div className="p-4">
              {activeTab === 'html' ? (
                <textarea
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  rows={18}
                  className="w-full text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 resize-y"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
              ) : (
                <div
                  className="rounded-lg p-4 text-sm min-h-[300px]"
                  style={{ backgroundColor: '#ffffff' }}
                  dangerouslySetInnerHTML={{ __html: renderPreview(bodyHtml) }}
                />
              )}
            </div>
          </div>

          {/* Variables reference */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
              Available Variables
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_VARIABLES.map((v) => (
                <span
                  key={v}
                  className="text-[10px] font-mono px-2 py-1 rounded"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-secondary)',
                  }}
                >
                  {`{{${v}}}`}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="space-y-3">
          <h3
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Preview
          </h3>
          <div
            className="rounded-xl overflow-hidden sticky top-28"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-primary)' }}>
              <p className="text-[10px] mb-1" style={{ color: 'var(--text-tertiary)' }}>Subject</p>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {renderPreview(subject)}
              </p>
            </div>
            <div className="p-4">
              <div
                className="rounded-lg p-4 text-sm"
                style={{ backgroundColor: '#ffffff', minHeight: 200 }}
                dangerouslySetInnerHTML={{ __html: renderPreview(bodyHtml) }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
