'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ExternalLink, CheckCircle, XCircle, Clock,
  User, Building2, Globe, Phone, Mail, FileText, Activity,
  Archive, Trash2,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradeApplication {
  id: string;
  created_at: string;
  updated_at: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  company_name: string;
  business_type: string;
  website?: string;
  project_description?: string;
  referral_source?: string;
  status: 'pending' | 'approved' | 'rejected' | 'archived';
  reviewed_at?: string;
  reviewed_by?: string;
  rejection_reason?: string;
  payment_terms?: string;
  full_name?: string;
  website_url?: string;
}

interface ActivityLogEntry {
  id: string;
  created_at: string;
  event_type: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}

interface DetailData {
  application: TradeApplication;
  activityLog: ActivityLogEntry[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending:  { bg: 'rgba(245,158,11,0.12)',  text: '#f59e0b' },
  approved: { bg: 'rgba(34,197,94,0.12)',   text: '#22c55e' },
  rejected: { bg: 'rgba(239,68,68,0.12)',   text: '#ef4444' },
  archived: { bg: 'rgba(148,163,184,0.12)', text: '#94a3b8' },
};

const PAYMENT_TERMS = [
  { value: 'DUE_ON_FULFILLMENT', label: 'Due on fulfillment' },
  { value: 'NET_30',             label: 'Net 30' },
  { value: 'NET_60',             label: 'Net 60' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatBusinessType(raw: string): string {
  if (!raw) return '—';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatEventType(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Row helper ────────────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
      <Icon size={14} style={{ color: 'var(--text-tertiary)', marginTop: 2, flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
          {label}
        </p>
        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [data, setData]       = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);

  // Approve state
  const [paymentTerms, setPaymentTerms] = useState('DUE_ON_FULFILLMENT');
  const [approving, setApproving]       = useState(false);

  // Reject state
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting]       = useState(false);
  const [rejectError, setRejectError]   = useState<string | null>(null);

  // Archive/Delete state
  const [archiving, setArchiving]       = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting]         = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/trade/applications/${id}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await fetch(`/api/trade/applications/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_terms: paymentTerms }),
      });
      if (res.ok) {
        setSuccess('Application approved successfully.');
        await loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        setSuccess(null);
        alert(err.detail ?? err.error ?? 'Failed to approve application.');
      }
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      setRejectError('A rejection reason is required.');
      return;
    }
    setRejectError(null);
    setRejecting(true);
    try {
      const res = await fetch(`/api/trade/applications/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (res.ok) {
        setSuccess('Application rejected.');
        setRejectReason('');
        await loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? 'Failed to reject application.');
      }
    } finally {
      setRejecting(false);
    }
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      const res = await fetch(`/api/trade/applications/${id}/archive`, { method: 'POST' });
      if (res.ok) {
        setSuccess('Application archived.');
        await loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? 'Failed to archive application.');
      }
    } finally {
      setArchiving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/trade/applications/${id}/delete`, { method: 'POST' });
      if (res.ok) {
        router.push('/trade/applications');
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? 'Failed to delete application.');
      }
    } finally {
      setDeleting(false);
    }
  }

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-5 w-36 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
          <div className="h-[480px] rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          <div className="h-[300px] rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        </div>
      </div>
    );
  }

  // ── Not found ──
  if (!data) {
    return (
      <div className="text-center py-16">
        <p className="text-sm mb-2" style={{ color: 'var(--text-tertiary)' }}>Application not found.</p>
        <Link href="/trade/applications" className="text-sm" style={{ color: 'var(--color-accent)' }}>
          Back to applications
        </Link>
      </div>
    );
  }

  const { application, activityLog } = data;
  const statusStyle = STATUS_STYLES[application.status] ?? STATUS_STYLES.pending;
  const isPending   = application.status === 'pending';
  const canManage   = application.status !== 'approved';
  const displayName = application.full_name || `${application.first_name || ''} ${application.last_name || ''}`.trim();
  const websiteUrl  = application.website_url || application.website;

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link
        href="/trade/applications"
        className="inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft size={14} />
        Back to applications
      </Link>

      {/* Success banner */}
      {success && (
        <div
          className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
          style={{
            backgroundColor: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.25)',
            color: '#22c55e',
          }}
        >
          <CheckCircle size={15} />
          {success}
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 items-start">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Application info card */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            {/* Card header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {displayName}
                </h1>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {application.company_name}
                </p>
              </div>
              <span
                className="text-xs font-semibold px-3 py-1 rounded-full capitalize"
                style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}
              >
                {application.status}
              </span>
            </div>

            {/* Fields */}
            <div className="divide-y-0">
              <InfoRow icon={User} label="Full name">
                {displayName}
              </InfoRow>

              <InfoRow icon={Mail} label="Email">
                <a
                  href={`mailto:${application.email}`}
                  style={{ color: 'var(--color-accent)' }}
                >
                  {application.email}
                </a>
              </InfoRow>

              {application.phone && (
                <InfoRow icon={Phone} label="Phone">
                  {application.phone}
                </InfoRow>
              )}

              <InfoRow icon={Building2} label="Company name">
                {application.company_name || '—'}
              </InfoRow>

              <InfoRow icon={FileText} label="Business type">
                {formatBusinessType(application.business_type)}
              </InfoRow>

              {websiteUrl && (
                <InfoRow icon={Globe} label="Website">
                  <a
                    href={websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    {websiteUrl.replace(/^https?:\/\//, '')}
                    <ExternalLink size={11} />
                  </a>
                </InfoRow>
              )}

              {application.project_description && (
                <InfoRow icon={FileText} label="Project description">
                  <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {application.project_description}
                  </p>
                </InfoRow>
              )}

              {application.referral_source && (
                <InfoRow icon={Activity} label="Referral source">
                  {application.referral_source}
                </InfoRow>
              )}

              <InfoRow icon={Clock} label="Submitted">
                {formatDate(application.created_at)}
              </InfoRow>
            </div>
          </div>

          {/* Activity log card */}
          <div
            className="rounded-xl"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              overflow: 'hidden',
            }}
          >
            <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
              <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Activity size={14} />
                Activity log
              </h3>
            </div>

            {activityLog.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No activity recorded yet.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ '--divide-color': 'var(--border-secondary)' } as React.CSSProperties}>
                {activityLog.map((entry) => (
                  <div key={entry.id} className="px-5 py-3 flex items-start gap-3">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}
                    >
                      <Activity size={11} style={{ color: 'var(--color-accent)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {formatEventType(entry.event_type)}
                      </p>
                      {entry.actor && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                          by {entry.actor}
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDate(entry.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right column (actions sidebar) ─────────────────────────────── */}
        <div className="space-y-4">
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Actions
            </h3>

            {isPending ? (
              <div className="space-y-5">

                {/* Approve section */}
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Payment terms
                  </p>
                  <select
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 mb-3"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-primary)',
                      color: 'var(--text-primary)',
                      '--tw-ring-color': 'var(--color-accent)',
                    } as React.CSSProperties}
                  >
                    {PAYMENT_TERMS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleApprove}
                    disabled={approving}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: '#16a34a' }}
                  >
                    <CheckCircle size={14} />
                    {approving ? 'Approving…' : 'Approve application'}
                  </button>
                </div>

                {/* Divider */}
                <div style={{ borderTop: '1px solid var(--border-secondary)' }} />

                {/* Reject section */}
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Rejection reason <span style={{ color: '#ef4444' }}>*</span>
                  </p>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => { setRejectReason(e.target.value); setRejectError(null); }}
                    rows={3}
                    placeholder="Explain why this application is being rejected…"
                    className="w-full text-sm rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 mb-1"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: rejectError ? '1px solid #ef4444' : '1px solid var(--border-primary)',
                      color: 'var(--text-primary)',
                      '--tw-ring-color': '#ef4444',
                    } as React.CSSProperties}
                  />
                  {rejectError && (
                    <p className="text-xs mb-2" style={{ color: '#ef4444' }}>{rejectError}</p>
                  )}
                  <button
                    onClick={handleReject}
                    disabled={rejecting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: '#dc2626' }}
                  >
                    <XCircle size={14} />
                    {rejecting ? 'Rejecting…' : 'Reject application'}
                  </button>
                </div>

              </div>
            ) : (
              /* Non-pending: show review outcome */
              <div className="space-y-3">
                <div
                  className="flex items-center gap-2 px-4 py-3 rounded-lg"
                  style={{
                    backgroundColor: statusStyle.bg,
                    border: `1px solid color-mix(in srgb, ${statusStyle.text} 25%, transparent)`,
                  }}
                >
                  {application.status === 'approved' ? (
                    <CheckCircle size={15} style={{ color: statusStyle.text, flexShrink: 0 }} />
                  ) : (
                    <XCircle size={15} style={{ color: statusStyle.text, flexShrink: 0 }} />
                  )}
                  <p className="text-sm font-medium capitalize" style={{ color: statusStyle.text }}>
                    Application {application.status}
                  </p>
                </div>

                {application.reviewed_at && (
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    Reviewed {formatDate(application.reviewed_at)}
                    {application.reviewed_by && (
                      <span> by {application.reviewed_by}</span>
                    )}
                  </p>
                )}

                {application.status === 'approved' && application.payment_terms && (
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Payment terms: </span>
                    {PAYMENT_TERMS.find((t) => t.value === application.payment_terms)?.label ?? application.payment_terms}
                  </div>
                )}

                {application.status === 'rejected' && application.rejection_reason && (
                  <div
                    className="px-3 py-2.5 rounded-lg text-xs"
                    style={{
                      backgroundColor: 'rgba(239,68,68,0.06)',
                      border: '1px solid rgba(239,68,68,0.15)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span className="block font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                      Reason:
                    </span>
                    {application.rejection_reason}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Archive / Delete actions */}
          {canManage && (
            <div
              className="rounded-xl p-5"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
                Manage
              </h3>
              <div className="space-y-2">
                {application.status !== 'archived' && (
                  <button
                    onClick={handleArchive}
                    disabled={archiving}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
                    style={{
                      color: 'var(--text-secondary)',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-primary)',
                    }}
                  >
                    <Archive size={14} />
                    {archiving ? 'Archiving...' : 'Archive application'}
                  </button>
                )}

                {showDeleteConfirm ? (
                  <div
                    className="p-3 rounded-lg space-y-2"
                    style={{
                      backgroundColor: 'rgba(239,68,68,0.06)',
                      border: '1px solid rgba(239,68,68,0.2)',
                    }}
                  >
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Permanently delete this application? This cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg"
                        style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg text-white disabled:opacity-50"
                        style={{ backgroundColor: '#dc2626' }}
                      >
                        {deleting ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
                    style={{
                      color: '#ef4444',
                      backgroundColor: 'rgba(239,68,68,0.06)',
                      border: '1px solid rgba(239,68,68,0.15)',
                    }}
                  >
                    <Trash2 size={14} />
                    Delete application
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
