'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Package, Mail, ShoppingBag, Sparkles,
  Check, X, Truck, DollarSign, Save, Image as ImageIcon,
  Clock, CheckCircle2, XCircle, Gift, AlertTriangle,
  MessageSquare, ExternalLink, Tag, Download,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { ReturnRequest, ReturnItem, Ticket } from '@/lib/types';

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending_review: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', label: 'Pending Review' },
  approved: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6', label: 'Approved' },
  partially_approved: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6', label: 'Partially Approved' },
  denied: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', label: 'Denied' },
  shipped: { bg: 'rgba(99,102,241,0.12)', text: '#6366f1', label: 'Shipped' },
  received: { bg: 'rgba(168,85,247,0.12)', text: '#a855f7', label: 'Received' },
  refunded: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', label: 'Refunded' },
  closed: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af', label: 'Closed' },
  cancelled: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af', label: 'Cancelled' },
};

const ITEM_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', label: 'Pending' },
  approved: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', label: 'Approved' },
  denied: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', label: 'Denied' },
};

const REASON_STYLES: Record<string, { bg: string; text: string }> = {
  defective: { bg: 'rgba(239,68,68,0.10)', text: '#ef4444' },
  wrong_item: { bg: 'rgba(249,115,22,0.10)', text: '#f97316' },
  not_as_described: { bg: 'rgba(245,158,11,0.10)', text: '#f59e0b' },
  changed_mind: { bg: 'rgba(59,130,246,0.10)', text: '#3b82f6' },
  too_small: { bg: 'rgba(168,85,247,0.10)', text: '#a855f7' },
  too_large: { bg: 'rgba(168,85,247,0.10)', text: '#a855f7' },
  arrived_late: { bg: 'rgba(99,102,241,0.10)', text: '#6366f1' },
  other: { bg: 'rgba(156,163,175,0.10)', text: '#9ca3af' },
};

const TIMELINE_STATUSES = [
  { key: 'pending_review', label: 'Created', icon: Clock },
  { key: 'approved', label: 'Reviewed', icon: CheckCircle2 },
  { key: 'shipped', label: 'Shipped', icon: Truck },
  { key: 'received', label: 'Received', icon: Package },
  { key: 'refunded', label: 'Refunded', icon: DollarSign },
];

interface RelatedTicket {
  id: string;
  ticket_number: number;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
}

export default function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ReturnRequest | null>(null);
  const [relatedTickets, setRelatedTickets] = useState<RelatedTicket[]>([]);
  const [loading, setLoading] = useState(true);

  // Notes
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // Modals
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showApproveNoReturnModal, setShowApproveNoReturnModal] = useState(false);
  const [showDenyModal, setShowDenyModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);

  // Approve modal state
  const [approveResolution, setApproveResolution] = useState('refund');
  const [approveAmount, setApproveAmount] = useState('');

  // Deny modal state
  const [denyReason, setDenyReason] = useState('');

  // Refund modal state
  const [refundAmount, setRefundAmount] = useState('');

  // Label modal state
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labelResult, setLabelResult] = useState<{
    labelUrl: string;
    trackingNumber: string;
    trackingUrl?: string;
    carrier?: string;
    rate?: number;
  } | null>(null);
  const [labelAddress, setLabelAddress] = useState({
    name: '',
    street1: '',
    street2: '',
    city: '',
    state: '',
    zip: '',
    country: 'US',
  });
  const [labelDims, setLabelDims] = useState({
    length: '',
    width: '',
    height: '',
    weight: '',
    weight_unit: 'lb',
    dimension_unit: 'in',
  });

  // Action loading
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/returns/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d.returnRequest ?? null);
        setNotes(d.returnRequest?.admin_notes ?? '');
        setRelatedTickets(d.relatedTickets ?? []);
        // Pre-fill label address with customer name
        if (d.returnRequest?.customer_name) {
          setLabelAddress((prev) => ({ ...prev, name: d.returnRequest.customer_name ?? '' }));
        }
        // Pre-fill label result if label already exists
        if (d.returnRequest?.return_label_url) {
          setLabelResult({
            labelUrl: d.returnRequest.return_label_url,
            trackingNumber: d.returnRequest.return_tracking_number ?? '',
            carrier: d.returnRequest.return_carrier ?? undefined,
            rate: d.returnRequest.return_shipping_cost ?? undefined,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function updateReturn(updates: Record<string, unknown>) {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/returns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const result = await res.json();
        setData(result.returnRequest);
      }
    } catch {
      // ignore
    }
    setActionLoading(false);
  }

  async function saveNotes() {
    setSavingNotes(true);
    await updateReturn({ admin_notes: notes });
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
    setSavingNotes(false);
  }

  async function handleApprove() {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/returns/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution_type: approveResolution,
          refund_amount: approveAmount ? parseFloat(approveAmount) : null,
          decided_by: 'admin',
        }),
      });
      const result = await res.json();
      if (res.ok) {
        setData(result.returnRequest);
      } else {
        setActionError(result.error || 'Approval failed');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Approval failed');
    }
    setActionLoading(false);
    setShowApproveModal(false);
  }

  async function handleApproveNoReturn() {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/returns/${id}/approve-no-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decided_by: 'admin' }),
      });
      const result = await res.json();
      if (res.ok || res.status === 207) {
        setData(result.returnRequest);
        if (result.refund && !result.refund.success) {
          setActionError(`Approved but Shopify refund failed: ${result.refund.error}`);
        }
      } else {
        setActionError(result.error || 'Approve-no-return failed');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Approve-no-return failed');
    }
    setActionLoading(false);
    setShowApproveNoReturnModal(false);
  }

  async function handleDeny() {
    if (!denyReason.trim()) {
      setActionError('Denial reason is required');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/returns/${id}/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          denial_reason: denyReason,
          decided_by: 'admin',
        }),
      });
      const result = await res.json();
      if (res.ok) {
        setData(result.returnRequest);
      } else {
        setActionError(result.error || 'Denial failed');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Denial failed');
    }
    setActionLoading(false);
    setShowDenyModal(false);
  }

  async function handleMarkReceived() {
    await updateReturn({ status: 'received' });
  }

  async function handleProcessRefund() {
    await updateReturn({
      status: 'refunded',
      refund_amount: refundAmount ? parseFloat(refundAmount) : data?.refund_amount,
    });
    setShowRefundModal(false);
  }

  async function updateItemStatus(itemId: string, newStatus: string) {
    await updateReturn({
      item_updates: [{ id: itemId, item_status: newStatus }],
    });
  }

  async function handleCreateLabel() {
    if (!labelAddress.name || !labelAddress.street1 || !labelAddress.city || !labelAddress.state || !labelAddress.zip) {
      setLabelError('Please fill in all required address fields');
      return;
    }

    setLabelLoading(true);
    setLabelError(null);

    const body: Record<string, unknown> = {
      customer_address: {
        name: labelAddress.name,
        street1: labelAddress.street1,
        street2: labelAddress.street2 || undefined,
        city: labelAddress.city,
        state: labelAddress.state,
        zip: labelAddress.zip,
        country: labelAddress.country,
      },
    };

    // Include dimensions if all filled
    if (labelDims.length && labelDims.width && labelDims.height && labelDims.weight) {
      body.package_dimensions = {
        length: parseFloat(labelDims.length),
        width: parseFloat(labelDims.width),
        height: parseFloat(labelDims.height),
        weight: parseFloat(labelDims.weight),
        weight_unit: labelDims.weight_unit,
        dimension_unit: labelDims.dimension_unit,
      };
    }

    try {
      const res = await fetch(`/api/returns/${id}/create-label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await res.json();

      if (res.ok) {
        setLabelResult(result);
        setShowLabelModal(false);
        // Refresh data to show label info on the return
        const refreshed = await fetch(`/api/returns/${id}`).then((r) => r.json());
        if (refreshed.returnRequest) setData(refreshed.returnRequest);
      } else {
        setLabelError(result.error ?? 'Failed to create label');
      }
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : 'Failed to create label');
    } finally {
      setLabelLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-60 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="h-[600px] rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p style={{ color: 'var(--text-tertiary)' }}>Return not found</p>
        <Link href="/returns" className="text-sm mt-2 inline-block" style={{ color: 'var(--color-accent)' }}>
          Back to returns
        </Link>
      </div>
    );
  }

  const statusStyle = STATUS_STYLES[data.status] || STATUS_STYLES.closed;
  const totalItemValue = data.items?.reduce((sum, item) => sum + item.price * item.quantity, 0) ?? 0;

  // Determine current timeline step
  const statusOrder = ['pending_review', 'approved', 'partially_approved', 'shipped', 'received', 'refunded', 'closed'];
  const currentStepIndex = statusOrder.indexOf(data.status);

  return (
    <div className="space-y-4">
      {/* Back */}
      <Link
        href="/returns"
        className="inline-flex items-center gap-1.5 text-sm transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft size={14} /> Back to returns
      </Link>

      {/* Action Error Banner */}
      {actionError && (
        <div
          className="rounded-xl p-3 flex items-center gap-2"
          style={{
            backgroundColor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          <AlertTriangle size={14} style={{ color: '#ef4444' }} />
          <span className="text-sm" style={{ color: '#ef4444' }}>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="ml-auto text-xs px-2 py-1 rounded"
            style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div
        className="rounded-xl p-4"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono" style={{ color: 'var(--text-tertiary)' }}>
              Order #{data.order_number}
            </span>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Return Request
            </h1>
            {data.approved_no_return && (
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
              >
                Refund Only
              </span>
            )}
          </div>
          <span
            className="text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{
              backgroundColor: statusStyle.bg,
              color: statusStyle.text,
            }}
          >
            {statusStyle.label}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {data.items?.length ?? 0} {(data.items?.length ?? 0) === 1 ? 'item' : 'items'} -- ${totalItemValue.toFixed(2)}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Submitted {formatDate(data.created_at)}
          </span>
          {data.denial_reason && (
            <span className="text-xs" style={{ color: '#ef4444' }}>
              Denial reason: {data.denial_reason}
            </span>
          )}
        </div>
      </div>

      {/* Main: two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Left column */}
        <div className="space-y-4">
          {/* Return Items */}
          <div
            className="rounded-xl"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
              <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Package size={14} />
                Return Items ({data.items?.length ?? 0})
              </h3>
            </div>
            <div className="p-4 space-y-3">
              {(!data.items || data.items.length === 0) ? (
                <p className="text-sm text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
                  No items found
                </p>
              ) : (
                data.items.map((item: ReturnItem) => {
                  const reasonStyle = REASON_STYLES[item.reason] || REASON_STYLES.other;
                  const itemSt = ITEM_STATUS_STYLES[item.item_status] || ITEM_STATUS_STYLES.pending;

                  return (
                    <div
                      key={item.id}
                      className="rounded-lg p-3"
                      style={{
                        border: '1px solid var(--border-secondary)',
                        backgroundColor: 'var(--bg-secondary)',
                      }}
                    >
                      <div className="flex gap-3">
                        {/* Product image */}
                        <div
                          className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
                          style={{
                            backgroundColor: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-secondary)',
                          }}
                        >
                          {item.product_image_url ? (
                            <img
                              src={item.product_image_url}
                              alt={item.product_title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <ImageIcon size={20} style={{ color: 'var(--text-tertiary)' }} />
                          )}
                        </div>

                        {/* Item details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between mb-1">
                            <div>
                              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {item.product_title}
                              </p>
                              {item.variant_title && (
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                  {item.variant_title}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {/* Per-item status */}
                              <div className="relative">
                                <select
                                  value={item.item_status}
                                  onChange={(e) => updateItemStatus(item.id, e.target.value)}
                                  className="text-[10px] font-medium px-2 py-0.5 rounded-full appearance-none pr-5 focus:outline-none"
                                  style={{
                                    backgroundColor: itemSt.bg,
                                    color: itemSt.text,
                                    border: 'none',
                                  }}
                                >
                                  <option value="pending">Pending</option>
                                  <option value="approved">Approved</option>
                                  <option value="denied">Denied</option>
                                </select>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              Qty: {item.quantity} x ${item.price.toFixed(2)}
                            </span>
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: reasonStyle.bg,
                                color: reasonStyle.text,
                              }}
                            >
                              {item.reason.replace(/_/g, ' ')}
                            </span>
                          </div>

                          {item.reason_details && (
                            <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                              {item.reason_details}
                            </p>
                          )}

                          {/* Photos */}
                          {item.photo_urls && item.photo_urls.length > 0 && (
                            <div className="flex gap-2 mt-2">
                              {item.photo_urls.map((url, i) => (
                                <a
                                  key={i}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0"
                                  style={{
                                    border: '1px solid var(--border-secondary)',
                                  }}
                                >
                                  <img
                                    src={url}
                                    alt={`Photo ${i + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* AI Recommendation */}
          {data.ai_recommendation && (
            <div
              className="rounded-xl"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Sparkles size={14} style={{ color: '#a855f7' }} />
                  AI Recommendation
                </h3>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className="text-xs font-semibold px-3 py-1 rounded-full"
                    style={{
                      backgroundColor: data.ai_recommendation.decision === 'approve'
                        ? 'rgba(34,197,94,0.12)'
                        : data.ai_recommendation.decision === 'deny'
                        ? 'rgba(239,68,68,0.12)'
                        : 'rgba(245,158,11,0.12)',
                      color: data.ai_recommendation.decision === 'approve'
                        ? '#22c55e'
                        : data.ai_recommendation.decision === 'deny'
                        ? '#ef4444'
                        : '#f59e0b',
                    }}
                  >
                    {data.ai_recommendation.decision === 'approve' ? 'Approve' :
                     data.ai_recommendation.decision === 'deny' ? 'Deny' : 'Needs Review'}
                  </span>

                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Confidence:
                    </span>
                    <div
                      className="flex-1 h-2 rounded-full overflow-hidden"
                      style={{ backgroundColor: 'var(--bg-tertiary)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.round(data.ai_recommendation.confidence * 100)}%`,
                          backgroundColor: data.ai_recommendation.confidence >= 0.8
                            ? '#22c55e'
                            : data.ai_recommendation.confidence >= 0.5
                            ? '#f59e0b'
                            : '#ef4444',
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {Math.round(data.ai_recommendation.confidence * 100)}%
                    </span>
                  </div>
                </div>

                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {data.ai_recommendation.reasoning}
                </p>

                {data.ai_recommendation.suggested_resolution && (
                  <div
                    className="mt-3 px-3 py-2 rounded-lg text-xs"
                    style={{
                      backgroundColor: 'rgba(168,85,247,0.06)',
                      border: '1px solid rgba(168,85,247,0.15)',
                      color: '#a855f7',
                    }}
                  >
                    Suggested: {data.ai_recommendation.suggested_resolution}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Admin Notes */}
          <div
            className="rounded-xl"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Admin Notes
              </h3>
            </div>
            <div className="p-4">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Add notes about this return..."
                className="w-full text-sm rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  {notesSaved ? <><Check size={12} /> Saved</> : <><Save size={12} /> Save Notes</>}
                </button>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {(data.status === 'pending_review') && (
                <>
                  <div className="flex gap-3 flex-wrap">
                    <button
                      onClick={() => {
                        setApproveAmount(totalItemValue.toFixed(2));
                        setShowApproveModal(true);
                      }}
                      disabled={actionLoading}
                      className="flex items-center gap-2 text-xs px-5 py-2.5 font-semibold uppercase tracking-wide transition-all disabled:opacity-50"
                      style={{ backgroundColor: '#131314', color: '#F9F9FB', letterSpacing: '0.08em' }}
                    >
                      <Check size={13} /> Approve Return
                    </button>
                    <button
                      onClick={() => setShowApproveNoReturnModal(true)}
                      disabled={actionLoading}
                      className="flex items-center gap-2 text-xs px-5 py-2.5 font-semibold uppercase tracking-wide transition-all disabled:opacity-50"
                      style={{ backgroundColor: '#C5A059', color: '#131314', letterSpacing: '0.08em' }}
                    >
                      <Gift size={13} /> Green Return
                    </button>
                    <button
                      onClick={() => setShowDenyModal(true)}
                      disabled={actionLoading}
                      className="flex items-center gap-2 text-xs px-5 py-2.5 font-semibold uppercase tracking-wide transition-all disabled:opacity-50"
                      style={{ border: '1px solid rgba(239,68,68,0.3)', backgroundColor: 'transparent', color: '#ef4444', letterSpacing: '0.08em' }}
                    >
                      <X size={13} /> Deny
                    </button>
                  </div>
                </>
              )}
              {(data.status === 'approved' || data.status === 'partially_approved') && (
                <>
                  <button
                    onClick={() => {
                      setLabelError(null);
                      setShowLabelModal(true);
                    }}
                    disabled={actionLoading}
                    className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                    style={{ backgroundColor: '#0ea5e9' }}
                  >
                    <Tag size={12} /> Create Return Label
                  </button>
                  <button
                    onClick={() => updateReturn({ status: 'shipped' })}
                    disabled={actionLoading}
                    className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                    style={{ backgroundColor: '#6366f1' }}
                  >
                    <Truck size={12} /> Mark as Shipped
                  </button>
                </>
              )}
              {data.status === 'shipped' && (
                <button
                  onClick={handleMarkReceived}
                  disabled={actionLoading}
                  className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#a855f7' }}
                >
                  <Package size={12} /> Mark as Received
                </button>
              )}
              {data.status === 'received' && (
                <button
                  onClick={() => {
                    setRefundAmount(data.refund_amount?.toFixed(2) || totalItemValue.toFixed(2));
                    setShowRefundModal(true);
                  }}
                  disabled={actionLoading}
                  className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#22c55e' }}
                >
                  <DollarSign size={12} /> Process Refund
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right column (sidebar) */}
        <div className="space-y-4">
          {/* Customer info */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Customer
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                    color: 'var(--color-accent)',
                  }}
                >
                  {(data.customer_name || data.customer_email || '?').charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {data.customer_name || 'Unknown'}
                  </p>
                  <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                    <Mail size={10} /> {data.customer_email}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Order info */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Order
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ShoppingBag size={12} style={{ color: 'var(--text-tertiary)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  #{data.order_number}
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Total return value: ${totalItemValue.toFixed(2)}
              </p>
              {data.refund_amount != null && (
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Refund amount: ${data.refund_amount.toFixed(2)}
                </p>
              )}
              {data.resolution_type && (
                <span
                  className="inline-block text-[10px] font-medium px-2 py-0.5 rounded capitalize"
                  style={{
                    backgroundColor: 'rgba(59,130,246,0.10)',
                    color: '#3b82f6',
                  }}
                >
                  {data.resolution_type.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>

          {/* Package Dimensions */}
          {data.package_dimensions && (
            <div
              className="rounded-xl p-4"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-tertiary)' }}>
                <Package size={12} />
                Package Dimensions
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Length', value: `${(data.package_dimensions as Record<string, number>).length}"` },
                  { label: 'Width', value: `${(data.package_dimensions as Record<string, number>).width}"` },
                  { label: 'Height', value: `${(data.package_dimensions as Record<string, number>).height}"` },
                  { label: 'Weight', value: `${(data.package_dimensions as Record<string, number>).weight} lbs` },
                ].map((d) => (
                  <div key={d.label} className="text-center p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>{d.label}</div>
                    <div className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>{d.value}</div>
                  </div>
                ))}
              </div>
              {data.estimated_shipping_cost != null && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-tertiary)' }}>Best rate</span>
                    <span className="font-medium" style={{ color: 'var(--color-accent)' }}>${Number(data.estimated_shipping_cost).toFixed(2)}</span>
                  </div>
                  {data.estimated_return_warehouse && (
                    <div className="flex justify-between text-xs mt-1">
                      <span style={{ color: 'var(--text-tertiary)' }}>Carrier → Warehouse</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{data.estimated_return_warehouse}</span>
                    </div>
                  )}
                </div>
              )}
              {(data as Record<string, unknown>).shipping_rates && Array.isArray((data as Record<string, unknown>).shipping_rates) && ((data as Record<string, unknown>).shipping_rates as Array<Record<string, unknown>>).length > 1 && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>All Rates</div>
                  <div className="space-y-1.5">
                    {((data as Record<string, unknown>).shipping_rates as Array<{ carrier: string; service: string; amount: number; warehouse: string; estimatedDays: number | null }>).slice(0, 8).map((rate, i) => (
                      <div key={i} className="flex justify-between text-[11px]" style={{ color: i === 0 ? 'var(--color-accent)' : 'var(--text-secondary)' }}>
                        <span>{rate.carrier}{rate.service ? ` ${rate.service}` : ''}</span>
                        <span className="font-medium">${rate.amount.toFixed(2)}{rate.estimatedDays ? ` · ${rate.estimatedDays}d` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Return Label Info */}
          {labelResult && (
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-tertiary)' }}>
                <Tag size={12} />
                Return Label
              </h3>
              <div className="space-y-2">
                {labelResult.carrier && (
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>Carrier:</span> {labelResult.carrier}
                  </p>
                )}
                {labelResult.trackingNumber && (
                  <p className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
                    {labelResult.trackingNumber}
                  </p>
                )}
                {labelResult.rate != null && (
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Shipping cost: ${labelResult.rate.toFixed(2)}
                  </p>
                )}
                <a
                  href={labelResult.labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium text-white w-full justify-center mt-2"
                  style={{ backgroundColor: '#0ea5e9', textDecoration: 'none' }}
                >
                  <Download size={12} /> Download Label
                </a>
                {labelResult.trackingUrl && (
                  <a
                    href={labelResult.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium w-full justify-center"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-secondary)',
                      color: 'var(--text-secondary)',
                      textDecoration: 'none',
                    }}
                  >
                    <ExternalLink size={12} /> Track Package
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Timeline
            </h3>
            <div className="space-y-0">
              {TIMELINE_STATUSES.map((step, i) => {
                const stepIndex = ['pending_review', 'approved', 'shipped', 'received', 'refunded'].indexOf(step.key);
                const isDenied = data.status === 'denied' && step.key === 'approved';
                const isComplete = currentStepIndex >= statusOrder.indexOf(step.key) && !isDenied && data.status !== 'denied';
                const isCurrent = data.status === step.key || (isDenied);
                const isLast = i === TIMELINE_STATUSES.length - 1;

                return (
                  <div key={step.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: isComplete || isCurrent
                            ? isDenied
                              ? 'rgba(239,68,68,0.15)'
                              : 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                            : 'var(--bg-tertiary)',
                        }}
                      >
                        {isDenied ? (
                          <XCircle size={12} style={{ color: '#ef4444' }} />
                        ) : isComplete ? (
                          <step.icon size={12} style={{ color: 'var(--color-accent)' }} />
                        ) : (
                          <step.icon size={12} style={{ color: 'var(--text-tertiary)' }} />
                        )}
                      </div>
                      {!isLast && (
                        <div
                          className="w-0.5 flex-1 min-h-[20px]"
                          style={{
                            backgroundColor: isComplete && stepIndex < currentStepIndex
                              ? 'var(--color-accent)'
                              : 'var(--border-secondary)',
                          }}
                        />
                      )}
                    </div>
                    <div className="pb-4">
                      <p
                        className="text-xs font-medium"
                        style={{
                          color: isComplete || isCurrent
                            ? isDenied ? '#ef4444' : 'var(--text-primary)'
                            : 'var(--text-tertiary)',
                        }}
                      >
                        {isDenied ? 'Denied' : step.label}
                      </p>
                      {isCurrent && data.decided_at && (
                        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                          {formatDate(data.decided_at)}
                        </p>
                      )}
                      {step.key === 'pending_review' && (
                        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                          {formatDate(data.created_at)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Related Tickets */}
          {relatedTickets.length > 0 && (
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-tertiary)' }}>
                <MessageSquare size={12} />
                Related Tickets ({relatedTickets.length})
              </h3>
              <div className="space-y-2">
                {relatedTickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/tickets/${ticket.id}`}
                    className="block rounded-lg p-2 transition-colors"
                    style={{
                      border: '1px solid var(--border-secondary)',
                      backgroundColor: 'var(--bg-secondary)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-medium" style={{ color: 'var(--text-primary)' }}>
                        #{ticket.ticket_number}
                      </span>
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: ticket.status === 'open' ? 'rgba(245,158,11,0.12)' :
                            ticket.status === 'resolved' ? 'rgba(34,197,94,0.12)' : 'rgba(156,163,175,0.12)',
                          color: ticket.status === 'open' ? '#f59e0b' :
                            ticket.status === 'resolved' ? '#22c55e' : '#9ca3af',
                        }}
                      >
                        {ticket.status}
                      </span>
                    </div>
                    <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>
                      {ticket.subject}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Linked ticket */}
          {data.ticket_id && (
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Linked Ticket
              </h3>
              <Link
                href={`/tickets/${data.ticket_id}`}
                className="text-xs font-medium transition-colors flex items-center gap-1"
                style={{ color: 'var(--color-accent)' }}
              >
                <ExternalLink size={10} /> View ticket
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Approve Modal */}
      {showApproveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div
            className="rounded-xl p-6 w-full max-w-md"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              Approve Return
            </h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Customer will be asked to ship items to the fulfillment center.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                  Resolution Type
                </label>
                <select
                  value={approveResolution}
                  onChange={(e) => setApproveResolution(e.target.value)}
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                >
                  <option value="refund">Refund</option>
                  <option value="store_credit">Store Credit</option>
                  <option value="exchange">Exchange</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                  Refund Amount ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={approveAmount}
                  onChange={(e) => setApproveAmount(e.target.value)}
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={() => setShowApproveModal(false)}
                className="text-xs px-4 py-2 rounded-lg font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="text-xs px-4 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#22c55e' }}
              >
                {actionLoading ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve No Return Modal */}
      {showApproveNoReturnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div
            className="rounded-xl p-6 w-full max-w-md"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              Green Return — Refund Without Shipping
            </h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              The customer will NOT need to return the items. A refund will be processed immediately through Shopify.
            </p>

            <div
              className="rounded-lg p-3 mb-4"
              style={{
                backgroundColor: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.2)',
              }}
            >
              <p className="text-xs" style={{ color: '#3b82f6' }}>
                <strong>Items:</strong> {data.items?.map((i) => `${i.product_title} (x${i.quantity})`).join(', ')}
              </p>
              <p className="text-xs mt-1" style={{ color: '#3b82f6' }}>
                <strong>Value:</strong> ${totalItemValue.toFixed(2)} (restocking fee may be applied based on settings)
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowApproveNoReturnModal(false)}
                className="text-xs px-4 py-2 rounded-lg font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleApproveNoReturn}
                disabled={actionLoading}
                className="text-xs px-4 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#3b82f6' }}
              >
                {actionLoading ? 'Processing...' : 'Approve & Refund'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deny Modal */}
      {showDenyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div
            className="rounded-xl p-6 w-full max-w-md"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              Deny Return
            </h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              The customer will be notified with the reason you provide below.
            </p>

            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Denial Reason <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                rows={3}
                placeholder="Explain why this return is being denied..."
                className="w-full text-sm rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
              {!denyReason.trim() && (
                <p className="text-[10px] mt-1" style={{ color: '#ef4444' }}>
                  A reason is required and will be included in the customer email.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={() => setShowDenyModal(false)}
                className="text-xs px-4 py-2 rounded-lg font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeny}
                disabled={actionLoading || !denyReason.trim()}
                className="text-xs px-4 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#ef4444' }}
              >
                {actionLoading ? 'Denying...' : 'Deny Return'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Label Modal */}
      {showLabelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div
            className="rounded-xl p-6 w-full max-w-lg overflow-y-auto"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-md)',
              maxHeight: '90vh',
            }}
          >
            <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              Create Return Shipping Label
            </h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
              A prepaid return label will be generated via Shippo and sent to {data.customer_email}.
            </p>

            {labelError && (
              <div
                className="rounded-lg p-3 mb-4 flex items-center gap-2"
                style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                <AlertTriangle size={13} style={{ color: '#ef4444' }} />
                <span className="text-xs" style={{ color: '#ef4444' }}>{labelError}</span>
              </div>
            )}

            {/* Customer Address */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Customer Address (Ship From)</p>

              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Full Name <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    value={labelAddress.name}
                    onChange={(e) => setLabelAddress((a) => ({ ...a, name: e.target.value }))}
                    placeholder="Jane Doe"
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Street Address <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    value={labelAddress.street1}
                    onChange={(e) => setLabelAddress((a) => ({ ...a, street1: e.target.value }))}
                    placeholder="123 Main St"
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Apt / Suite</label>
                  <input
                    type="text"
                    value={labelAddress.street2}
                    onChange={(e) => setLabelAddress((a) => ({ ...a, street2: e.target.value }))}
                    placeholder="Apt 4B (optional)"
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>City <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    value={labelAddress.city}
                    onChange={(e) => setLabelAddress((a) => ({ ...a, city: e.target.value }))}
                    placeholder="Nashville"
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>State <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    value={labelAddress.state}
                    onChange={(e) => setLabelAddress((a) => ({ ...a, state: e.target.value }))}
                    placeholder="TN"
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>ZIP <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    value={labelAddress.zip}
                    onChange={(e) => setLabelAddress((a) => ({ ...a, zip: e.target.value }))}
                    placeholder="37201"
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Country</label>
                  <input
                    type="text"
                    value={labelAddress.country}
                    onChange={(e) => setLabelAddress((a) => ({ ...a, country: e.target.value }))}
                    placeholder="US"
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none"
                    style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              {/* Package Dimensions */}
              <p className="text-xs font-semibold uppercase tracking-wider mt-2" style={{ color: 'var(--text-tertiary)' }}>
                Package Dimensions
                <span className="ml-1 normal-case font-normal" style={{ color: 'var(--text-tertiary)' }}>
                  (leave blank to use SKU preset)
                </span>
              </p>

              <div className="flex items-center gap-2">
                <input
                  type="number" step="0.1" min="0" placeholder="Length"
                  value={labelDims.length}
                  onChange={(e) => setLabelDims((d) => ({ ...d, length: e.target.value }))}
                  className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
                <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>x</span>
                <input
                  type="number" step="0.1" min="0" placeholder="Width"
                  value={labelDims.width}
                  onChange={(e) => setLabelDims((d) => ({ ...d, width: e.target.value }))}
                  className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
                <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>x</span>
                <input
                  type="number" step="0.1" min="0" placeholder="Height"
                  value={labelDims.height}
                  onChange={(e) => setLabelDims((d) => ({ ...d, height: e.target.value }))}
                  className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
                <select
                  value={labelDims.dimension_unit}
                  onChange={(e) => setLabelDims((d) => ({ ...d, dimension_unit: e.target.value }))}
                  className="text-sm rounded-lg px-2 py-2 focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                >
                  <option value="in">in</option>
                  <option value="cm">cm</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number" step="0.01" min="0" placeholder="Weight"
                  value={labelDims.weight}
                  onChange={(e) => setLabelDims((d) => ({ ...d, weight: e.target.value }))}
                  className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                />
                <select
                  value={labelDims.weight_unit}
                  onChange={(e) => setLabelDims((d) => ({ ...d, weight_unit: e.target.value }))}
                  className="text-sm rounded-lg px-2 py-2 focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                >
                  <option value="lb">lb</option>
                  <option value="oz">oz</option>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={() => { setShowLabelModal(false); setLabelError(null); }}
                className="text-xs px-4 py-2 rounded-lg font-medium"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateLabel}
                disabled={labelLoading}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#0ea5e9' }}
              >
                {labelLoading ? 'Creating...' : <><Tag size={12} /> Generate Label</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div
            className="rounded-xl p-6 w-full max-w-md"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Process Refund
            </h3>

            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Refund Amount ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={() => setShowRefundModal(false)}
                className="text-xs px-4 py-2 rounded-lg font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleProcessRefund}
                disabled={actionLoading}
                className="text-xs px-4 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#22c55e' }}
              >
                {actionLoading ? 'Processing...' : 'Process Refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
