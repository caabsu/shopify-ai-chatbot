'use client';

import { useState, useEffect, use, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Tag, User, Bot, Cpu, MessageSquare, Plus, X,
  ChevronDown, ChevronUp, Send, StickyNote, Sparkles, ListChecks, FileText,
  ShoppingCart, RefreshCcw, ReceiptText, ExternalLink, Copy, CheckCircle2,
  Mail, FormInput, Clock, AlertCircle, Search, BookOpen, Package,
  DollarSign, Truck, CreditCard, Hash, Calendar, Star,
} from 'lucide-react';
import { formatDate, cn } from '@/lib/utils';
import type { Ticket, TicketMessage, TicketEvent, CannedResponse, Message } from '@/lib/types';

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  urgent: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444' },
  high: { bg: 'rgba(249,115,22,0.12)', text: '#f97316' },
  medium: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6' },
  low: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  open: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6' },
  pending: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' },
  resolved: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' },
  closed: { bg: 'rgba(156,163,175,0.12)', text: '#9ca3af' },
};

const SOURCE_META: Record<string, { icon: typeof Mail; label: string; color: string }> = {
  email: { icon: Mail, label: 'Email', color: '#6366f1' },
  form: { icon: FormInput, label: 'Form', color: '#10b981' },
  ai_escalation: { icon: Sparkles, label: 'AI Escalation', color: '#a855f7' },
};

const TAG_COLORS = [
  { bg: 'rgba(59,130,246,0.1)', text: '#3b82f6' },
  { bg: 'rgba(34,197,94,0.1)', text: '#22c55e' },
  { bg: 'rgba(168,85,247,0.1)', text: '#a855f7' },
  { bg: 'rgba(249,115,22,0.1)', text: '#f97316' },
  { bg: 'rgba(236,72,153,0.1)', text: '#ec4899' },
  { bg: 'rgba(20,184,166,0.1)', text: '#14b8a6' },
];

const FINANCIAL_STATUS_COLORS: Record<string, string> = {
  PAID: '#22c55e',
  PARTIALLY_PAID: '#f59e0b',
  PENDING: '#f59e0b',
  REFUNDED: '#a855f7',
  PARTIALLY_REFUNDED: '#a855f7',
  VOIDED: '#9ca3af',
  AUTHORIZED: '#3b82f6',
};

const FULFILLMENT_STATUS_COLORS: Record<string, string> = {
  FULFILLED: '#22c55e',
  UNFULFILLED: '#f59e0b',
  PARTIALLY_FULFILLED: '#3b82f6',
  IN_PROGRESS: '#3b82f6',
};

function getTagColor(i: number) { return TAG_COLORS[i % TAG_COLORS.length]; }

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
  tracking: Array<{ number: string; url: string | null }>;
  createdAt: string;
}

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

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Customer Shopify data
  const [customerProfile, setCustomerProfile] = useState<ShopifyCustomerProfile | null>(null);
  const [customerOrders, setCustomerOrders] = useState<ShopifyOrder[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);

  // Composer state
  const [replyMode, setReplyMode] = useState<'reply' | 'note'>('reply');
  const [replyContent, setReplyContent] = useState('');
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

  // KB search
  const [kbQuery, setKbQuery] = useState('');
  const [kbResults, setKbResults] = useState<KBDocument[]>([]);
  const [kbSearching, setKbSearching] = useState(false);
  const [kbExpanded, setKbExpanded] = useState<string | null>(null);

  // Orders panel
  const [ordersExpanded, setOrdersExpanded] = useState(true);

  // Copy feedback
  const [copied, setCopied] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/tickets/${id}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [id]);

  // Fetch Shopify customer data after ticket loads
  useEffect(() => {
    if (!data?.ticket?.customer_email) return;
    setCustomerLoading(true);
    fetch(`/api/tickets/${id}/customer`)
      .then((r) => r.json())
      .then((res) => {
        if (res.profile) setCustomerProfile(res.profile);
        if (res.orders) setCustomerOrders(res.orders);
      })
      .catch(() => {})
      .finally(() => setCustomerLoading(false));
  }, [id, data?.ticket?.customer_email]);

  useEffect(() => {
    fetch('/api/settings/canned-responses')
      .then((r) => r.json())
      .then((d) => setCannedResponses(d.responses ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages]);

  async function updateTicket(updates: Partial<Ticket>) {
    const res = await fetch(`/api/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const updated = await res.json();
      setData((prev) => prev ? { ...prev, ticket: updated.ticket } : prev);
    }
    setShowStatusDropdown(false);
    setShowPriorityDropdown(false);
  }

  async function sendMessage(setStatus?: string) {
    if (!replyContent.trim()) return;
    setSending(true);
    const body: Record<string, unknown> = {
      content: replyContent,
      sender_type: replyMode === 'note' ? 'system' : 'agent',
      is_internal_note: replyMode === 'note',
    };
    if (setStatus) body.set_status = setStatus;

    const res = await fetch(`/api/tickets/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const newMsg = await res.json();
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: [...prev.messages, newMsg.message],
          ticket: newMsg.ticket ?? prev.ticket,
        };
      });
      setReplyContent('');
    }
    setSending(false);
  }

  async function handleAiTool(action: 'draft' | 'summarize' | 'suggest') {
    setAiLoading(action);
    try {
      const res = await fetch(`/api/tickets/${id}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await res.json();
      const text = result.content || result.text || '';
      if (action === 'draft') {
        setReplyContent(text);
      } else if (action === 'summarize') {
        setAiSummary(text);
      } else if (action === 'suggest') {
        const steps = text.split('\n').filter((l: string) => l.trim());
        setAiSteps(steps);
      }
    } catch {
      // silently handle
    }
    setAiLoading(null);
  }

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
    setKbSearching(true);
    try {
      const res = await fetch(`/api/knowledge/search?q=${encodeURIComponent(kbQuery)}`);
      const data = await res.json();
      setKbResults(data.documents ?? []);
    } catch { setKbResults([]); }
    setKbSearching(false);
  }, [kbQuery]);

  function interpolateCanned(content: string): string {
    const ticket = data?.ticket;
    if (!ticket) return content;
    const firstName = ticket.customer_name?.split(' ')[0] || '';
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

  function getShopifyAdminUrl(resourceType: string, gid: string): string {
    // Convert GID to numeric ID: gid://shopify/Customer/123 → 123
    const numericId = gid.split('/').pop() || '';
    return `https://put1rp-iq.myshopify.com/admin/${resourceType}/${numericId}`;
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
        <Link href="/tickets" className="text-sm mt-2 inline-block" style={{ color: 'var(--color-accent)' }}>
          Back to inbox
        </Link>
      </div>
    );
  }

  const { ticket, messages, events, aiConversationMessages, pastTickets } = data;
  const sourceMeta = SOURCE_META[ticket.source];

  return (
    <div className="space-y-4">
      {/* Back + Header */}
      <Link
        href="/tickets"
        className="inline-flex items-center gap-1.5 text-sm transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft size={14} /> Back to inbox
      </Link>

      {/* Ticket header */}
      <div
        className="rounded-xl p-4"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono" style={{ color: 'var(--text-tertiary)' }}>
              #{ticket.ticket_number}
            </span>
            {ticket.tags?.includes('trade-member') && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"
                style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.3)' }}
              >
                Trade
              </span>
            )}
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

          <div className="flex items-center gap-2">
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
              color: ticket.sla_breached ? '#ef4444' : (() => {
                const diff = new Date(ticket.sla_deadline).getTime() - Date.now();
                return diff < 3600000 ? '#f97316' : '#22c55e';
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
      </div>

      {/* Main content: thread + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
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
                  <Bot size={14} style={{ color: '#a855f7' }} />
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
                        {m.role === 'user' ? <User size={12} style={{ color: '#3b82f6' }} /> :
                         m.role === 'assistant' ? <Bot size={12} style={{ color: '#a855f7' }} /> :
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
                          {isCustomer ? <User size={12} style={{ color: '#3b82f6' }} /> :
                           isAiDraft ? <Bot size={12} style={{ color: '#a855f7' }} /> :
                           isSystem ? <Cpu size={12} style={{ color: '#9ca3af' }} /> :
                           <User size={12} style={{ color: '#6366f1' }} />}
                        </div>
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                          {msg.sender_name || msg.sender_type}
                        </span>
                        {isNote && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(245,158,11,0.15)', color: '#d97706' }}
                          >
                            Internal Note
                          </span>
                        )}
                        {isAiDraft && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(168,85,247,0.12)', color: '#a855f7' }}
                          >
                            AI Draft
                          </span>
                        )}
                        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-tertiary)' }}>
                          {formatDate(msg.created_at)}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere', wordBreak: 'break-word', maxWidth: '100%', overflowX: 'hidden' }}>
                        {msg.content}
                      </p>
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
                    color: replyMode === 'note' ? '#d97706' : 'var(--text-secondary)',
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
                            setReplyContent(interpolateCanned(cr.content));
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
              <textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                rows={4}
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

            {/* Actions */}
            <div className="flex items-center justify-between px-4 pb-4">
              <div className="flex items-center gap-2">
                {/* AI Draft button inline in composer */}
                <button
                  onClick={() => handleAiTool('draft')}
                  disabled={aiLoading === 'draft'}
                  className="text-xs px-3 py-2 rounded-lg font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  style={{
                    backgroundColor: 'rgba(168,85,247,0.08)',
                    color: '#a855f7',
                    border: '1px solid rgba(168,85,247,0.2)',
                  }}
                >
                  <Sparkles size={11} />
                  {aiLoading === 'draft' ? 'Drafting...' : 'AI Draft'}
                </button>
              </div>
              <div className="flex items-center gap-2">
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
                        color: '#22c55e',
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
                  style={{ backgroundColor: 'var(--color-accent)' }}
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
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Customer
              </h3>
              {customerProfile && (
                <a
                  href={getShopifyAdminUrl('customers', customerProfile.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-medium flex items-center gap-1 transition-colors"
                  style={{ color: 'var(--color-accent)' }}
                >
                  View in Shopify <ExternalLink size={10} />
                </a>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                    color: 'var(--color-accent)',
                  }}
                >
                  {(ticket.customer_name || ticket.customer_email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {customerProfile
                      ? `${customerProfile.firstName || ''} ${customerProfile.lastName || ''}`.trim() || ticket.customer_name || 'Unknown'
                      : ticket.customer_name || 'Unknown'
                    }
                  </p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                      {ticket.customer_email}
                    </p>
                    <button onClick={copyEmail} className="flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                      {copied ? <CheckCircle2 size={11} style={{ color: '#22c55e' }} /> : <Copy size={11} />}
                    </button>
                  </div>
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
                <div className="animate-pulse space-y-2">
                  <div className="h-4 rounded" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
                  <div className="h-4 w-2/3 rounded" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
                </div>
              ) : customerProfile ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <ShoppingCart size={10} style={{ color: 'var(--text-tertiary)' }} />
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Orders</span>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {customerProfile.ordersCount}
                    </p>
                  </div>
                  <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <DollarSign size={10} style={{ color: 'var(--text-tertiary)' }} />
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Lifetime Value</span>
                    </div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      ${parseFloat(customerProfile.totalSpent).toFixed(0)}
                    </p>
                  </div>
                  <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Calendar size={10} style={{ color: 'var(--text-tertiary)' }} />
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Since</span>
                    </div>
                    <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {new Date(customerProfile.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
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
                <div className="space-y-1">
                  {ticket.customer_phone && (
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Phone: {ticket.customer_phone}
                    </p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    No Shopify profile found
                  </p>
                </div>
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
                  <span className="text-[10px] font-medium block mb-0.5" style={{ color: '#d97706' }}>Shopify Note</span>
                  {customerProfile.note}
                </div>
              )}
            </div>
          </div>

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
                  <div className="animate-pulse space-y-2">
                    <div className="h-16 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
                    <div className="h-16 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
                  </div>
                ) : customerOrders.length > 0 ? (
                  <div className="space-y-2">
                    {customerOrders.map((order) => {
                      const finColor = FINANCIAL_STATUS_COLORS[order.financialStatus] || 'var(--text-tertiary)';
                      const fulColor = FULFILLMENT_STATUS_COLORS[order.fulfillmentStatus] || 'var(--text-tertiary)';
                      return (
                        <div
                          key={order.id}
                          className="rounded-lg p-3"
                          style={{ backgroundColor: 'var(--bg-secondary)' }}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {order.name}
                              </span>
                              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                ${parseFloat(order.totalPrice).toFixed(2)}
                              </span>
                            </div>
                            <a
                              href={getShopifyAdminUrl('orders', order.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--text-tertiary)' }}
                            >
                              <ExternalLink size={11} />
                            </a>
                          </div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: `color-mix(in srgb, ${finColor} 12%, transparent)`, color: finColor }}
                            >
                              {order.financialStatus?.replace(/_/g, ' ')}
                            </span>
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: `color-mix(in srgb, ${fulColor} 12%, transparent)`, color: fulColor }}
                            >
                              {order.fulfillmentStatus?.replace(/_/g, ' ') || 'UNFULFILLED'}
                            </span>
                          </div>
                          <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                            {order.lineItems.slice(0, 3).map((item, i) => (
                              <span key={i}>
                                {item.title}{item.quantity > 1 ? ` x${item.quantity}` : ''}
                                {item.variantTitle ? ` (${item.variantTitle})` : ''}
                                {i < Math.min(order.lineItems.length, 3) - 1 ? ', ' : ''}
                              </span>
                            ))}
                            {order.lineItems.length > 3 && ` +${order.lineItems.length - 3} more`}
                          </div>
                          {order.tracking.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <Truck size={10} style={{ color: 'var(--text-tertiary)' }} />
                              {order.tracking.map((t, i) => (
                                t.url ? (
                                  <a key={i} href={t.url} target="_blank" rel="noopener noreferrer" className="text-[10px] underline" style={{ color: 'var(--color-accent)' }}>
                                    {t.number}
                                  </a>
                                ) : (
                                  <span key={i} className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{t.number}</span>
                                )
                              ))}
                            </div>
                          )}
                          <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                            {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
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
                disabled={aiLoading === 'summarize'}
                className="w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'rgba(168,85,247,0.06)',
                  color: '#a855f7',
                  border: '1px solid rgba(168,85,247,0.15)',
                }}
              >
                <ReceiptText size={12} />
                {aiLoading === 'summarize' ? 'Summarizing...' : 'Summarize Thread'}
              </button>
              <button
                onClick={() => handleAiTool('suggest')}
                disabled={aiLoading === 'suggest'}
                className="w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'rgba(168,85,247,0.06)',
                  color: '#a855f7',
                  border: '1px solid rgba(168,85,247,0.15)',
                }}
              >
                <ListChecks size={12} />
                {aiLoading === 'suggest' ? 'Thinking...' : 'Suggest Next Steps'}
              </button>
            </div>

            {/* AI Summary Result */}
            {aiSummary && (
              <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.12)' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold uppercase" style={{ color: '#a855f7' }}>Summary</span>
                  <button onClick={() => setAiSummary(null)} style={{ color: 'var(--text-tertiary)' }}><X size={12} /></button>
                </div>
                <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{aiSummary}</p>
              </div>
            )}

            {/* AI Next Steps Result */}
            {aiSteps && (
              <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.12)' }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold uppercase" style={{ color: '#a855f7' }}>Next Steps</span>
                  <button onClick={() => setAiSteps(null)} style={{ color: 'var(--text-tertiary)' }}><X size={12} /></button>
                </div>
                <ul className="space-y-1">
                  {aiSteps.map((step, i) => (
                    <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-primary)' }}>
                      <span className="text-[10px] font-bold mt-0.5" style={{ color: '#a855f7' }}>{i + 1}.</span>
                      {step.replace(/^\d+\.\s*/, '')}
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
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
              <span className="flex items-center gap-2">
                <BookOpen size={12} /> Knowledge Base
              </span>
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
                    className="rounded-lg transition-colors cursor-pointer"
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
                            setReplyContent((prev) => prev ? `${prev}\n\n${doc.content}` : doc.content);
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
              {customerProfile && (
                <a
                  href={getShopifyAdminUrl('customers', customerProfile.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2 transition-colors block"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}
                >
                  <User size={12} /> View Customer in Shopify <ExternalLink size={10} className="ml-auto" style={{ color: 'var(--text-tertiary)' }} />
                </a>
              )}
              {customerOrders.length > 0 && (
                <a
                  href={getShopifyAdminUrl('orders', customerOrders[0].id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2 transition-colors block"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}
                >
                  <Package size={12} /> View Latest Order in Shopify <ExternalLink size={10} className="ml-auto" style={{ color: 'var(--text-tertiary)' }} />
                </a>
              )}
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
                onClick={() => {
                  setReplyContent('');
                  sendMessage('resolved');
                }}
                className="w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2 transition-colors"
                style={{
                  backgroundColor: 'rgba(34,197,94,0.06)',
                  color: '#22c55e',
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
                    href={`/tickets/${pt.id}`}
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
