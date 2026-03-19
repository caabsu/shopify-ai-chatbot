'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, User, Mail, Phone, Building2, Globe, Calendar,
  ShoppingCart, DollarSign, CreditCard, Activity, CheckCircle,
  AlertTriangle, XCircle, ChevronDown, Save,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface TradeMemberDetail {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  company_name: string | null;
  business_type: string | null;
  website: string | null;
  status: string;
  member_type: string;
  payment_terms: string | null;
  notes: string | null;
  orders_count: number;
  total_spent: number;
  approved_at: string;
  created_at: string;
  updated_at: string;
}

interface ActivityEvent {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface MemberDetailResponse {
  member: TradeMemberDetail;
  activity_log: ActivityEvent[];
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', label: 'Active' },
  suspended: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', label: 'Suspended' },
  revoked: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', label: 'Revoked' },
};

const PAYMENT_TERMS_OPTIONS = [
  { value: 'DUE_ON_FULFILLMENT', label: 'Due on fulfillment' },
  { value: 'NET_30', label: 'Net 30' },
  { value: 'NET_60', label: 'Net 60' },
];

function formatCurrency(cents: number): string {
  const dollars = Math.round(cents / 100);
  return '$' + dollars.toLocaleString('en-US');
}

function getEventIcon(eventType: string) {
  if (eventType.includes('approved') || eventType.includes('activated') || eventType.includes('reactivated')) {
    return { icon: CheckCircle, color: '#22c55e' };
  }
  if (eventType.includes('suspended')) {
    return { icon: AlertTriangle, color: '#f59e0b' };
  }
  if (eventType.includes('revoked')) {
    return { icon: XCircle, color: '#ef4444' };
  }
  return { icon: Activity, color: 'var(--text-tertiary)' };
}

export default function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<MemberDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Status action state
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Payment terms state
  const [paymentTerms, setPaymentTerms] = useState<string>('DUE_ON_FULFILLMENT');
  const [paymentTermsSaving, setPaymentTermsSaving] = useState(false);
  const [paymentTermsDirty, setPaymentTermsDirty] = useState(false);

  // Notes state
  const [notes, setNotes] = useState<string>('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trade/members/${id}`);
      const json: MemberDetailResponse = await res.json();
      setData(json);
      setPaymentTerms(json.member.payment_terms ?? 'DUE_ON_FULFILLMENT');
      setNotes(json.member.notes ?? '');
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [id]);

  async function patchMember(updates: Record<string, unknown>) {
    const res = await fetch(`/api/trade/members/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update member');
    return res.json();
  }

  async function handleStatusAction(action: 'suspend' | 'reactivate' | 'revoke') {
    setStatusSaving(true);
    setStatusMessage(null);
    try {
      const statusMap = {
        suspend: 'suspended',
        reactivate: 'active',
        revoke: 'revoked',
      };
      await patchMember({ status: statusMap[action] });
      setStatusMessage({ type: 'success', text: `Member ${action === 'reactivate' ? 'reactivated' : action + 'd'} successfully.` });
      setConfirmAction(null);
      await loadData();
    } catch {
      setStatusMessage({ type: 'error', text: 'Failed to update status. Please try again.' });
    }
    setStatusSaving(false);
  }

  async function handleSavePaymentTerms() {
    setPaymentTermsSaving(true);
    try {
      await patchMember({ payment_terms: paymentTerms });
      setPaymentTermsDirty(false);
      await loadData();
    } catch {
      // ignore
    }
    setPaymentTermsSaving(false);
  }

  async function handleSaveNotes() {
    setNotesSaving(true);
    try {
      await patchMember({ notes });
      setNotesDirty(false);
      await loadData();
    } catch {
      // ignore
    }
    setNotesSaving(false);
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 w-40 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-4">
            <div className="h-48 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
            <div className="h-24 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
            <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          </div>
          <div className="space-y-4">
            <div className="h-40 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
            <div className="h-28 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
            <div className="h-36 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p style={{ color: 'var(--text-tertiary)' }}>Member not found.</p>
        <Link href="/trade/members" className="text-sm mt-2 inline-block" style={{ color: 'var(--color-accent)' }}>
          Back to members
        </Link>
      </div>
    );
  }

  const { member, activity_log } = data;
  const statusStyle = STATUS_STYLES[member.status] ?? { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af', label: member.status };

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link
        href="/trade/members"
        className="inline-flex items-center gap-1.5 text-sm transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft size={14} /> Back to members
      </Link>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Left column */}
        <div className="space-y-4">
          {/* Member profile card */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-4">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold flex-shrink-0"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                    color: 'var(--color-accent)',
                  }}
                >
                  {(member.customer_name || member.customer_email || '?').charAt(0).toUpperCase()}
                </div>
                <div>
                  <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {member.customer_name}
                  </h1>
                  <span
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: statusStyle.bg,
                      color: statusStyle.text,
                    }}
                  >
                    {statusStyle.label}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-2.5">
                <Mail size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{member.customer_email}</span>
              </div>

              {member.customer_phone && (
                <div className="flex items-center gap-2.5">
                  <Phone size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{member.customer_phone}</span>
                </div>
              )}

              {member.company_name && (
                <div className="flex items-center gap-2.5">
                  <Building2 size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{member.company_name}</span>
                </div>
              )}

              {member.business_type && (
                <div className="flex items-center gap-2.5">
                  <User size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  <span className="text-sm capitalize" style={{ color: 'var(--text-secondary)' }}>
                    {member.business_type.replace(/_/g, ' ')}
                  </span>
                </div>
              )}

              {member.website && (
                <div className="flex items-center gap-2.5">
                  <Globe size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  <a
                    href={member.website.startsWith('http') ? member.website : `https://${member.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm truncate hover:underline"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    {member.website}
                  </a>
                </div>
              )}

              <div className="flex items-center gap-2.5">
                <Calendar size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Member since {formatDate(member.approved_at)}
                </span>
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div
              className="rounded-xl p-4 flex flex-col gap-1"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div className="flex items-center gap-2">
                <ShoppingCart size={13} style={{ color: 'var(--text-tertiary)' }} />
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  Orders
                </span>
              </div>
              <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {member.orders_count}
              </span>
            </div>

            <div
              className="rounded-xl p-4 flex flex-col gap-1"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div className="flex items-center gap-2">
                <DollarSign size={13} style={{ color: 'var(--text-tertiary)' }} />
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  Total spent
                </span>
              </div>
              <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {formatCurrency(member.total_spent)}
              </span>
            </div>

            <div
              className="rounded-xl p-4 flex flex-col gap-1"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div className="flex items-center gap-2">
                <CreditCard size={13} style={{ color: 'var(--text-tertiary)' }} />
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  Payment terms
                </span>
              </div>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {PAYMENT_TERMS_OPTIONS.find((o) => o.value === member.payment_terms)?.label ?? member.payment_terms ?? '—'}
              </span>
            </div>
          </div>

          {/* Activity log */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
              <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Activity size={14} /> Activity log
              </h3>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border-secondary)' }}>
              {activity_log.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                  No activity recorded yet.
                </p>
              ) : (
                activity_log.map((event) => {
                  const { icon: EventIcon, color } = getEventIcon(event.event_type);
                  return (
                    <div key={event.id} className="flex items-start gap-3 px-4 py-3">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
                      >
                        <EventIcon size={13} style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                          {event.description}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                          {formatDate(event.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right column: actions */}
        <div className="space-y-4">
          {/* Status management */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Membership status
            </h3>

            {statusMessage && (
              <div
                className="text-xs px-3 py-2 rounded-lg mb-3"
                style={{
                  backgroundColor: statusMessage.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  color: statusMessage.type === 'success' ? '#22c55e' : '#ef4444',
                  border: `1px solid ${statusMessage.type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}
              >
                {statusMessage.text}
              </div>
            )}

            {member.status === 'active' && (
              <div className="space-y-2">
                {/* Suspend */}
                {confirmAction === 'suspend' ? (
                  <div className="space-y-1.5">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Confirm suspending this member?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleStatusAction('suspend')}
                        disabled={statusSaving}
                        className="flex-1 text-xs px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                        style={{ backgroundColor: 'rgba(245,158,11,0.15)', color: '#d97706' }}
                      >
                        {statusSaving ? 'Saving...' : 'Confirm suspend'}
                      </button>
                      <button
                        onClick={() => setConfirmAction(null)}
                        className="text-xs px-3 py-2 rounded-lg transition-colors"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmAction('suspend')}
                    className="w-full text-xs px-3 py-2 rounded-lg font-medium text-left flex items-center gap-2 transition-colors"
                    style={{
                      backgroundColor: 'rgba(245,158,11,0.08)',
                      color: '#d97706',
                      border: '1px solid rgba(245,158,11,0.2)',
                    }}
                  >
                    <AlertTriangle size={12} /> Suspend membership
                  </button>
                )}

                {/* Revoke */}
                {confirmAction === 'revoke' ? (
                  <div className="space-y-1.5">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Confirm revoking this membership? This cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleStatusAction('revoke')}
                        disabled={statusSaving}
                        className="flex-1 text-xs px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                        style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                      >
                        {statusSaving ? 'Saving...' : 'Confirm revoke'}
                      </button>
                      <button
                        onClick={() => setConfirmAction(null)}
                        className="text-xs px-3 py-2 rounded-lg transition-colors"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmAction('revoke')}
                    className="w-full text-xs px-3 py-2 rounded-lg font-medium text-left flex items-center gap-2 transition-colors"
                    style={{
                      backgroundColor: 'rgba(239,68,68,0.08)',
                      color: '#ef4444',
                      border: '1px solid rgba(239,68,68,0.2)',
                    }}
                  >
                    <XCircle size={12} /> Revoke membership
                  </button>
                )}
              </div>
            )}

            {member.status === 'suspended' && (
              <div className="space-y-2">
                {/* Reactivate */}
                {confirmAction === 'reactivate' ? (
                  <div className="space-y-1.5">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Confirm reactivating this member?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleStatusAction('reactivate')}
                        disabled={statusSaving}
                        className="flex-1 text-xs px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                        style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#16a34a' }}
                      >
                        {statusSaving ? 'Saving...' : 'Confirm reactivate'}
                      </button>
                      <button
                        onClick={() => setConfirmAction(null)}
                        className="text-xs px-3 py-2 rounded-lg transition-colors"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmAction('reactivate')}
                    className="w-full text-xs px-3 py-2 rounded-lg font-medium text-left flex items-center gap-2 transition-colors"
                    style={{
                      backgroundColor: 'rgba(34,197,94,0.08)',
                      color: '#16a34a',
                      border: '1px solid rgba(34,197,94,0.2)',
                    }}
                  >
                    <CheckCircle size={12} /> Reactivate membership
                  </button>
                )}

                {/* Revoke */}
                {confirmAction === 'revoke' ? (
                  <div className="space-y-1.5">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Confirm revoking this membership? This cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleStatusAction('revoke')}
                        disabled={statusSaving}
                        className="flex-1 text-xs px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                        style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                      >
                        {statusSaving ? 'Saving...' : 'Confirm revoke'}
                      </button>
                      <button
                        onClick={() => setConfirmAction(null)}
                        className="text-xs px-3 py-2 rounded-lg transition-colors"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--bg-tertiary)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmAction('revoke')}
                    className="w-full text-xs px-3 py-2 rounded-lg font-medium text-left flex items-center gap-2 transition-colors"
                    style={{
                      backgroundColor: 'rgba(239,68,68,0.08)',
                      color: '#ef4444',
                      border: '1px solid rgba(239,68,68,0.2)',
                    }}
                  >
                    <XCircle size={12} /> Revoke membership
                  </button>
                )}
              </div>
            )}

            {member.status === 'revoked' && (
              <p className="text-xs py-1" style={{ color: 'var(--text-tertiary)' }}>
                Membership revoked. No further actions available.
              </p>
            )}
          </div>

          {/* Payment terms */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Payment terms
            </h3>
            <div className="relative mb-3">
              <select
                value={paymentTerms}
                onChange={(e) => { setPaymentTerms(e.target.value); setPaymentTermsDirty(true); }}
                className="w-full text-sm px-3 py-2 rounded-lg appearance-none pr-8 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              >
                {PAYMENT_TERMS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--text-tertiary)' }}
              />
            </div>
            <button
              onClick={handleSavePaymentTerms}
              disabled={!paymentTermsDirty || paymentTermsSaving}
              className="w-full text-xs px-3 py-2 rounded-lg font-medium text-white flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              <Save size={11} />
              {paymentTermsSaving ? 'Saving...' : 'Save terms'}
            </button>
          </div>

          {/* Notes */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Notes
            </h3>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
              rows={4}
              placeholder="Add internal notes about this member..."
              className="w-full text-sm px-3 py-2 rounded-lg resize-y focus:outline-none focus:ring-2 mb-3"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-primary)',
                '--tw-ring-color': 'var(--color-accent)',
              } as React.CSSProperties}
            />
            <button
              onClick={handleSaveNotes}
              disabled={!notesDirty || notesSaving}
              className="w-full text-xs px-3 py-2 rounded-lg font-medium text-white flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              <Save size={11} />
              {notesSaving ? 'Saving...' : 'Save notes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
