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
  body_text: string;
}

const TYPE_LABELS: Record<string, string> = {
  confirmation: 'Confirmation',
  approved: 'Approved (with prepaid label)',
  approved_no_label: 'Approved (self-ship)',
  approved_no_return: 'Approved (No Return)',
  denied: 'Denied',
  refunded: 'Refunded',
};

const AVAILABLE_VARIABLES: Record<string, string[]> = {
  confirmation: ['greeting', 'ref_id', 'order_number', 'items', 'brand_name'],
  approved: ['greeting', 'ref_id', 'order_number', 'items', 'brand_name', 'label_section', 'label_url', 'tracking_number'],
  approved_no_label: ['greeting', 'ref_id', 'order_number', 'items', 'brand_name', 'warehouse_address'],
  approved_no_return: ['greeting', 'ref_id', 'order_number', 'items', 'brand_name', 'refund_amount'],
  denied: ['greeting', 'ref_id', 'order_number', 'items', 'brand_name', 'denial_reason'],
  refunded: ['greeting', 'ref_id', 'order_number', 'items', 'brand_name', 'refund_amount'],
};

const SAMPLE_VARS: Record<string, string> = {
  greeting: 'Hi Jane,',
  ref_id: 'A1B2C3D4',
  order_number: '#1042',
  items: 'Classic Tee (x1), Slim Joggers (x1)',
  brand_name: 'Outlight',
  label_section: '<div style="background:#f4f0eb;padding:16px 20px;margin:16px 0;"><p style="margin:0 0 8px;font-weight:500;color:#131314;">Prepaid Return Label</p><a href="#" style="display:inline-block;padding:10px 24px;background:#C5A059;color:#131314;text-decoration:none;font-size:13px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">Download Label</a><p style="margin:12px 0 0;font-size:12px;color:#71757a;">Tracking: TEST123456789</p></div>',
  label_url: '#',
  tracking_number: 'TEST123456789',
  warehouse_address: 'Outlight - SWT1<br>Red Stag Fulfillment<br>500 Red Stag Way<br>Sweetwater, TN 37874',
  denial_reason: 'The item is outside the 30-day return window.',
  refund_amount: '$79.99',
};

export default function EmailTemplateEditorPage() {
  const params = useParams();
  const router = useRouter();
  const type = params.type as string;

  const [template, setTemplate] = useState<EmailTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'html' | 'text'>('html');

  // Test email state
  const [showTestModal, setShowTestModal] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Editable fields
  const [enabled, setEnabled] = useState(true);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [bodyText, setBodyText] = useState('');

  useEffect(() => {
    if (!TYPE_LABELS[type]) {
      router.replace('/returns/emails');
      return;
    }
    fetch(`/api/returns/emails/${type}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then((data) => {
        setTemplate(data);
        setEnabled(data.enabled);
        setSubject(data.subject);
        setBodyHtml(data.body_html);
        setBodyText(data.body_text);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [type, router]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    await fetch(`/api/returns/emails/${type}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, subject, body_html: bodyHtml, body_text: bodyText }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [type, enabled, subject, bodyHtml, bodyText]);

  async function handleSendTest() {
    if (!testEmail.includes('@')) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/returns/emails/${type}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ success: true, message: `Test email sent to ${testEmail}` });
      } else {
        setTestResult({ success: false, message: data.error || 'Failed to send' });
      }
    } catch {
      setTestResult({ success: false, message: 'Network error' });
    }
    setTestSending(false);
  }

  function renderPreview(html: string): string {
    let rendered = html;
    for (const [key, value] of Object.entries(SAMPLE_VARS)) {
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

  const vars = AVAILABLE_VARIABLES[type] || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/returns/emails" className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>
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
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving...' : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>

      {/* Test Email Modal */}
      {showTestModal && (
        <div
          className="rounded-xl p-4 flex items-center gap-3"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <Send size={16} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
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
          <button
            onClick={handleSendTest}
            disabled={testSending || !testEmail.includes('@')}
            className="px-4 py-1.5 text-sm font-medium text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {testSending ? 'Sending...' : 'Send'}
          </button>
          <button
            onClick={() => { setShowTestModal(false); setTestResult(null); }}
            className="p-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <X size={16} />
          </button>
          {testResult && (
            <span
              className="text-xs font-medium"
              style={{ color: testResult.success ? '#22c55e' : '#ef4444' }}
            >
              {testResult.message}
            </span>
          )}
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
                onClick={() => setActiveTab('text')}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors"
                style={{
                  color: activeTab === 'text' ? 'var(--color-accent)' : 'var(--text-tertiary)',
                  borderBottom: activeTab === 'text' ? '2px solid var(--color-accent)' : '2px solid transparent',
                }}
              >
                <Eye size={12} /> Plain Text
              </button>
            </div>
            <div className="p-4">
              {activeTab === 'html' ? (
                <textarea
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  rows={16}
                  className="w-full text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 resize-y"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
              ) : (
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={16}
                  className="w-full text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 resize-y"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
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
              {vars.map((v) => (
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
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Preview
          </h3>
          <div
            className="rounded-xl overflow-hidden sticky top-28"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            {/* Subject preview */}
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-primary)' }}>
              <p className="text-[10px] mb-1" style={{ color: 'var(--text-tertiary)' }}>Subject</p>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {renderPreview(subject)}
              </p>
            </div>
            {/* Body preview */}
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
