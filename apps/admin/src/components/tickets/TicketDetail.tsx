'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { DraftQuality } from './DraftQuality';
import type { DraftReview } from '@/lib/support-ai';
import { TicketAutomationControl } from '@/components/support/TicketAutomationControl';
import {
  ArrowLeft, Tag, User, Bot, Cpu, MessageSquare, Plus, X,
  ChevronDown, ChevronUp, Send, StickyNote, Sparkles, ListChecks, FileText,
  ShoppingCart, RefreshCcw, ReceiptText, Copy, CheckCircle2,
  Mail, FormInput, Clock, AlertCircle, Search, BookOpen, Package,
  DollarSign, Truck, Calendar, Star, Loader2, Ban, Undo2, MapPin,
  CreditCard, XCircle, ChevronRight, UserPlus, AlarmClock, GitMerge,
  Keyboard, Paperclip, MailCheck, MailX,
} from 'lucide-react';
import { formatDate, cn } from '@/lib/utils';
import type { Ticket, TicketMessage, TicketEvent, CannedResponse, Message, AgentRosterEntry } from '@/lib/types';
import { ticketTriage, ticketCsat, ticketSnoozedUntil, ticketAutopilot } from '@/lib/types';
import { TicketWorkflowBar } from '@/components/tickets/TicketWorkflowBar';

const SENTIMENT_META: Record<string, { label: string; color: string }> = {
  angry: { label: 'Angry', color: 'var(--color-danger)' },
  frustrated: { label: 'Frustrated', color: 'var(--color-warning)' },
  neutral: { label: 'Neutral', color: 'var(--text-tertiary)' },
  positive: { label: 'Positive', color: 'var(--color-success)' },
};

function snoozePresets(): Array<{ label: string; until: () => Date }> {
  return [
    { label: 'In 4 hours', until: () => new Date(Date.now() + 4 * 3600_000) },
    {
      label: 'Tomorrow 9am',
      until: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; },
    },
    {
      label: 'In 3 days (9am)',
      until: () => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(9, 0, 0, 0); return d; },
    },
    {
      label: 'Next Monday 9am',
      until: () => {
        const d = new Date();
        d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
  ];
}

function formatSnoozeUntil(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function responseError(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback;
}

// Token-driven (see globals.css). bg = soft tint of the same token via color-mix.
const tint = (v: string) => `color-mix(in srgb, ${v} 12%, transparent)`;

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  urgent: { bg: tint('var(--color-priority-urgent)'), text: 'var(--color-priority-urgent)' },
  high: { bg: tint('var(--color-priority-high)'), text: 'var(--color-priority-high)' },
  medium: { bg: tint('var(--color-priority-medium)'), text: 'var(--color-priority-medium)' },
  low: { bg: tint('var(--color-priority-low)'), text: 'var(--color-priority-low)' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  open: { bg: tint('var(--color-status-open)'), text: 'var(--color-status-open)' },
  pending: { bg: tint('var(--color-status-pending)'), text: 'var(--color-status-pending)' },
  resolved: { bg: tint('var(--color-status-resolved)'), text: 'var(--color-status-resolved)' },
  closed: { bg: tint('var(--color-status-closed)'), text: 'var(--color-status-closed)' },
};

const SOURCE_META: Record<string, { icon: typeof Mail; label: string; color: string }> = {
  email: { icon: Mail, label: 'Email', color: 'var(--color-source-email)' },
  form: { icon: FormInput, label: 'Form', color: 'var(--color-source-form)' },
  ai_escalation: { icon: Sparkles, label: 'AI Escalation', color: 'var(--color-source-ai)' },
};

const TAG_COLORS = [
  { bg: 'rgba(59,130,246,0.1)', text: 'var(--color-info)' },
  { bg: 'rgba(34,197,94,0.1)', text: 'var(--color-success)' },
  { bg: 'rgba(168,85,247,0.1)', text: 'var(--color-source-ai)' },
  { bg: 'rgba(249,115,22,0.1)', text: 'var(--color-warning)' },
  { bg: 'rgba(236,72,153,0.1)', text: '#ec4899' },
  { bg: 'rgba(20,184,166,0.1)', text: '#14b8a6' },
];

const FINANCIAL_STATUS_COLORS: Record<string, string> = {
  PAID: 'var(--color-success)',
  PARTIALLY_PAID: 'var(--color-warning)',
  PENDING: 'var(--color-warning)',
  REFUNDED: 'var(--color-source-ai)',
  PARTIALLY_REFUNDED: 'var(--color-source-ai)',
  VOIDED: 'var(--color-status-closed)',
  AUTHORIZED: 'var(--color-info)',
};

const FULFILLMENT_STATUS_COLORS: Record<string, string> = {
  FULFILLED: 'var(--color-success)',
  UNFULFILLED: 'var(--color-warning)',
  PARTIALLY_FULFILLED: 'var(--color-info)',
  IN_PROGRESS: 'var(--color-info)',
};

function getTagColor(i: number) { return TAG_COLORS[i % TAG_COLORS.length]; }

function buildTrackingUrl(url: string | null, trackingNumber: string): string | null {
  if (!url) return null;
  return `${url}${url.includes('?') ? '&' : '?'}tracking=${encodeURIComponent(trackingNumber)}`;
}

interface ShopifyCustomerProfile {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ordersCount: number;
  totalSpent: string;
  createdAt: string;
  tags: string[];
  note: string | null;
  state: string;
}

interface ShopifyOrder {
  id: string;
  name: string;
  totalPrice: string;
  financialStatus: string;
  fulfillmentStatus: string;
  lineItems: Array<{ title: string; quantity: number; variantTitle: string | null }>;
  tracking: Array<{ number: string; url: string | null; company: string | null }>;
  fulfillments: Array<{
    status: string;
    createdAt: string;
    trackingInfo: Array<{ number: string; url: string | null; company: string | null }>;
  }>;
  createdAt: string;
  cancelledAt: string | null;
  closedAt: string | null;
}

interface OrderDetailData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  financialStatus: string;
  fulfillmentStatus: string;
  subtotal: string;
  tax: string;
  shipping: string;
  totalPrice: string;
  currentTotalPrice: string;
  totalRefunded: string;
  currency: string;
  lineItems: Array<{
    id: string; title: string; quantity: number; sku: string | null;
    variantTitle: string | null; unitPrice: string; refundableQuantity: number;
  }>;
  shippingAddress: {
    name: string; address1: string; address2: string | null;
    city: string; province: string | null; zip: string | null;
    country: string; phone: string | null;
  } | null;
  transactions: Array<{
    id: string; kind: string; status: string; amount: string; gateway: string; processedAt: string;
  }>;
  refunds: Array<{
    id: string; createdAt: string; note: string | null; amount: string;
    lineItems: Array<{ title: string; quantity: number; subtotal: string }>;
  }>;
  fulfillments: Array<{
    status: string; createdAt: string;
    trackingInfo: Array<{ number: string; url: string | null; company: string | null }>;
  }>;
}

const CANCEL_REASONS = [
  { value: 'CUSTOMER', label: 'Customer request' },
  { value: 'INVENTORY', label: 'Out of stock' },
  { value: 'FRAUD', label: 'Fraudulent order' },
  { value: 'DECLINED', label: 'Payment declined' },
  { value: 'OTHER', label: 'Other' },
];

interface KBDocument {
  id: string;
  title: string;
  content: string;
  category: string;
}

interface TicketDetail {
  ticket: Ticket;
  messages: TicketMessage[];
  events: TicketEvent[];
  aiConversationMessages?: Message[];
  pastTickets?: Ticket[];
}

export interface TicketDetailProps {
  /** Ticket id from the route. */
  ticketId: string;
  /** Link prefix for ticket pages — "/tickets" (admin) or "/agent/tickets" (agent). */
  basePath?: string;
}

export function TicketDetail({ ticketId, basePath = '/tickets' }: TicketDetailProps) {
  const id = ticketId;
  const [data, setData] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Customer Shopify data
  const [customerProfile, setCustomerProfile] = useState<ShopifyCustomerProfile | null>(null);
  const [customerOrders, setCustomerOrders] = useState<ShopifyOrder[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);

  // Composer state
  const [replyMode, setReplyMode] = useState<'reply' | 'note'>('reply');
  const [replyContent, setReplyContent] = useState('');
  const [draftQuality, setDraftQuality] = useState<{text: string; review: DraftReview} | null>(null);
  const [draftGenerationId, setDraftGenerationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Dropdowns
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false);
  const [showCannedDropdown, setShowCannedDropdown] = useState(false);
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);

  // Tag management
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTag, setNewTag] = useState('');

  // AI context collapsible
  const [aiContextOpen, setAiContextOpen] = useState(false);

  // AI tools
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSteps, setAiSteps] = useState<string[] | null>(null);
  const [agentContext, setAgentContext] = useState('');
  const [showAgentContext, setShowAgentContext] = useState(false);

  // KB search
  const [kbQuery, setKbQuery] = useState('');
  const [kbResults, setKbResults] = useState<KBDocument[]>([]);
  const [kbSearching, setKbSearching] = useState(false);
  const [kbExpanded, setKbExpanded] = useState<string | null>(null);

  // Orders panel
  const [ordersExpanded, setOrdersExpanded] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetailData | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);

  // Cancel modal
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('CUSTOMER');
  const [cancelRefund, setCancelRefund] = useState(true);
  const [cancelRestock, setCancelRestock] = useState(true);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelPendingOrderId, setCancelPendingOrderId] = useState<string | null>(null);

  // Refund modal
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundNotify, setRefundNotify] = useState(true);
  const [refundLoading, setRefundLoading] = useState(false);

  // Action result toast
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'pending' | 'error'; message: string } | null>(null);

  // Copy feedback
  const [copied, setCopied] = useState(false);

  // Assignment / snooze / merge / shortcuts
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const [me, setMe] = useState<{ userId: string | null; name: string | null; role: string } | null>(null);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [showSnoozeDropdown, setShowSnoozeDropdown] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const activeTicketIdRef = useRef(id);
  const aiRequestRef = useRef<AbortController | null>(null);
  const pendingSendRef = useRef<{ key: string; signature: string } | null>(null);
  activeTicketIdRef.current = id;

  useEffect(() => {
    const controller = new AbortController();
    aiRequestRef.current?.abort();
    aiRequestRef.current = null;

    // Dynamic ticket routes can reuse this component. Clear every ticket-scoped
    // field before loading so drafts, customer data, dialogs, and AI output from
    // the previous ticket cannot appear on the next one.
    setData(null);
    setLoading(true);
    setCustomerProfile(null);
    setCustomerOrders([]);
    setCustomerLoading(false);
    setReplyMode('reply');
    setReplyContent('');
    setDraftGenerationId(null);
    setDraftQuality(null);
    pendingSendRef.current = null;
    setSending(false);
    setShowStatusDropdown(false);
    setShowPriorityDropdown(false);
    setShowCannedDropdown(false);
    setShowTagInput(false);
    setNewTag('');
    setAiContextOpen(false);
    setAiLoading(null);
    setAiSummary(null);
    setAiSteps(null);
    setAgentContext('');
    setShowAgentContext(false);
    setKbQuery('');
    setKbResults([]);
    setKbSearching(false);
    setKbExpanded(null);
    setOrdersExpanded(true);
    setExpandedOrderId(null);
    setOrderDetail(null);
    setOrderDetailLoading(false);
    setShowCancelModal(false);
    setCancelReason('CUSTOMER');
    setCancelRefund(true);
    setCancelRestock(true);
    setCancelLoading(false);
    setCancelPendingOrderId(null);
    setShowRefundModal(false);
    setRefundAmount('');
    setRefundReason('');
    setRefundNotify(true);
    setRefundLoading(false);
    setActionResult(null);
    setCopied(false);
    setShowAssignDropdown(false);
    setShowSnoozeDropdown(false);
    setShowMergeModal(false);
    setMergeSourceId(null);
    setMergeLoading(false);
    setShowShortcuts(false);

    void (async () => {
      try {
        const response = await fetch(`/api/tickets/${id}`, { signal: controller.signal });
        const payload = await readJsonObject(response);
        if (!response.ok) throw new Error(responseError(payload, 'Failed to load ticket'));
        if (!controller.signal.aborted && activeTicketIdRef.current === id) {
          setData(payload as unknown as TicketDetail);
        }
      } catch (error) {
        if (!controller.signal.aborted && activeTicketIdRef.current === id) {
          console.error('Ticket load failed:', error);
        }
      } finally {
        if (!controller.signal.aborted && activeTicketIdRef.current === id) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [id]);

  // Fetch Shopify customer data after ticket loads
  useEffect(() => {
    if (data?.ticket?.id !== id || !data.ticket.customer_email) return;
    const controller = new AbortController();
    setCustomerLoading(true);
    fetch(`/api/tickets/${id}/customer`, { signal: controller.signal })
      .then(async (r) => {
        const payload = await readJsonObject(r);
        if (!r.ok) throw new Error(responseError(payload, 'Failed to load customer'));
        return payload;
      })
      .then((res) => {
        if (controller.signal.aborted || activeTicketIdRef.current !== id) return;
        if (res.profile) {
          const profile = res.profile as ShopifyCustomerProfile;
          setCustomerProfile(profile);
          // Auto-update ticket customer_name in local state from Shopify
          const shopifyName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
          if (shopifyName && (!data.ticket.customer_name || data.ticket.customer_name === 'Unknown')) {
            setData((prev) => prev ? {
              ...prev,
              ticket: { ...prev.ticket, customer_name: shopifyName },
            } : prev);
          }
        }
        if (Array.isArray(res.orders)) setCustomerOrders(res.orders as ShopifyOrder[]);
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.error('Customer load failed:', error);
      })
      .finally(() => {
        if (!controller.signal.aborted && activeTicketIdRef.current === id) setCustomerLoading(false);
      });
    return () => controller.abort();
  }, [id, data?.ticket?.customer_email]);

  useEffect(() => {
    fetch('/api/settings/canned-responses')
      .then((r) => r.json())
      .then((d) => setCannedResponses(d.responses ?? []))
      .catch(() => {});
    fetch('/api/agents/roster')
      .then((r) => r.json())
      .then((d) => setRoster(d.agents ?? []))
      .catch(() => {});
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setMe(d?.role ? d : null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const end = messagesEndRef.current;
    const thread = end?.parentElement;
    const newest = end?.previousElementSibling;
    // Keep the ticket header and controls in place. Read the newest message
    // from its beginning, scrolling only the thread rather than the page.
    if (thread && newest) thread.scrollTo({ top: newest.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop - 16 });
  }, [data?.messages]);

  async function reloadTicket(ticketId: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/tickets/${ticketId}`, { cache: 'no-store' });
      const payload = await readJsonObject(response);
      if (!response.ok) return false;
      if (activeTicketIdRef.current === ticketId) {
        setData(payload as unknown as TicketDetail);
      }
      return true;
    } catch {
      return false;
    }
  }

  async function updateTicket(updates: Partial<Ticket>): Promise<boolean> {
    const requestTicketId = id;
    try {
      const response = await fetch(`/api/tickets/${requestTicketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const payload = await readJsonObject(response);

      if (response.ok) {
        if (activeTicketIdRef.current === requestTicketId && payload.ticket) {
          setData((prev) => prev ? { ...prev, ticket: payload.ticket as Ticket } : prev);
        }
        return true;
      }

      if (activeTicketIdRef.current === requestTicketId) {
        if (response.status === 409) {
          const reloaded = await reloadTicket(requestTicketId);
          if (activeTicketIdRef.current !== requestTicketId) return false;
          setActionResult({
            type: 'error',
            message: reloaded
              ? 'This ticket changed in another session. The latest version was reloaded; review it and try again.'
              : 'This ticket changed in another session, and the latest version could not be reloaded. Refresh before trying again.',
          });
        } else {
          setActionResult({ type: 'error', message: responseError(payload, 'Ticket update failed') });
        }
      }
      return false;
    } catch {
      if (activeTicketIdRef.current === requestTicketId) {
        setActionResult({ type: 'error', message: 'Ticket update failed. Check your connection and try again.' });
      }
      return false;
    } finally {
      if (activeTicketIdRef.current === requestTicketId) {
        setShowStatusDropdown(false);
        setShowPriorityDropdown(false);
      }
    }
  }

  async function sendMessage(setStatus?: string) {
    if (!replyContent.trim() && !setStatus) return;
    const requestTicketId = id;
    setSending(true);

    // If only setting status with no content (e.g. quick resolve)
    if (!replyContent.trim() && setStatus) {
      await updateTicket({ status: setStatus as Ticket['status'] });
      if (activeTicketIdRef.current === requestTicketId) setSending(false);
      return;
    }

    const requestContent = replyContent.trim();
    const requestMode = replyMode;
    const requestGenerationId = requestMode === 'reply' ? draftGenerationId : null;
    const requestContextVersion = data?.ticket.context_version ?? 0;
    const signature = JSON.stringify({
      ticket: requestTicketId,
      content: requestContent,
      mode: requestMode,
      generation: requestGenerationId,
      setStatus: setStatus ?? null,
      contextVersion: requestContextVersion,
    });
    const pending = pendingSendRef.current;
    const idempotencyKey = pending?.signature === signature ? pending.key : crypto.randomUUID();
    pendingSendRef.current = { key: idempotencyKey, signature };

    const body: Record<string, unknown> = {
      content: requestContent,
      sender_type: requestMode === 'note' ? 'system' : 'agent',
      is_internal_note: requestMode === 'note',
      idempotency_key: idempotencyKey,
      context_version: requestContextVersion,
      ...(requestMode === 'reply' && requestGenerationId
        ? { generation_id: requestGenerationId, ai_generated: true }
        : {}),
    };
    if (setStatus) body.set_status = setStatus;

    try {
      const automationResponse = await fetch(`/api/support/${requestTicketId}/state`);
      const automation = await readJsonObject(automationResponse);
      if (!automationResponse.ok) throw new Error(responseError(automation, 'Could not check automation state.'));
      if (automation.ready) {
        const takeover = await fetch(`/api/support/${requestTicketId}/takeover`, { method: 'POST' });
        const takeoverBody = await readJsonObject(takeover);
        if (!takeover.ok) throw new Error(responseError(takeoverBody, 'Could not take over this ticket.'));
      }
      const response = await fetch(`/api/tickets/${requestTicketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await readJsonObject(response);
      if (activeTicketIdRef.current !== requestTicketId) return;

      if (response.ok && payload.delivery_pending === true) {
        setActionResult({
          type: 'error',
          message: 'Delivery is still being confirmed. Wait a moment, then retry; the same operation will be resumed safely.',
        });
      } else if (response.ok) {
        setData((prev) => {
          if (!prev || !payload.message) return prev;
          const nextMessage = payload.message as TicketMessage;
          return {
            ...prev,
            messages: prev.messages.some((existing) => existing.id === nextMessage.id)
              ? prev.messages.map((existing) => existing.id === nextMessage.id ? nextMessage : existing)
              : [...prev.messages, nextMessage],
            ticket: payload.ticket ? payload.ticket as Ticket : prev.ticket,
          };
        });
        if (typeof payload.email_error === 'string' && requestMode === 'reply') {
          setActionResult({ type: 'error', message: `Saved to ticket, but the email failed to send: ${payload.email_error}` });
        } else if (typeof payload.status_warning === 'string') {
          // Delivery may have succeeded while the database finalizer response
          // was lost. Keep the exact content + idempotency key so Retry resumes
          // that operation instead of creating a second message.
          setActionResult({ type: 'error', message: `${payload.status_warning} Retry to reconcile the same send safely.` });
        } else {
          pendingSendRef.current = null;
          setReplyContent('');
          setDraftGenerationId(null);
    setDraftQuality(null);
        }
      } else {
        setActionResult({ type: 'error', message: responseError(payload, 'Failed to send reply') });
      }
    } catch (error) {
      if (activeTicketIdRef.current === requestTicketId) {
        setActionResult({ type: 'error', message: error instanceof Error ? error.message : 'Failed to send reply. Check your connection and try again.' });
      }
    } finally {
      if (activeTicketIdRef.current === requestTicketId) setSending(false);
    }
  }

  async function handleAiTool(action: 'draft' | 'summarize' | 'suggest') {
    const requestTicketId = id;
    aiRequestRef.current?.abort();
    const controller = new AbortController();
    aiRequestRef.current = controller;
    setAiLoading(action);
    try {
      const res = await fetch(`/api/tickets/${requestTicketId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(action === 'draft' && agentContext.trim() ? { agentContext: agentContext.trim() } : {}) }),
        signal: controller.signal,
      });
      const result = await readJsonObject(res);

      if (controller.signal.aborted || activeTicketIdRef.current !== requestTicketId) return;

      if (!res.ok) {
        console.error('AI error:', result.error);
        setActionResult({ type: 'error', message: responseError(result, `AI ${action} failed`) });
        return;
      }

      const text = typeof result.content === 'string'
        ? result.content
        : typeof result.text === 'string'
          ? result.text
          : '';
      if (action === 'draft') {
        setDraftQuality(result.quality ? {text, review: result.quality as DraftReview} : null);
        setReplyContent(text);
        setDraftGenerationId(typeof result.generation_id === 'string' ? result.generation_id : null);
        const confidence = Number(result.confidence);
        const coverage = Number(result.evidence_coverage);
        const uncertainties = Array.isArray(result.uncertainties)
          ? result.uncertainties.filter((item): item is string => typeof item === 'string').slice(0, 2)
          : [];
        if (result.learning_capture_available === false) {
          setActionResult({
            type: 'error',
            message: 'Draft ready, but its learning lineage could not be saved. Review carefully; edits to this draft will not train Autopilot.',
          });
        } else if (Number.isFinite(confidence) || Number.isFinite(coverage) || uncertainties.length) {
          const metrics = [
            Number.isFinite(confidence) ? `${Math.round(confidence * 100)}% raw confidence` : '',
            Number.isFinite(coverage) ? `${Math.round(coverage * 100)}% evidence coverage` : '',
          ].filter(Boolean).join(' · ');
          setActionResult({
            type: 'success',
            message: `AI draft ready${metrics ? ` · ${metrics}` : ''}${uncertainties.length ? ` · Verify: ${uncertainties.join('; ')}` : ''}`,
          });
        }
      } else if (action === 'summarize') {
        setAiSummary(text);
      } else if (action === 'suggest') {
        if (Array.isArray(result.steps)) {
          setAiSteps(result.steps.filter((step): step is string => typeof step === 'string'));
        } else {
          setAiSteps(text.split('\n').filter((l: string) => l.trim()));
        }
      }
    } catch (err) {
      if (!controller.signal.aborted && activeTicketIdRef.current === requestTicketId) {
        console.error('AI tool error:', err);
        setActionResult({ type: 'error', message: `AI ${action} failed. Try again.` });
      }
    } finally {
      if (aiRequestRef.current === controller) {
        aiRequestRef.current = null;
        if (activeTicketIdRef.current === requestTicketId) setAiLoading(null);
      }
    }
  }

  function updateReplyFromAgent(next: string | ((current: string) => string)) {
    // Once the agent starts typing or inserts known content, an in-flight draft
    // is stale and must not overwrite that newer human input when it resolves.
    if (aiLoading === 'draft') {
      aiRequestRef.current?.abort();
      aiRequestRef.current = null;
      setAiLoading(null);
    }
    // Editing starts a new logical send. A lost-response retry keeps its key
    // only while the exact composer operation remains untouched.
    pendingSendRef.current = null;
    setReplyContent((current) => typeof next === 'function' ? next(current) : next);
  }

  async function assignTo(userId: string | null) {
    setShowAssignDropdown(false);
    await updateTicket({ assigned_to: userId } as Partial<Ticket>);
  }

  async function snoozeUntil(until: Date | null) {
    setShowSnoozeDropdown(false);
    const requestTicketId = id;
    const updated = await updateTicket({ snoozed_until: until ? until.toISOString() : null } as Partial<Ticket>);
    if (updated && activeTicketIdRef.current === requestTicketId) {
      setActionResult({
        type: 'success',
        message: until ? `Snoozed until ${formatSnoozeUntil(until.toISOString())}` : 'Snooze cleared',
      });
    }
  }

  async function mergeTicket() {
    if (!mergeSourceId) return;
    const requestTicketId = id;
    setMergeLoading(true);
    try {
      const res = await fetch(`/api/tickets/${requestTicketId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: mergeSourceId }),
      });
      const result = await readJsonObject(res);
      if (activeTicketIdRef.current !== requestTicketId) return;
      if (res.ok) {
        setActionResult({ type: 'success', message: `Merged ticket #${result.merged} into this one` });
        setShowMergeModal(false);
        setMergeSourceId(null);
        // Reload the full thread — merged messages now belong here
        await reloadTicket(requestTicketId);
      } else {
        setActionResult({ type: 'error', message: responseError(result, 'Merge failed') });
      }
    } catch {
      if (activeTicketIdRef.current === requestTicketId) {
        setActionResult({ type: 'error', message: 'Merge failed' });
      }
    } finally {
      if (activeTicketIdRef.current === requestTicketId) setMergeLoading(false);
    }
  }

  // Keyboard shortcuts (detail scope). J/K navigation lives in TicketWorkflowBar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') { e.preventDefault(); setShowShortcuts((v) => !v); return; }
      if (e.key === 'Escape') { setShowShortcuts(false); setShowMergeModal(false); return; }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault(); setReplyMode('reply'); replyTextareaRef.current?.focus();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault(); setReplyMode('note'); replyTextareaRef.current?.focus();
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault(); updateTicket({ status: 'resolved' });
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault(); if (me?.userId) assignTo(me.userId);
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault(); setShowSnoozeDropdown((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.userId, id]);

  async function addTag() {
    if (!newTag.trim()) return;
    const currentTags = data?.ticket.tags ?? [];
    if (currentTags.includes(newTag.trim())) { setNewTag(''); return; }
    await updateTicket({ tags: [...currentTags, newTag.trim()] } as Partial<Ticket>);
    setNewTag('');
    setShowTagInput(false);
  }

  async function removeTag(tag: string) {
    const currentTags = data?.ticket.tags ?? [];
    await updateTicket({ tags: currentTags.filter((t) => t !== tag) } as Partial<Ticket>);
  }

  const searchKB = useCallback(async () => {
    if (!kbQuery.trim()) { setKbResults([]); return; }
    const requestTicketId = id;
    setKbSearching(true);
    try {
      const res = await fetch(`/api/knowledge/search?q=${encodeURIComponent(kbQuery)}`);
      const data = await res.json();
      if (activeTicketIdRef.current === requestTicketId) setKbResults(data.documents ?? []);
    } catch {
      if (activeTicketIdRef.current === requestTicketId) setKbResults([]);
    } finally {
      if (activeTicketIdRef.current === requestTicketId) setKbSearching(false);
    }
  }, [id, kbQuery]);

  function extractOrderNumericId(gid: string) {
    return gid.split('/').pop() || gid;
  }

  async function fetchOrderDetail(orderId: string) {
    const requestTicketId = id;
    setOrderDetailLoading(true);
    try {
      const numId = extractOrderNumericId(orderId);
      const res = await fetch(`/api/orders/${numId}`);
      const data = await res.json();
      if (activeTicketIdRef.current !== requestTicketId) return;
      if (res.ok && data.order) setOrderDetail(data.order);
      else console.error('Order detail error:', data.error);
    } catch (err) {
      if (activeTicketIdRef.current === requestTicketId) console.error('Failed to fetch order detail:', err);
    } finally {
      if (activeTicketIdRef.current === requestTicketId) setOrderDetailLoading(false);
    }
  }

  function handleExpandOrder(orderId: string) {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      setOrderDetail(null);
    } else {
      setExpandedOrderId(orderId);
      fetchOrderDetail(orderId);
    }
  }

  async function handleCancelOrder() {
    if (!expandedOrderId) return;
    const requestTicketId = id;
    const requestedOrderId = expandedOrderId;
    setCancelLoading(true);
    try {
      const numId = extractOrderNumericId(requestedOrderId);
      const res = await fetch(`/api/orders/${numId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reason: cancelReason, refund: cancelRefund, restock: cancelRestock }),
      });
      const data = await res.json();
      if (activeTicketIdRef.current !== requestTicketId) return;

      const cancellationPending = res.status === 202
        || data?.pending === true
        || (data?.success === true && data?.completed === false);
      if (cancellationPending) {
        setCancelPendingOrderId(requestedOrderId);
        setCancelLoading(false);
        setActionResult({
          type: 'pending',
          message: data?.message || 'Shopify accepted the cancellation. Waiting for the cancelled order state to appear...',
        });

        const retryAfterHeader = Number.parseInt(res.headers.get('Retry-After') || '3', 10);
        const retryDelayMs = Math.max(1, Number.isFinite(retryAfterHeader) ? retryAfterHeader : 3) * 1_000;
        let confirmedOrder: OrderDetailData | null = null;
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          if (activeTicketIdRef.current !== requestTicketId) return;
          try {
            const confirmationResponse = await fetch(`/api/orders/${numId}`, { cache: 'no-store' });
            if (!confirmationResponse.ok) continue;
            const confirmation = await confirmationResponse.json();
            if (confirmation?.order) {
              setOrderDetail(confirmation.order as OrderDetailData);
              if (confirmation.order.cancelledAt) {
                confirmedOrder = confirmation.order as OrderDetailData;
                break;
              }
            }
          } catch {
            // A transient read failure does not mean the accepted cancellation
            // failed. Continue polling without offering a duplicate mutation.
          }
        }

        if (!confirmedOrder) {
          setActionResult({
            type: 'pending',
            message: 'Shopify is still processing this cancellation. Refresh the ticket before taking another cancellation action.',
          });
          return;
        }

        setCancelPendingOrderId(null);
        setActionResult({ type: 'success', message: `Order cancelled at ${new Date(confirmedOrder.cancelledAt!).toLocaleString()}` });
        setShowCancelModal(false);
        await fetchOrderDetail(requestedOrderId);
        // Re-fetch orders list
        if (ticket.customer_email) {
          fetch(`/api/tickets/${requestTicketId}/customer`).then(r => r.json()).then(res => {
            if (activeTicketIdRef.current === requestTicketId && res.orders) setCustomerOrders(res.orders);
          }).catch(() => {});
        }
        return;
      }

      if (res.ok && data?.success === true && (data?.cancelledAt || data?.order?.cancelledAt)) {
        setCancelPendingOrderId(null);
        setActionResult({ type: 'success', message: data.message || 'Order cancelled' });
        if (data.order) setOrderDetail(data.order as OrderDetailData);
        setShowCancelModal(false);
        await fetchOrderDetail(requestedOrderId);
        if (ticket.customer_email) {
          fetch(`/api/tickets/${requestTicketId}/customer`).then(r => r.json()).then(result => {
            if (activeTicketIdRef.current === requestTicketId && result.orders) setCustomerOrders(result.orders);
          }).catch(() => {});
        }
      } else {
        setActionResult({ type: 'error', message: data?.message || 'Failed to cancel order' });
      }
    } catch {
      if (activeTicketIdRef.current === requestTicketId) {
        setActionResult({ type: 'error', message: 'Failed to cancel order' });
      }
    } finally {
      if (activeTicketIdRef.current === requestTicketId) setCancelLoading(false);
    }
  }

  async function handleRefundOrder() {
    if (!expandedOrderId || !refundAmount) return;
    const requestTicketId = id;
    setRefundLoading(true);
    try {
      const numId = extractOrderNumericId(expandedOrderId);
      const res = await fetch(`/api/orders/${numId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refund', amount: parseFloat(refundAmount), reason: refundReason || 'Customer requested refund', notify: refundNotify }),
      });
      const data = await res.json();
      if (activeTicketIdRef.current !== requestTicketId) return;
      setActionResult({ type: data.success ? 'success' : 'error', message: data.message });
      if (data.success) {
        setShowRefundModal(false);
        setRefundAmount('');
        setRefundReason('');
        fetchOrderDetail(expandedOrderId);
        if (ticket.customer_email) {
          fetch(`/api/tickets/${requestTicketId}/customer`).then(r => r.json()).then(res => {
            if (activeTicketIdRef.current === requestTicketId && res.orders) setCustomerOrders(res.orders);
          }).catch(() => {});
        }
      }
    } catch {
      if (activeTicketIdRef.current === requestTicketId) {
        setActionResult({ type: 'error', message: 'Failed to process refund' });
      }
    } finally {
      if (activeTicketIdRef.current === requestTicketId) setRefundLoading(false);
    }
  }

  function interpolateCanned(content: string): string {
    const ticket = data?.ticket;
    if (!ticket) return content;
    const firstName = customerProfile?.firstName || ticket.customer_name?.split(' ')[0] || '';
    const vars: Record<string, string> = {
      name: firstName,
      customer_name: ticket.customer_name || '',
      first_name: firstName,
      email: ticket.customer_email || '',
      ticket_number: `#${ticket.ticket_number}`,
      order_number: ticket.order_id || '',
      subject: ticket.subject,
    };
    let result = content;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), value);
    }
    return result;
  }

  function copyEmail() {
    if (!data?.ticket.customer_email) return;
    navigator.clipboard.writeText(data.ticket.customer_email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        <p style={{ color: 'var(--text-tertiary)' }}>Ticket not found</p>
        <Link href={basePath} className="text-sm mt-2 inline-block" style={{ color: 'var(--color-accent)' }}>
          Back to inbox
        </Link>
      </div>
    );
  }

  const { ticket, messages, events, aiConversationMessages, pastTickets } = data;
  const sourceMeta = SOURCE_META[ticket.source];
  const triage = ticketTriage(ticket);
  const csat = ticketCsat(ticket);
  const snoozedUntilIso = ticketSnoozedUntil(ticket);
  const assignee = roster.find((a) => a.id === ticket.assigned_to) ?? null;
  const sentimentMeta = triage?.sentiment ? SENTIMENT_META[triage.sentiment] : null;
  const suggestedTags = (triage?.suggested_tags ?? []).filter((t) => !ticket.tags?.includes(t)).slice(0, 4);
  const mergeCandidates = (pastTickets ?? []).filter((pt) => pt.status === 'open' || pt.status === 'pending');
  const cancellationRestockAllowed = orderDetail?.fulfillmentStatus === 'UNFULFILLED'
    && !orderDetail.fulfillments.some((fulfillment) => fulfillment.trackingInfo.length > 0);

  return (
    <div className="space-y-4 os-manual-ticket">
      <TicketAutomationControl ticketId={id} />
      {/* Workflow / triage bar — queue position, remaining, next/prev, keyboard nav */}
      <TicketWorkflowBar ticketId={id} basePath={basePath} />

      {/* Autopilot banner — a proposed AI action plan is waiting for review */}
      {ticketAutopilot(ticket)?.status === 'proposed' && (
        <Link
          href={`/autopilot?ticket=${ticket.id}`}
          className="flex items-center gap-2.5 rounded-xl px-4 py-3"
          style={{
            background: 'color-mix(in srgb, var(--color-source-ai) 8%, var(--bg-primary))',
            border: '1px solid color-mix(in srgb, var(--color-source-ai) 30%, transparent)',
          }}
        >
          <Sparkles size={15} style={{ color: 'var(--color-source-ai)', flexShrink: 0 }} />
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
            <strong>Autopilot plan waiting for review.</strong>{' '}
            {ticketAutopilot(ticket)!.actions.length} proposed action
            {ticketAutopilot(ticket)!.actions.length === 1 ? '' : 's'}
            {' '}<span style={{ color: 'var(--text-tertiary)' }}>— {ticketAutopilot(ticket)!.analysis.summary}</span>
          </span>
          <span className="ml-auto text-xs font-semibold flex-shrink-0" style={{ color: 'var(--color-source-ai)' }}>
            Review →
          </span>
        </Link>
      )}

      {/* Ticket header */}
      <div
        className="rounded-xl p-4"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <div className="os-manual-heading flex items-start justify-between mb-3 gap-4">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <span className="text-sm font-mono" style={{ color: 'var(--text-tertiary)' }}>
              #{ticket.ticket_number}
            </span>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {ticket.subject}
            </h1>
            {sourceMeta && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded"
                style={{
                  backgroundColor: `color-mix(in srgb, ${sourceMeta.color} 12%, transparent)`,
                  color: sourceMeta.color,
                }}
              >
                <sourceMeta.icon size={11} />
                {sourceMeta.label}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Assignee dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowAssignDropdown(!showAssignDropdown)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                style={{
                  backgroundColor: assignee ? 'var(--color-accent-soft)' : 'var(--bg-tertiary)',
                  color: assignee ? 'var(--color-accent-strong)' : 'var(--text-secondary)',
                  border: `1px solid ${assignee ? 'var(--color-accent-ring)' : 'var(--border-primary)'}`,
                }}
                title="Assign this ticket (A = assign to me)"
              >
                <UserPlus size={12} />
                {assignee ? assignee.name : ticket.assigned_to ? 'Assigned' : 'Unassigned'}
                <ChevronDown size={12} />
              </button>
              {showAssignDropdown && (
                <div
                  className="absolute right-0 top-full mt-1 w-48 rounded-lg shadow-lg z-20 py-1 max-h-64 overflow-y-auto"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
                >
                  {me?.userId && (
                    <button
                      onClick={() => assignTo(me.userId)}
                      className="w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors"
                      style={{ color: 'var(--color-accent)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      Assign to me{me.name ? ` (${me.name})` : ''}
                    </button>
                  )}
                  <button
                    onClick={() => assignTo(null)}
                    className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                    style={{ color: 'var(--text-tertiary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    Unassigned
                  </button>
                  {roster.filter((a) => a.id !== me?.userId).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => assignTo(a.id)}
                      className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                      style={{ color: 'var(--text-primary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      {a.name}
                      {a.role === 'admin' && <span className="ml-1 text-[10px]" style={{ color: 'var(--text-quaternary)' }}>admin</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Snooze dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowSnoozeDropdown(!showSnoozeDropdown)}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
                style={{
                  backgroundColor: snoozedUntilIso ? 'rgba(168,85,247,0.1)' : 'var(--bg-tertiary)',
                  color: snoozedUntilIso ? 'var(--color-source-ai)' : 'var(--text-secondary)',
                  border: `1px solid ${snoozedUntilIso ? 'rgba(168,85,247,0.25)' : 'var(--border-primary)'}`,
                }}
                title="Snooze — hide from the queue until later (S)"
              >
                <AlarmClock size={12} />
                {snoozedUntilIso ? formatSnoozeUntil(snoozedUntilIso) : 'Snooze'}
              </button>
              {showSnoozeDropdown && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 rounded-lg shadow-lg z-20 py-1"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
                >
                  {snoozePresets().map((p) => (
                    <button
                      key={p.label}
                      onClick={() => snoozeUntil(p.until())}
                      className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                      style={{ color: 'var(--text-primary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      {p.label}
                    </button>
                  ))}
                  {snoozedUntilIso && (
                    <button
                      onClick={() => snoozeUntil(null)}
                      className="w-full text-left px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{ color: 'var(--color-danger)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      Clear snooze
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Merge */}
            {(ticket.status === 'open' || ticket.status === 'pending') && mergeCandidates.length > 0 && (
              <button
                onClick={() => setShowMergeModal(true)}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
                title="Merge another ticket from this customer into this one"
              >
                <GitMerge size={12} /> Merge
              </button>
            )}

            {/* Status dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1"
                style={{
                  backgroundColor: STATUS_STYLES[ticket.status]?.bg,
                  color: STATUS_STYLES[ticket.status]?.text,
                }}
              >
                {ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}
                <ChevronDown size={12} />
              </button>
              {showStatusDropdown && (
                <div
                  className="absolute right-0 top-full mt-1 w-36 rounded-lg shadow-lg z-20 py-1"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                  }}
                >
                  {(['open', 'pending', 'resolved', 'closed'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => updateTicket({ status: s })}
                      className="w-full text-left px-3 py-1.5 text-xs capitalize transition-colors"
                      style={{ color: 'var(--text-primary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: STATUS_STYLES[s].text }} />
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Priority dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowPriorityDropdown(!showPriorityDropdown)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1"
                style={{
                  backgroundColor: PRIORITY_STYLES[ticket.priority]?.bg,
                  color: PRIORITY_STYLES[ticket.priority]?.text,
                }}
              >
                {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                <ChevronDown size={12} />
              </button>
              {showPriorityDropdown && (
                <div
                  className="absolute right-0 top-full mt-1 w-36 rounded-lg shadow-lg z-20 py-1"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                  }}
                >
                  {(['urgent', 'high', 'medium', 'low'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => updateTicket({ priority: p })}
                      className="w-full text-left px-3 py-1.5 text-xs capitalize transition-colors"
                      style={{ color: 'var(--text-primary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: PRIORITY_STYLES[p].text }} />
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-center gap-2 flex-wrap">
          <Tag size={12} style={{ color: 'var(--text-tertiary)' }} />
          {ticket.tags?.map((tag, i) => {
            const tc = getTagColor(i);
            return (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
                style={{ backgroundColor: tc.bg, color: tc.text }}
              >
                {tag}
                <button onClick={() => removeTag(tag)} className="hover:opacity-70">
                  <X size={10} />
                </button>
              </span>
            );
          })}
          {showTagInput ? (
            <div className="flex items-center gap-1">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addTag(); if (e.key === 'Escape') setShowTagInput(false); }}
                className="text-xs px-2 py-0.5 rounded w-24 focus:outline-none"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                }}
                autoFocus
                placeholder="Tag name..."
              />
              <button onClick={addTag} className="text-xs" style={{ color: 'var(--color-accent)' }}>Add</button>
            </div>
          ) : (
            <button
              onClick={() => setShowTagInput(true)}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-tertiary)',
              }}
            >
              <Plus size={10} /> Add tag
            </button>
          )}

          {/* SLA indicator */}
          {ticket.sla_deadline && (
            <span className="ml-auto flex items-center gap-1 text-xs font-medium" style={{
              color: ticket.sla_breached ? 'var(--color-danger)' : (() => {
                const diff = new Date(ticket.sla_deadline).getTime() - Date.now();
                return diff < 3600000 ? 'var(--color-warning)' : 'var(--color-success)';
              })(),
            }}>
              {ticket.sla_breached ? <AlertCircle size={12} /> : <Clock size={12} />}
              {ticket.sla_breached ? 'SLA Breached' : (() => {
                const diff = new Date(ticket.sla_deadline).getTime() - Date.now();
                if (diff <= 0) return 'SLA Breached';
                const m = Math.floor(diff / 60000);
                if (m < 60) return `${m}m left`;
                const h = Math.floor(m / 60);
                return `${h}h ${m % 60}m left`;
              })()}
            </span>
          )}
        </div>

        {/* AI triage strip — written by the backend on intake */}
        {(triage || csat) && (
          <div
            className="flex items-center gap-2 flex-wrap mt-3 pt-3"
            style={{ borderTop: '1px solid var(--border-secondary)' }}
          >
            <Sparkles size={12} style={{ color: 'var(--color-source-ai)', flexShrink: 0 }} />
            {sentimentMeta && (
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded"
                style={{ backgroundColor: `color-mix(in srgb, ${sentimentMeta.color} 12%, transparent)`, color: sentimentMeta.color }}
              >
                {sentimentMeta.label}
              </span>
            )}
            {triage?.intent && (
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded capitalize"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              >
                {triage.intent.replace(/_/g, ' ')}
              </span>
            )}
            {triage?.language && triage.language.toLowerCase() !== 'en' && triage.language.toLowerCase() !== 'english' && (
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded uppercase"
                style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: 'var(--color-info)' }}
                title="Customer language"
              >
                {triage.language}
              </span>
            )}
            {csat && (
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded inline-flex items-center gap-1"
                style={{
                  backgroundColor: csat.score >= 4 ? 'rgba(34,197,94,0.1)' : csat.score <= 2 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                  color: csat.score >= 4 ? 'var(--color-success)' : csat.score <= 2 ? 'var(--color-danger)' : 'var(--color-warning)',
                }}
                title={`Customer satisfaction rating${csat.at ? ` — ${formatDate(csat.at)}` : ''}`}
              >
                <Star size={10} fill="currentColor" /> CSAT {csat.score}/5
              </span>
            )}
            {triage?.summary && (
              <span className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)', maxWidth: 420 }} title={triage.summary}>
                {triage.summary}
              </span>
            )}
            {suggestedTags.length > 0 && (
              <span className="inline-flex items-center gap-1 ml-auto">
                {suggestedTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => updateTicket({ tags: [...(ticket.tags ?? []), t] } as Partial<Ticket>)}
                    className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
                    style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', border: '1px dashed var(--border-primary)' }}
                    title="AI-suggested tag — click to add"
                  >
                    + {t}
                  </button>
                ))}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main content: thread + sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
        {/* Left: Conversation thread + Composer */}
        <div className="space-y-4">
          {/* AI Context (collapsible) */}
          {ticket.source === 'ai_escalation' && ticket.conversation_id && (
            <div
              className="rounded-xl overflow-hidden"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <button
                onClick={() => setAiContextOpen(!aiContextOpen)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span className="flex items-center gap-2">
                  <Bot size={14} style={{ color: 'var(--color-source-ai)' }} />
                  AI Conversation Context
                  {aiConversationMessages && (
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      ({aiConversationMessages.length} messages)
                    </span>
                  )}
                </span>
                {aiContextOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {aiContextOpen && aiConversationMessages && (
                <div
                  className="px-4 pb-4 space-y-3 max-h-80 overflow-y-auto"
                  style={{ borderTop: '1px solid var(--border-secondary)' }}
                >
                  {aiConversationMessages.map((m) => (
                    <div key={m.id} className="flex gap-2 pt-3">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: m.role === 'user'
                            ? 'rgba(59,130,246,0.12)'
                            : m.role === 'assistant'
                            ? 'rgba(168,85,247,0.12)'
                            : 'rgba(156,163,175,0.12)',
                        }}
                      >
                        {m.role === 'user' ? <User size={12} style={{ color: 'var(--color-info)' }} /> :
                         m.role === 'assistant' ? <Bot size={12} style={{ color: 'var(--color-source-ai)' }} /> :
                         <Cpu size={12} style={{ color: '#9ca3af' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-medium capitalize" style={{ color: 'var(--text-tertiary)' }}>
                          {m.role === 'assistant' ? 'AI' : m.role}
                        </span>
                        <p className="text-xs whitespace-pre-wrap break-words mt-0.5" style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                          {m.content}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Message thread */}
          <div
            className="rounded-xl"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              overflow: 'hidden',
            }}
          >
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
              <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <MessageSquare size={14} />
                Thread ({messages.length})
              </h3>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-4 space-y-4" style={{ overflowX: 'hidden' }}>
              {messages.length === 0 ? (
                <p className="text-sm text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
                  No messages yet
                </p>
              ) : (
                messages.map((msg) => {
                  const isNote = msg.is_internal_note;
                  const isSystem = msg.sender_type === 'system';
                  const isCustomer = msg.sender_type === 'customer';
                  const isAiDraft = msg.sender_type === 'ai_draft';

                  return (
                    <div
                      key={msg.id}
                      className="rounded-lg px-4 py-3"
                      style={{
                        backgroundColor: isNote
                          ? 'rgba(245,158,11,0.08)'
                          : isSystem
                          ? 'var(--bg-secondary)'
                          : 'transparent',
                        border: isNote
                          ? '1px solid rgba(245,158,11,0.2)'
                          : isSystem
                          ? 'none'
                          : '1px solid var(--border-secondary)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{
                            backgroundColor: isCustomer
                              ? 'rgba(59,130,246,0.12)'
                              : isAiDraft
                              ? 'rgba(168,85,247,0.12)'
                              : isSystem
                              ? 'rgba(156,163,175,0.12)'
                              : 'rgba(99,102,241,0.12)',
                          }}
                        >
                          {isCustomer ? <User size={12} style={{ color: 'var(--color-info)' }} /> :
                           isAiDraft ? <Bot size={12} style={{ color: 'var(--color-source-ai)' }} /> :
                           isSystem ? <Cpu size={12} style={{ color: '#9ca3af' }} /> :
                           <User size={12} style={{ color: 'var(--color-info)' }} />}
                        </div>
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                          {msg.sender_name || msg.sender_type}
                        </span>
                        {isNote && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(245,158,11,0.15)', color: 'var(--color-warning)' }}
                          >
                            Internal Note
                          </span>
                        )}
                        {isAiDraft && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(168,85,247,0.12)', color: 'var(--color-source-ai)' }}
                          >
                            AI Draft
                          </span>
                        )}
                        {/* Outbound email delivery status (agent replies only) */}
                        {msg.sender_type === 'agent' && !isNote && (msg.metadata as Record<string, unknown> | null)?.email_status === 'failed' && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                            style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)' }}
                            title={String((msg.metadata as Record<string, unknown>)?.email_error || 'Email failed to send')}
                          >
                            <MailX size={10} /> Email failed
                          </span>
                        )}
                        {msg.sender_type === 'agent' && !isNote && !!msg.email_message_id && (
                          <span
                            className="text-[10px] inline-flex items-center gap-1"
                            style={{ color: 'var(--color-success)' }}
                            title="Emailed to the customer"
                          >
                            <MailCheck size={11} />
                          </span>
                        )}
                        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                          {formatDate(msg.created_at)}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere', wordBreak: 'break-word', maxWidth: '100%', overflowX: 'hidden' }}>
                        {msg.content}
                      </p>
                      {/* Attachments */}
                      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {(msg.attachments as Array<Record<string, unknown>>).map((att, ai) => {
                            const url = typeof att?.url === 'string' ? att.url : typeof att === 'string' ? att : null;
                            const name = (typeof att?.name === 'string' && att.name) || (typeof att?.filename === 'string' && att.filename) || (url ? url.split('/').pop() : `attachment ${ai + 1}`);
                            const isImage = !!url && /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url);
                            if (url && isImage) {
                              return (
                                <a key={ai} href={url} target="_blank" rel="noopener noreferrer" className="block">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={url} alt={String(name)} className="rounded-lg object-cover" style={{ width: 84, height: 84, border: '1px solid var(--border-primary)' }} />
                                </a>
                              );
                            }
                            return (
                              <a
                                key={ai}
                                href={url ?? '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg"
                                style={{ backgroundColor: 'var(--bg-tertiary)', color: url ? 'var(--color-accent)' : 'var(--text-tertiary)', border: '1px solid var(--border-primary)' }}
                              >
                                <Paperclip size={10} /> {String(name)}
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Reply Composer */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            {/* Tabs */}
            <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--border-secondary)' }}>
              <div className="flex gap-1">
                <button
                  onClick={() => setReplyMode('reply')}
                  className="px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors"
                  style={{
                    backgroundColor: replyMode === 'reply' ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
                    color: replyMode === 'reply' ? 'var(--color-accent)' : 'var(--text-secondary)',
                  }}
                >
                  <Send size={11} /> Reply
                </button>
                <button
                  onClick={() => setReplyMode('note')}
                  className="px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors"
                  style={{
                    backgroundColor: replyMode === 'note' ? 'rgba(245,158,11,0.12)' : 'transparent',
                    color: replyMode === 'note' ? 'var(--color-warning)' : 'var(--text-secondary)',
                  }}
                >
                  <StickyNote size={11} /> Internal Note
                </button>
              </div>

              {/* Canned responses */}
              <div className="relative">
                <button
                  onClick={() => setShowCannedDropdown(!showCannedDropdown)}
                  className="text-xs px-2 py-1 rounded transition-colors flex items-center gap-1"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <FileText size={11} /> Canned Response
                  <ChevronDown size={10} />
                </button>
                {showCannedDropdown && (
                  <div
                    className="absolute right-0 top-full mt-1 w-72 max-h-56 overflow-y-auto rounded-lg shadow-lg z-20 py-1"
                    style={{
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-primary)',
                    }}
                  >
                    {cannedResponses.length === 0 ? (
                      <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>No canned responses</p>
                    ) : (
                      cannedResponses.map((cr) => (
                        <button
                          key={cr.id}
                          onClick={() => {
                            updateReplyFromAgent(interpolateCanned(cr.content));
                            setShowCannedDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs transition-colors"
                          style={{ color: 'var(--text-primary)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <span className="font-medium">{cr.name}</span>
                          {cr.category && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>
                              {cr.category}
                            </span>
                          )}
                          <span className="block truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                            {interpolateCanned(cr.content).slice(0, 80)}...
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Textarea */}
            <div className="p-4">
              {replyMode === 'reply' && draftQuality && <DraftQuality review={draftQuality.review} stale={draftQuality.text !== replyContent} />}
                <textarea
                ref={replyTextareaRef}
                value={replyContent}
                onChange={(e) => updateReplyFromAgent(e.target.value)}
                rows={5}
                placeholder={replyMode === 'note' ? 'Write an internal note...' : 'Write your reply...'}
                className="w-full text-sm rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
            </div>

            {/* Agent Context + Actions */}
            {showAgentContext && (
              <div className="px-4 pb-2">
                <div
                  className="rounded-lg p-2.5"
                  style={{
                    backgroundColor: 'rgba(168,85,247,0.06)',
                    border: '1px solid rgba(168,85,247,0.2)',
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Cpu size={11} style={{ color: 'var(--color-source-ai)' }} />
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--color-source-ai)' }}>Agent Instructions</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>— overrides presets & KB</span>
                  </div>
                  <textarea
                    value={agentContext}
                    onChange={(e) => setAgentContext(e.target.value)}
                    rows={2}
                    placeholder='e.g. "I will call them in 15 min. Ask for their phone number. My name is Vance."'
                    className="w-full text-xs rounded-md px-2.5 py-1.5 resize-y focus:outline-none focus:ring-1"
                    style={{
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid rgba(168,85,247,0.15)',
                      color: 'var(--text-primary)',
                      '--tw-ring-color': 'rgba(168,85,247,0.5)',
                    } as React.CSSProperties}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center justify-between px-4 pb-4 flex-wrap gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Agent Context toggle */}
                <button
                  onClick={() => setShowAgentContext(!showAgentContext)}
                  className="text-xs px-3 py-2 rounded-lg font-medium transition-colors flex items-center gap-1.5"
                  style={{
                    backgroundColor: showAgentContext ? 'rgba(168,85,247,0.15)' : 'var(--bg-tertiary)',
                    color: showAgentContext ? 'var(--color-source-ai)' : 'var(--text-secondary)',
                    border: `1px solid ${showAgentContext ? 'rgba(168,85,247,0.3)' : 'var(--border-primary)'}`,
                  }}
                >
                  <Cpu size={12} />
                  {showAgentContext ? 'Hide Instructions' : 'Add Instructions'}
                </button>
                {/* AI Generate Reply — primary CTA */}
                <button
                  onClick={() => handleAiTool('draft')}
                  disabled={aiLoading === 'draft'}
                  className="text-xs px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  style={{
                    backgroundColor: 'rgba(168,85,247,0.12)',
                    color: 'var(--color-source-ai)',
                    border: '1px solid rgba(168,85,247,0.25)',
                  }}
                >
                  {aiLoading === 'draft' ? (
                    <><Loader2 size={12} className="animate-spin" /> Generating...</>
                  ) : (
                    <><Sparkles size={12} /> Generate Reply with AI</>
                  )}
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {replyMode === 'reply' && (
                  <>
                    <button
                      onClick={() => sendMessage('pending')}
                      disabled={!replyContent.trim() || sending}
                      className="text-xs px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-40"
                      style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-primary)',
                      }}
                    >
                      Send & Set Pending
                    </button>
                    <button
                      onClick={() => sendMessage('resolved')}
                      disabled={!replyContent.trim() || sending}
                      className="text-xs px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-40"
                      style={{
                        backgroundColor: 'rgba(34,197,94,0.1)',
                        color: 'var(--color-success)',
                        border: '1px solid rgba(34,197,94,0.2)',
                      }}
                    >
                      Send & Resolve
                    </button>
                  </>
                )}
                <button
                  onClick={() => sendMessage()}
                  disabled={!replyContent.trim() || sending}
                  className="text-xs px-4 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-40"
                  style={{ backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-fg)' }}
                >
                  {sending ? 'Sending...' : replyMode === 'note' ? 'Add Note' : 'Send Reply'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="space-y-4">
          {/* Customer Profile Card */}
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
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                    color: 'var(--color-accent)',
                  }}
                >
                  {(customerProfile?.firstName || ticket.customer_name || ticket.customer_email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {customerProfile
                      ? `${customerProfile.firstName || ''} ${customerProfile.lastName || ''}`.trim() || ticket.customer_name || ticket.customer_email || 'Unknown'
                      : ticket.customer_name || ticket.customer_email || 'Unknown'
                    }
                  </p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                      {ticket.customer_email}
                    </p>
                    <button onClick={copyEmail} className="flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                      {copied ? <CheckCircle2 size={11} style={{ color: 'var(--color-success)' }} /> : <Copy size={11} />}
                    </button>
                  </div>
                  {customerProfile?.phone && (
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {customerProfile.phone}
                    </p>
                  )}
                  {ticket.tags?.includes('trade-member') && (
                    <div className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded mt-1"
                      style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: 'var(--color-accent)' }}>
                      Trade Member
                    </div>
                  )}
                </div>
              </div>

              {/* Shopify customer stats */}
              {customerLoading ? (
                <div className="flex items-center gap-2 py-3 justify-center">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading from Shopify...</span>
                </div>
              ) : customerProfile ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <ShoppingCart size={10} style={{ color: 'var(--text-tertiary)' }} />
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Orders</span>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {customerProfile.ordersCount}
                    </p>
                  </div>
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <DollarSign size={10} style={{ color: 'var(--text-tertiary)' }} />
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Lifetime Value</span>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      ${parseFloat(customerProfile.totalSpent).toFixed(0)}
                    </p>
                  </div>
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Calendar size={10} style={{ color: 'var(--text-tertiary)' }} />
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Since</span>
                    </div>
                    <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {new Date(customerProfile.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Star size={10} style={{ color: 'var(--text-tertiary)' }} />
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Status</span>
                    </div>
                    <p className="text-xs font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                      {customerProfile.state?.toLowerCase() || 'active'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs py-2" style={{ color: 'var(--text-tertiary)' }}>
                  {ticket.customer_email ? 'No Shopify profile found' : 'No customer email'}
                </p>
              )}

              {/* Shopify customer tags */}
              {customerProfile?.tags && customerProfile.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {customerProfile.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Customer note from Shopify */}
              {customerProfile?.note && (
                <div className="text-xs rounded-lg px-2.5 py-2" style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', color: 'var(--text-secondary)' }}>
                  <span className="text-[10px] font-medium block mb-0.5" style={{ color: 'var(--color-warning)' }}>Shopify Note</span>
                  {customerProfile.note}
                </div>
              )}
            </div>
          </div>

          {/* Action Result Toast */}
          {actionResult && (
            <div
              className="rounded-xl p-3 flex items-center gap-2 text-xs font-medium"
              style={{
                backgroundColor: actionResult.type === 'success'
                  ? 'rgba(34,197,94,0.1)'
                  : actionResult.type === 'pending' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${actionResult.type === 'success'
                  ? 'rgba(34,197,94,0.3)'
                  : actionResult.type === 'pending' ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color: actionResult.type === 'success'
                  ? 'var(--color-success)'
                  : actionResult.type === 'pending' ? 'var(--color-warning)' : 'var(--color-danger)',
              }}
            >
              {actionResult.type === 'success'
                ? <CheckCircle2 size={14} />
                : actionResult.type === 'pending' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
              {actionResult.message}
              <button onClick={() => setActionResult(null)} className="ml-auto"><X size={12} /></button>
            </div>
          )}

          {/* Recent Orders from Shopify */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <button
              onClick={() => setOrdersExpanded(!ordersExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <span className="flex items-center gap-2">
                <Package size={12} />
                Recent Orders ({customerOrders.length})
              </span>
              {ordersExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {ordersExpanded && (
              <div className="px-4 pb-4">
                {customerLoading ? (
                  <div className="flex items-center gap-2 py-3 justify-center">
                    <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading orders...</span>
                  </div>
                ) : customerOrders.length > 0 ? (
                  <div className="space-y-2">
                    {customerOrders.map((order) => {
                      const finColor = FINANCIAL_STATUS_COLORS[order.financialStatus] || 'var(--text-tertiary)';
                      const fulColor = FULFILLMENT_STATUS_COLORS[order.fulfillmentStatus] || 'var(--text-tertiary)';
                      const isExpanded = expandedOrderId === order.id;
                      return (
                        <div
                          key={order.id}
                          className="rounded-lg overflow-hidden"
                          style={{ backgroundColor: 'var(--bg-secondary)', border: isExpanded ? '1px solid var(--border-primary)' : '1px solid transparent' }}
                        >
                          {/* Order summary row — clickable */}
                          <button
                            onClick={() => handleExpandOrder(order.id)}
                            className="w-full text-left p-3 transition-colors"
                            onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <ChevronRight size={10} style={{ color: 'var(--text-tertiary)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                  {order.name}
                                </span>
                                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                  ${parseFloat(order.totalPrice).toFixed(2)}
                                </span>
                              </div>
                              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mb-1.5 ml-[18px]">
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${finColor} 12%, transparent)`, color: finColor }}>
                                {order.financialStatus?.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${fulColor} 12%, transparent)`, color: fulColor }}>
                                {order.fulfillmentStatus?.replace(/_/g, ' ') || 'UNFULFILLED'}
                              </span>
                            </div>
                            <div className="text-[10px] ml-[18px]" style={{ color: 'var(--text-tertiary)' }}>
                              {order.lineItems.slice(0, 3).map((item, i) => (
                                <span key={i}>
                                  {item.title}{item.quantity > 1 ? ` x${item.quantity}` : ''}
                                  {item.variantTitle ? ` (${item.variantTitle})` : ''}
                                  {i < Math.min(order.lineItems.length, 3) - 1 ? ', ' : ''}
                                </span>
                              ))}
                              {order.lineItems.length > 3 && ` +${order.lineItems.length - 3} more`}
                            </div>
                            {order.cancelledAt && (
                              <p className="text-[10px] mt-1 ml-[18px] font-medium" style={{ color: 'var(--color-danger)' }}>
                                Cancelled {new Date(order.cancelledAt).toLocaleDateString()}
                              </p>
                            )}
                          </button>

                          {/* Expanded order detail */}
                          {isExpanded && (
                            <div className="px-3 pb-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
                              {orderDetailLoading ? (
                                <div className="flex items-center gap-2 py-4 justify-center">
                                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
                                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading details...</span>
                                </div>
                              ) : orderDetail ? (
                                <div className="space-y-3 pt-3">
                                  {/* Line items */}
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Items</p>
                                    <div className="space-y-1.5">
                                      {orderDetail.lineItems.map((li) => (
                                        <div key={li.id} className="flex items-center justify-between text-xs">
                                          <div className="flex-1 min-w-0">
                                            <span style={{ color: 'var(--text-primary)' }}>{li.title}</span>
                                            {li.variantTitle && <span style={{ color: 'var(--text-tertiary)' }}> ({li.variantTitle})</span>}
                                            {li.sku && <span className="text-[10px] ml-1" style={{ color: 'var(--text-tertiary)' }}>SKU: {li.sku}</span>}
                                          </div>
                                          <span className="ml-2 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
                                            ${parseFloat(li.unitPrice).toFixed(2)} x{li.quantity}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Price breakdown */}
                                  <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--bg-primary)' }}>
                                    <div className="space-y-1 text-xs">
                                      <div className="flex justify-between"><span style={{ color: 'var(--text-tertiary)' }}>Subtotal</span><span style={{ color: 'var(--text-primary)' }}>${parseFloat(orderDetail.subtotal).toFixed(2)}</span></div>
                                      <div className="flex justify-between"><span style={{ color: 'var(--text-tertiary)' }}>Shipping</span><span style={{ color: 'var(--text-primary)' }}>${parseFloat(orderDetail.shipping).toFixed(2)}</span></div>
                                      <div className="flex justify-between"><span style={{ color: 'var(--text-tertiary)' }}>Tax</span><span style={{ color: 'var(--text-primary)' }}>${parseFloat(orderDetail.tax).toFixed(2)}</span></div>
                                      <div className="flex justify-between font-semibold pt-1" style={{ borderTop: '1px solid var(--border-secondary)' }}>
                                        <span style={{ color: 'var(--text-primary)' }}>Total</span>
                                        <span style={{ color: 'var(--text-primary)' }}>${parseFloat(orderDetail.totalPrice).toFixed(2)}</span>
                                      </div>
                                      {parseFloat(orderDetail.totalRefunded) > 0 && (
                                        <div className="flex justify-between"><span style={{ color: 'var(--color-source-ai)' }}>Refunded</span><span style={{ color: 'var(--color-source-ai)' }}>-${parseFloat(orderDetail.totalRefunded).toFixed(2)}</span></div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Shipping address */}
                                  {orderDetail.shippingAddress && (
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase mb-1 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                                        <MapPin size={10} /> Shipping Address
                                      </p>
                                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                        {orderDetail.shippingAddress.name}<br />
                                        {orderDetail.shippingAddress.address1}
                                        {orderDetail.shippingAddress.address2 && <>, {orderDetail.shippingAddress.address2}</>}<br />
                                        {orderDetail.shippingAddress.city}{orderDetail.shippingAddress.province ? `, ${orderDetail.shippingAddress.province}` : ''} {orderDetail.shippingAddress.zip}<br />
                                        {orderDetail.shippingAddress.country}
                                        {orderDetail.shippingAddress.phone && <><br />{orderDetail.shippingAddress.phone}</>}
                                      </p>
                                    </div>
                                  )}

                                  {/* Fulfillments & tracking */}
                                  {orderDetail.fulfillments.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase mb-1 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                                        <Truck size={10} /> Fulfillments
                                      </p>
                                      <div className="space-y-1.5">
                                        {orderDetail.fulfillments.map((f, fi) => (
                                          <div key={fi} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                            <span className="font-medium" style={{ color: 'var(--color-success)' }}>{f.status}</span>
                                            <span> — {new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                            {f.trackingInfo.map((t, ti) => (
                                              <div key={ti} className="flex items-center gap-1.5 mt-0.5 ml-2">
                                                <Package size={9} style={{ color: 'var(--text-tertiary)' }} />
                                                <a href={buildTrackingUrl(t.url, t.number) ?? '#'} target="_blank" rel="noopener noreferrer" className="text-[10px] underline" style={{ color: 'var(--color-accent)' }}>
                                                  {t.company ? `${t.company}: ` : ''}{t.number}
                                                </a>
                                              </div>
                                            ))}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Transactions */}
                                  {orderDetail.transactions.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase mb-1 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                                        <CreditCard size={10} /> Transactions
                                      </p>
                                      <div className="space-y-1">
                                        {orderDetail.transactions.map((txn) => (
                                          <div key={txn.id} className="flex items-center justify-between text-[11px]">
                                            <div className="flex items-center gap-1.5">
                                              <span className="font-medium" style={{ color: txn.kind === 'REFUND' ? 'var(--color-source-ai)' : txn.kind === 'SALE' ? 'var(--color-success)' : 'var(--text-secondary)' }}>
                                                {txn.kind}
                                              </span>
                                              <span style={{ color: 'var(--text-tertiary)' }}>{txn.status}</span>
                                              <span style={{ color: 'var(--text-tertiary)' }}>via {txn.gateway?.replace(/_/g, ' ')}</span>
                                            </div>
                                            <span style={{ color: txn.kind === 'REFUND' ? 'var(--color-source-ai)' : 'var(--text-primary)' }}>
                                              {txn.kind === 'REFUND' ? '-' : ''}${parseFloat(txn.amount).toFixed(2)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Refund history */}
                                  {orderDetail.refunds.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase mb-1 flex items-center gap-1" style={{ color: 'var(--color-source-ai)' }}>
                                        <Undo2 size={10} /> Refunds
                                      </p>
                                      <div className="space-y-1.5">
                                        {orderDetail.refunds.map((r) => (
                                          <div key={r.id} className="text-xs rounded-lg p-2" style={{ backgroundColor: 'rgba(168,85,247,0.06)' }}>
                                            <div className="flex justify-between mb-0.5">
                                              <span style={{ color: 'var(--color-source-ai)' }}>${parseFloat(r.amount).toFixed(2)}</span>
                                              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{new Date(r.createdAt).toLocaleDateString()}</span>
                                            </div>
                                            {r.note && <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{r.note}</p>}
                                            {r.lineItems.length > 0 && (
                                              <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                                                {r.lineItems.map((li, i) => <span key={i}>{li.title} x{li.quantity}{i < r.lineItems.length - 1 ? ', ' : ''}</span>)}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Order note */}
                                  {orderDetail.note && (
                                    <div className="text-xs rounded-lg px-2.5 py-2" style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}>
                                      <span className="text-[10px] font-medium block mb-0.5" style={{ color: 'var(--color-warning)' }}>Order Note</span>
                                      <span style={{ color: 'var(--text-secondary)' }}>{orderDetail.note}</span>
                                    </div>
                                  )}

                                  {/* Action buttons */}
                                  <div className="flex gap-2 pt-1">
                                    {!orderDetail.cancelledAt && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setCancelRestock(cancellationRestockAllowed);
                                          setShowCancelModal(true);
                                        }}
                                        className="flex-1 text-[11px] font-medium px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                                        style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.2)' }}
                                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.15)'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.08)'; }}
                                      >
                                        <Ban size={11} /> Cancel Order
                                      </button>
                                    )}
                                    {!orderDetail.cancelledAt && ['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'].includes(orderDetail.financialStatus) && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const refundable = parseFloat(orderDetail.totalPrice) - parseFloat(orderDetail.totalRefunded);
                                          setRefundAmount(refundable.toFixed(2));
                                          setShowRefundModal(true);
                                        }}
                                        className="flex-1 text-[11px] font-medium px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                                        style={{ backgroundColor: 'rgba(168,85,247,0.08)', color: 'var(--color-source-ai)', border: '1px solid rgba(168,85,247,0.2)' }}
                                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(168,85,247,0.15)'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(168,85,247,0.08)'; }}
                                      >
                                        <Undo2 size={11} /> Issue Refund
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs py-3 text-center" style={{ color: 'var(--text-tertiary)' }}>Failed to load order details</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs py-2" style={{ color: 'var(--text-tertiary)' }}>
                    {ticket.customer_email ? 'No orders found' : 'No customer email'}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Cancel Order Modal */}
          {showCancelModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
              <div className="rounded-xl p-5 w-[360px] shadow-xl" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Ban size={14} style={{ color: 'var(--color-danger)' }} /> Cancel Order
                  </h3>
                  <button onClick={() => setShowCancelModal(false)} style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Reason</label>
                    <select
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
                      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                    >
                      {CANCEL_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>

                  <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={cancelRefund} onChange={(e) => setCancelRefund(e.target.checked)} className="rounded" />
                    Issue refund to customer
                  </label>

                  <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: cancellationRestockAllowed ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                    <input type="checkbox" checked={cancelRestock} disabled={!cancellationRestockAllowed} onChange={(e) => setCancelRestock(e.target.checked)} className="rounded" />
                    {cancellationRestockAllowed ? 'Restock items' : 'Do not restock (fulfilled/tracking risk)'}
                  </label>
                </div>

                <div className="flex gap-2 mt-5">
                  <button
                    onClick={() => setShowCancelModal(false)}
                    className="flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleCancelOrder}
                    disabled={cancelLoading || cancelPendingOrderId === expandedOrderId}
                    className="flex-1 text-xs font-medium px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-danger)', color: '#fff' }}
                  >
                    {cancelLoading
                      ? <><Loader2 size={12} className="animate-spin" /> Cancelling...</>
                      : cancelPendingOrderId === expandedOrderId
                        ? <><Loader2 size={12} className="animate-spin" /> Processing...</>
                        : 'Confirm Cancel'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Refund Modal */}
          {showRefundModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
              <div className="rounded-xl p-5 w-[360px] shadow-xl" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Undo2 size={14} style={{ color: 'var(--color-source-ai)' }} /> Issue Refund
                  </h3>
                  <button onClick={() => setShowRefundModal(false)} style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Amount ($)
                      {orderDetail && (
                        <span className="ml-1 font-normal" style={{ color: 'var(--text-tertiary)' }}>
                          max: ${(parseFloat(orderDetail.totalPrice) - parseFloat(orderDetail.totalRefunded)).toFixed(2)}
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={orderDetail ? (parseFloat(orderDetail.totalPrice) - parseFloat(orderDetail.totalRefunded)) : undefined}
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
                      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Reason (optional)</label>
                    <input
                      type="text"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none"
                      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
                      placeholder="Customer requested refund"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={refundNotify} onChange={(e) => setRefundNotify(e.target.checked)} className="rounded" />
                    Notify customer via email
                  </label>
                </div>

                <div className="flex gap-2 mt-5">
                  <button
                    onClick={() => setShowRefundModal(false)}
                    className="flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleRefundOrder}
                    disabled={refundLoading || !refundAmount || parseFloat(refundAmount) <= 0}
                    className="flex-1 text-xs font-medium px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-source-ai)', color: '#fff' }}
                  >
                    {refundLoading ? <><Loader2 size={12} className="animate-spin" /> Processing...</> : `Refund $${parseFloat(refundAmount || '0').toFixed(2)}`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Merge Modal */}
          {showMergeModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
              <div className="rounded-xl p-5 w-[400px] shadow-xl" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <GitMerge size={14} style={{ color: 'var(--color-accent)' }} /> Merge into this ticket
                  </h3>
                  <button onClick={() => setShowMergeModal(false)} style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>
                </div>
                <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                  Pick another active ticket from this customer. Its original history stays intact, links to this case, and the source ticket closes.
                </p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto mb-4">
                  {mergeCandidates.map((pt) => (
                    <button
                      key={pt.id}
                      onClick={() => setMergeSourceId(pt.id)}
                      className="w-full text-left text-xs p-2.5 rounded-lg transition-colors"
                      style={{
                        backgroundColor: mergeSourceId === pt.id ? 'var(--color-accent-soft)' : 'var(--bg-secondary)',
                        border: `1px solid ${mergeSourceId === pt.id ? 'var(--color-accent-ring)' : 'transparent'}`,
                        color: 'var(--text-primary)',
                      }}
                    >
                      <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>#{pt.ticket_number}</span>{' '}
                      <span className="font-medium">{pt.subject}</span>
                      <span className="block mt-0.5 capitalize text-[10px]" style={{ color: STATUS_STYLES[pt.status]?.text }}>{pt.status}</span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowMergeModal(false)}
                    className="flex-1 text-xs font-medium px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={mergeTicket}
                    disabled={!mergeSourceId || mergeLoading}
                    className="flex-1 text-xs font-medium px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-foreground, #fff)' }}
                  >
                    {mergeLoading ? <><Loader2 size={12} className="animate-spin" /> Merging…</> : 'Merge'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Keyboard Shortcuts Modal */}
          {showShortcuts && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowShortcuts(false)}>
              <div className="rounded-xl p-5 w-[340px] shadow-xl" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }} onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Keyboard size={14} /> Keyboard shortcuts
                  </h3>
                  <button onClick={() => setShowShortcuts(false)} style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>
                </div>
                <div className="space-y-1.5">
                  {[
                    ['J / →', 'Next ticket in queue'],
                    ['K / ←', 'Previous ticket'],
                    ['R', 'Reply (focus composer)'],
                    ['N', 'Internal note'],
                    ['E', 'Mark resolved'],
                    ['A', 'Assign to me'],
                    ['S', 'Snooze menu'],
                    ['?', 'Toggle this help'],
                  ].map(([key, desc]) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span style={{ color: 'var(--text-secondary)' }}>{desc}</span>
                      <kbd
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                      >
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AI Tools */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              AI Tools
            </h3>
            <div className="space-y-2">
              <button
                onClick={() => handleAiTool('summarize')}
                disabled={!!aiLoading}
                className="w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'rgba(168,85,247,0.06)',
                  color: 'var(--color-source-ai)',
                  border: '1px solid rgba(168,85,247,0.15)',
                }}
              >
                {aiLoading === 'summarize' ? (
                  <><Loader2 size={12} className="animate-spin" /> Summarizing...</>
                ) : (
                  <><ReceiptText size={12} /> Summarize Thread</>
                )}
              </button>
              <button
                onClick={() => handleAiTool('suggest')}
                disabled={!!aiLoading}
                className="w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'rgba(168,85,247,0.06)',
                  color: 'var(--color-source-ai)',
                  border: '1px solid rgba(168,85,247,0.15)',
                }}
              >
                {aiLoading === 'suggest' ? (
                  <><Loader2 size={12} className="animate-spin" /> Thinking...</>
                ) : (
                  <><ListChecks size={12} /> Suggest Next Steps</>
                )}
              </button>
            </div>

            {/* AI Summary Result */}
            {aiSummary && (
              <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.12)' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-source-ai)' }}>Summary</span>
                  <button onClick={() => setAiSummary(null)} style={{ color: 'var(--text-tertiary)' }}><X size={12} /></button>
                </div>
                <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-primary)' }}>{aiSummary}</p>
              </div>
            )}

            {/* AI Next Steps Result */}
            {aiSteps && (
              <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.12)' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-source-ai)' }}>Next Steps</span>
                  <button onClick={() => setAiSteps(null)} style={{ color: 'var(--text-tertiary)' }}><X size={12} /></button>
                </div>
                <ul className="space-y-1.5">
                  {aiSteps.map((step, i) => (
                    <li key={i} className="text-xs flex items-start gap-2 leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                      <span className="text-[10px] font-bold mt-0.5 flex-shrink-0" style={{ color: 'var(--color-source-ai)' }}>{i + 1}.</span>
                      <span>{step.replace(/^\d+\.\s*/, '')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Knowledge Base Search */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-tertiary)' }}>
              <BookOpen size={12} /> Knowledge Base
            </h3>
            <div className="flex gap-1.5 mb-2">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                <input
                  value={kbQuery}
                  onChange={(e) => setKbQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') searchKB(); }}
                  placeholder="Search articles..."
                  className="w-full text-xs rounded-lg pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <button
                onClick={searchKB}
                disabled={kbSearching}
                className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                {kbSearching ? '...' : 'Go'}
              </button>
            </div>
            {kbResults.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {kbResults.map((doc) => (
                  <div
                    key={doc.id}
                    className="rounded-lg transition-colors"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <button
                      onClick={() => setKbExpanded(kbExpanded === doc.id ? null : doc.id)}
                      className="w-full text-left px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                          {doc.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>
                          {doc.category}
                        </span>
                      </div>
                    </button>
                    {kbExpanded === doc.id && (
                      <div className="px-3 pb-2">
                        <p className="text-xs whitespace-pre-wrap mb-2" style={{ color: 'var(--text-secondary)' }}>
                          {doc.content.slice(0, 500)}{doc.content.length > 500 ? '...' : ''}
                        </p>
                        <button
                          onClick={() => {
                            updateReplyFromAgent((prev) => prev ? `${prev}\n\n${doc.content}` : doc.content);
                            setKbExpanded(null);
                          }}
                          className="text-[10px] font-medium px-2 py-1 rounded transition-colors"
                          style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)' }}
                        >
                          Insert into reply
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Quick Actions
            </h3>
            <div className="space-y-1.5">
              <button
                onClick={copyEmail}
                className="w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2 transition-colors"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}
              >
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy Customer Email'}
              </button>
              <button
                onClick={() => updateTicket({ status: 'resolved' })}
                className="w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2 transition-colors"
                style={{
                  backgroundColor: 'rgba(34,197,94,0.06)',
                  color: 'var(--color-success)',
                  border: '1px solid rgba(34,197,94,0.15)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(34,197,94,0.12)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(34,197,94,0.06)'; }}
              >
                <CheckCircle2 size={12} /> Mark as Resolved
              </button>
            </div>
          </div>

          {/* Past Tickets */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Past Tickets
            </h3>
            {pastTickets && pastTickets.length > 0 ? (
              <div className="space-y-2">
                {pastTickets.map((pt) => (
                  <Link
                    key={pt.id}
                    href={`${basePath}/${pt.id}`}
                    className="block text-xs p-2 rounded-lg transition-colors"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>#{pt.ticket_number}</span>{' '}
                    <span className="font-medium">{pt.subject}</span>
                    <span
                      className="block mt-0.5 capitalize"
                      style={{ color: STATUS_STYLES[pt.status]?.text }}
                    >
                      {pt.status}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No past tickets</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
