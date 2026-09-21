'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FileText, Headphones, Inbox, Loader2, Mail, Pause, RefreshCw, Search, Send, ShieldCheck, SlidersHorizontal, Sparkles, Timer, XCircle } from 'lucide-react';
import type { SupportFeed, SupportFeedItem } from '@/lib/support-automation-types';
import type { Ticket, TicketEvent, TicketMessage } from '@/lib/types';
import { ticketAutopilot, ticketTriage } from '@/lib/types';
import { QualityEvidence } from './QualityEvidence';
import { effectivePlanConfidence } from '@/lib/autopilot-batch-policy';

type QueueView = 'inbox' | 'scheduled' | 'completed' | 'review';
type FocusTab = 'conversation' | 'decision' | 'timeline';
interface Detail { ticket: Ticket; messages: TicketMessage[]; events: TicketEvent[] }
const QUEUES = [{ id: 'inbox', label: 'Inbox', icon: Inbox }, { id: 'scheduled', label: 'Scheduled', icon: Clock3 }, { id: 'completed', label: 'Auto-completed', icon: CheckCheck }, { id: 'review', label: 'Needs review', icon: Headphones }] as const;
function relative(value?: string | null) {
  if (!value) return '—';
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 0) return `in ${Math.abs(minutes)}m`;
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}
function dateLabel(value?: string | null) { return value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet'; }
function initials(value: string) { return value.split(/[\s@._-]+/).slice(0, 2).map(v => v[0] || '').join('').toUpperCase(); }
function score(item: SupportFeedItem) { const p = item.job?.plan_snapshot || ticketAutopilot(item.ticket); return p ? effectivePlanConfidence(p) : null; }
function stateLabel(item: SupportFeedItem) {
  if (item.job?.status === 'scheduled') return { label: `Scheduled ${relative(item.job.scheduled_for)}`, tone: 'green' };
  if (item.job?.status === 'running') return { label: 'Executing', tone: 'green' };
  if (item.job?.status === 'completed') return { label: 'Auto-completed', tone: 'green' };
  if (item.job?.status === 'needs_review') return { label: 'Needs review', tone: 'amber' };
  if (item.job?.status === 'cancelled') return { label: 'Manual care', tone: '' };
  if (ticketAutopilot(item.ticket)?.analysis.review_only) return { label: 'Needs review', tone: 'amber' };
  return { label: ticketAutopilot(item.ticket) ? 'Draft ready' : 'New message', tone: '' };
}
async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  if (response.redirected && response.url.includes('/login')) throw new Error('Your session expired. Sign in again to continue.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data as T;
}

export function SupportWorkspace({ overview = false }: { overview?: boolean }) {
  const [view, setView] = useState<QueueView>('inbox');
  const [feed, setFeed] = useState<SupportFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [focusTab, setFocusTab] = useState<FocusTab>('conversation');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingDetail, setPendingDetail] = useState<Detail | null>(null);
  const sendOperation = useRef<{ signature: string; key: string } | null>(null);
  const feedRequest = useRef(0);
  const composerState = useRef({ composing, busy });
  const refreshDetail = useRef<(() => Promise<void>) | null>(null);
  const displayedContext = useRef<number | undefined>(undefined);
  useEffect(() => { composerState.current = { composing, busy }; }, [composing, busy]);
  useEffect(() => { displayedContext.current = detail?.ticket.context_version; }, [detail]);

  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { const desired = new URLSearchParams(window.location.search).get('view'); if (QUEUES.some(q => q.id === desired)) setView(desired as QueueView); }, []);
  const load = useCallback(async (quiet = false) => {
    const request = ++feedRequest.current;
    if (!quiet) setLoading(true);
    try {
      const data = await readJson<SupportFeed>(`/api/support?view=${view}&page=${page}&search=${encodeURIComponent(query)}`);
      if (request !== feedRequest.current) return;
      setFeed(data); setError('');
    } catch (e) { if (request === feedRequest.current) setError(e instanceof Error ? e.message : 'Could not load support.'); }
    finally { if (request === feedRequest.current) setLoading(false); }
  }, [view, page, query]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(true), 30000); return () => { clearInterval(timer); feedRequest.current++; }; }, [load]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    const controller = new AbortController();
    setDetail(null); setPendingDetail(null); setDetailLoading(true); setActionError(''); setNotice(''); setComposing(false); setReply(''); sendOperation.current = null;
    displayedContext.current = undefined;
    let loadingDetail = false;
    const refresh = async () => {
      if (loadingDetail || composerState.current.busy) return;
      loadingDetail = true;
      try {
        const data = await readJson<Detail>(`/api/tickets/${selectedId}`, { signal: controller.signal });
        if (controller.signal.aborted || composerState.current.busy) return;
        const version = displayedContext.current;
        if (version !== undefined && (data.ticket.context_version ?? 0) < version) return;
        if (composerState.current.composing && version !== undefined && data.ticket.context_version !== version) setPendingDetail(data);
        else setDetail(data);
      } catch (e) {
        if (!controller.signal.aborted) setActionError(e instanceof Error ? e.message : 'Could not load conversation.');
      } finally { loadingDetail = false; if (!controller.signal.aborted) setDetailLoading(false); }
    };
    refreshDetail.current = refresh;
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => { controller.abort(); clearInterval(timer); refreshDetail.current = null; };
  }, [selectedId]);
  const selected = feed?.items.find(item => item.ticket.id === selectedId && (!selectedJobId || item.job?.id === selectedJobId)) || null;
  const active = detail?.ticket || selected?.ticket;
  const plan = selected?.job?.plan_snapshot || (active ? ticketAutopilot(active) : null);
  const confidence = plan ? effectivePlanConfidence(plan) : null;
  const workerLive = Boolean(feed?.settings?.last_worker_at && Date.now() - new Date(feed.settings.last_worker_at).getTime() < 180000);
  const autoLive = feed?.settings?.enabled && feed.worker_configured && workerLive;
  const metric = (label: string, value: number | undefined, note: string, Icon: typeof Inbox, featured = false) => <div className={`os-metric ${featured ? 'featured' : ''}`}><span>{label}</span><Icon size={17} /><strong>{value === undefined ? '—' : value.toLocaleString()}</strong><small>{note}</small></div>;

  async function takeOver() {
    if (!active || busy) return;
    setBusy(true); setActionError('');
    try {
      if (feed?.automation_ready) await readJson(`/api/support/${active.id}/takeover`, { method: 'POST' });
      setComposing(true); setReply(''); setNotice(feed?.automation_ready ? 'You have taken over this ticket. Automation is held.' : 'Manual reply mode. Automatic execution is not configured here.'); await load(true);
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not take over.'); } finally { setBusy(false); }
  }
  async function sendReply() {
    if (!active || !reply.trim() || busy || pendingDetail) return;
    setBusy(true); setActionError('');
    const signature = JSON.stringify({ id: active.id, reply, internalNote });
    if (sendOperation.current?.signature !== signature) sendOperation.current = { signature, key: crypto.randomUUID() };
    try {
      const sent = await readJson<{ delivery_pending?: boolean; email_error?: string; status_warning?: string }>(`/api/tickets/${active.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: reply, is_internal_note: internalNote, context_version: active.context_version, idempotency_key: sendOperation.current.key }) });
      if (sent.delivery_pending) { setNotice('Delivery is being confirmed. Wait, then retry with the same message; the existing operation will be resumed.'); return; }
      if (sent.email_error || sent.status_warning) { setActionError(sent.email_error ? `The message was saved, but delivery failed: ${sent.email_error}` : `${sent.status_warning} Retry to reconcile the same send.`); return; }
      setReply(''); setPendingDetail(null); sendOperation.current = null; setNotice(internalNote ? 'Internal note saved.' : 'Reply sent.');
      setDetail(await readJson<Detail>(`/api/tickets/${active.id}`)); await load(true);
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not send reply.'); } finally { setBusy(false); }
  }

  return <>
    <div className="os-heading"><div><p className="os-eyebrow">{overview ? 'The care behind every order' : 'One workspace. Every conversation.'}</p><h1>{overview ? 'Your support, in focus.' : 'Support inbox'}</h1><p>{overview ? 'A clear view of what needs you — and what’s already being handled.' : 'Incoming mail, thoughtful replies, and a complete record of every action.'}</p></div><div className="flex items-center gap-2"><button className="os-button" onClick={() => { void load(); void refreshDetail.current?.(); }} disabled={loading || busy}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Refresh</button><Link href="/support/settings" className="os-button"><SlidersHorizontal size={13} />Automation rules</Link></div></div>
    <div className="os-metrics">{metric('Open conversations', feed?.counts.inbox, 'Across your support inbox', Inbox)}{metric('Scheduled to run', feed?.counts.scheduled, 'A considered 15–30 minute delay', Timer)}{metric('Automatically handled', feed?.counts.completed, 'Completed with an execution record', CheckCheck, true)}{metric('Needs your attention', feed?.counts.review, 'A human touch, where it matters', Headphones)}</div>
    {error && <div className="os-error" role="alert">{error} <button className="underline ml-2" onClick={() => void load()}>Try again</button></div>}
    {overview ? <div className="os-overview-grid"><section className="os-panel"><div className="os-panel-heading"><h2>Latest conversations</h2><Link href="/support">Open inbox <ArrowUpRight className="inline" size={12} /></Link></div>{loading && !feed ? <div className="os-empty"><Loader2 className="animate-spin" size={23} /><p>Loading your workspace…</p></div> : !feed?.items.length ? <div className="os-empty"><Inbox size={30} /><h3>A little breathing room.</h3><p>Incoming customer conversations will appear here.</p></div> : feed.items.slice(0, 7).map(item => <Link className="os-activity-row" key={item.ticket.id} href={`/tickets/${item.ticket.id}`}><span className="os-user-avatar">{initials(item.ticket.customer_name || item.ticket.customer_email)}</span><div className="min-w-0"><h3 className="truncate">{item.ticket.subject}</h3><p>{item.ticket.customer_name || item.ticket.customer_email} · #{item.ticket.ticket_number}</p></div><time>{relative(item.ticket.updated_at)}</time></Link>)}</section><aside><div className="os-panel"><div className="os-panel-heading"><h2>Automation at a glance</h2><span className={`os-pill ${autoLive ? 'green' : 'amber'}`}>{autoLive ? 'Running' : feed?.settings?.enabled === false ? 'Paused' : 'Setup pending'}</span></div><div style={{ padding: '8px 21px 20px' }}><div className="os-evidence-row"><ShieldCheck size={16} /><div><strong>Evidence before action</strong><p>Order details, customer history, policy checks, then a confidence decision.</p></div></div><div className="os-evidence-row"><Clock3 size={16} /><div><strong>15–30 minutes, naturally</strong><p>Each eligible reply gets its own delay. Changes to the conversation stop an outdated plan.</p></div></div><div className="os-evidence-row"><CheckCircle2 size={16} /><div><strong>Confirm, then carry out</strong><p>Cancellation follows a clear customer choice. Every Shopify outcome is checked.</p></div></div></div></div><div className="os-hero"><Sparkles size={20} color="#d5e8a5" /><h2>More care.<br />Less queue.</h2><p>Keep the routine moving. Give the conversations that need you the attention they deserve.</p><Link href="/support">Step into your workspace <ArrowRight size={14} /></Link></div></aside></div> : <>
      <div className="os-toolbar"><div className="os-tabs" role="tablist" aria-label="Support queues">{QUEUES.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={view === id} onClick={() => { setView(id); setPage(1); setSelectedId(null); }}><Icon size={13} />{label}<span>{feed?.counts[id] ?? '—'}</span></button>)}</div><label className="os-search"><Search size={14} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, subject…" aria-label="Search support tickets" /></label></div>
      {feed && !autoLive && <div className="os-notice"><Pause size={14} /><span>{feed.automation_ready ? feed.settings?.enabled === false ? 'Automation is paused. You can review drafts and reply manually.' : 'Automation is configured, but the worker is not connected yet. Scheduled actions will wait.' : 'Your inbox is connected. Automation setup is incomplete; manual replies and plan review are available.'}</span><Link href="/support/settings" className="ml-auto underline whitespace-nowrap">View setup</Link></div>}
      <div className={`os-workbench ${selectedId ? 'has-selection' : ''}`}>
        <section className="os-ticket-rail" aria-label="Ticket list"><div className="os-rail-header"><span>{feed?.total || 0} conversations</span><span>Most recent first</span></div><div className="os-ticket-list" role="listbox" aria-label="Conversations">{loading && !feed ? <div className="os-empty"><Loader2 size={22} className="animate-spin" /><p>Loading conversations…</p></div> : !feed?.items.length ? <div className="os-empty"><Inbox size={29} /><h3>{query ? 'No matching conversations' : 'All clear here'}</h3><p>{query ? 'Try a different name, email, or subject.' : view === 'completed' ? 'Automatically completed tickets will appear here with their full action history.' : view === 'scheduled' ? 'Eligible plans will appear here with their scheduled send time.' : 'New conversations will appear here as they arrive.'}</p></div> : feed.items.map(item => { const state = stateLabel(item); const conf = score(item); return <button key={item.job?.id || item.ticket.id} className="os-ticket-row" role="option" disabled={busy} aria-selected={selectedId === item.ticket.id && (!selectedJobId || selectedJobId === item.job?.id)} onClick={() => { setSelectedId(item.ticket.id); setSelectedJobId(item.job?.id || null); setFocusTab('conversation'); }}><div className="os-ticket-row-top"><span className="os-user-avatar">{initials(item.ticket.customer_name || item.ticket.customer_email)}</span><strong>{item.ticket.customer_name || item.ticket.customer_email}</strong><time>{relative(item.ticket.updated_at)}</time></div><h3>{item.ticket.subject}</h3><p>{ticketTriage(item.ticket)?.summary || ticketAutopilot(item.ticket)?.analysis.summary || 'Open to read the conversation and review the next step.'}</p><div className="os-ticket-row-footer"><span className={`os-pill ${state.tone}`}>{state.label}</span><span>{conf === null ? `#${item.ticket.ticket_number}` : `${Math.round(conf * 100)}% confidence`}</span></div></button>; })}</div><div className="os-pagination"><span>Page {page} of {Math.max(1, Math.ceil((feed?.total || 0) / 30))}</span><div className="flex gap-1"><button className="os-icon-button" disabled={page === 1} aria-label="Previous page" onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></button><button className="os-icon-button" disabled={page * 30 >= (feed?.total || 0)} aria-label="Next page" onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></button></div></div></section>
        <section className="os-ticket-focus" aria-label="Selected conversation">
          {!selectedId ? <div className="os-empty" style={{ flex: 1 }}><Mail size={35} /><h3>A conversation deserves your attention.</h3><p>Select a ticket to read the thread, inspect the proposed reply, and see what happens next.</p><span className="os-pill green"><ShieldCheck size={11} />Every action, accounted for</span></div> : <>
            <div className="os-focus-header"><div className="flex justify-between items-center gap-2"><button onClick={() => setSelectedId(null)} className="os-button"><ArrowLeft size={12} />Back to inbox</button>{active && <Link href={`/tickets/${active.id}`} className="os-button">Full ticket <ArrowUpRight size={12} /></Link>}</div><h2>{active?.subject || 'Loading conversation…'}</h2><div className="os-focus-meta"><span>#{active?.ticket_number || '—'}</span><span>{active?.customer_email}</span>{selected && <span className={`os-pill ${stateLabel(selected).tone}`}>{stateLabel(selected).label}</span>}</div></div>
            <div className="os-focus-tabs" role="tablist" aria-label="Conversation details">{(['conversation', 'decision', 'timeline'] as FocusTab[]).map(tab => <button key={tab} role="tab" aria-selected={focusTab === tab} onClick={() => setFocusTab(tab)}>{tab === 'conversation' ? 'Conversation' : tab === 'decision' ? 'Decision & evidence' : 'Action timeline'}</button>)}</div>
            {actionError && <div className="os-error mx-4" role="alert">{actionError}</div>}{notice && <div className="os-notice mx-4" role="status">{notice}</div>}{pendingDetail && <div className="os-notice mx-4" role="alert"><span>New activity arrived while you were drafting. Review it before sending.</span><button className="os-button" onClick={() => { setDetail(pendingDetail); setPendingDetail(null); setFocusTab('conversation'); }}>Review latest</button></div>}
            <div className="os-focus-body">
              {detailLoading ? <div className="os-empty"><Loader2 className="animate-spin" size={24} /></div> : focusTab === 'conversation' ? <>{detail?.messages?.filter(m => m.sender_type !== 'ai_draft').map(message => <article key={message.id} className={`os-message ${message.is_internal_note ? 'os-note' : ''}`}><div className="os-message-head"><span className="os-user-avatar">{message.sender_type === 'customer' ? initials(message.sender_name || active?.customer_name || 'Customer') : <Headphones size={14} />}</span><div><strong>{message.sender_name || (message.sender_type === 'customer' ? 'Customer' : 'Support')}</strong><small>{message.is_internal_note ? 'Internal note · only your team' : message.sender_type === 'customer' ? 'Customer' : `${message.ai_generated ? 'AI-assisted reply' : 'Support reply'}${message.metadata?.email_status ? ` · ${String(message.metadata.email_status)}` : ''}`}</small></div><time title={dateLabel(message.created_at)}>{relative(message.created_at)}</time></div><div className="os-message-content">{message.content}</div></article>)}{plan?.actions.filter(a => a.type === 'send_reply' && a.status !== 'executed').map(action => <div className="os-draft" key={action.id}><div className="os-draft-title"><Sparkles size={14} />Proposed reply <span className="ml-auto os-pill green">{Math.round(action.confidence * 100)}% confidence</span></div><div className="os-message-content">{String(action.params.reply_text || '')}</div><p className="mt-3 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{selected?.job?.status === 'scheduled' ? `Scheduled for ${dateLabel(selected.job.scheduled_for)}. Evidence is checked again before execution.` : 'This is a draft. It has not been sent.'}</p></div>)}</> : focusTab === 'decision' ? plan ? <><div className="os-confidence"><span className="os-confidence-value">{confidence === null ? '—' : `${Math.round(confidence * 100)}%`}</span><div><strong>Plan confidence</strong><p>The lowest score across the plan and its actions, after policy checks. {plan.analysis.confidence_basis?.sample_count ? `Informed by ${plan.analysis.confidence_basis.sample_count} reviewed samples.` : 'This model cohort has no reviewed calibration yet.'}</p></div></div><h3 className="os-section-heading">Decision summary</h3><p className="os-message-content">{plan.analysis.summary}</p><p className="os-message-content mt-3">{plan.analysis.reasoning}</p>{plan.analysis.review_reason && <div className="os-notice"><XCircle size={15} />{plan.analysis.review_reason}</div>}{selected?.job?.reason && <div className="os-notice">{selected.job.reason}</div>}<h3 className="os-section-heading">Evidence behind the reply</h3>{[{ label: 'Shopify order snapshot', evidence: plan.evidence?.shopify_orders, description: `${plan.evidence?.shopify_orders?.order_count || 0} orders checked` }, { label: 'Customer conversation history', evidence: plan.evidence?.customer_history, description: `${plan.evidence?.customer_history?.ticket_count || 0} related tickets checked` }].map(row => <div className="os-evidence-row" key={row.label}>{row.evidence ? <ShieldCheck size={16} /> : <XCircle size={16} />}<div><strong>{row.label}</strong><p>{row.evidence ? `${row.description} · collected ${dateLabel(row.evidence.fetched_at)} · ${new Date(row.evidence.valid_until).getTime() > Date.now() ? 'Within validity window' : 'Revalidation required'}` : 'No verified snapshot available.'}</p></div></div>)}<div className="os-evidence-row"><FileText size={16} /><div><strong>Knowledge & policy</strong><p>{plan.learning?.memory_count || 0} scoped learned rules applied. Plan policy: {plan.prompt_version || 'Not recorded'}.</p></div></div><QualityEvidence plan={plan} /><h3 className="os-section-heading">Generation record</h3><p className="os-message-content">{plan.generation?.model || 'No model recorded'}<br />{plan.generation?.provider || '—'} · {plan.generation?.thinking === 'high' ? 'Reasoning enabled' : 'Standard inference'}<br />{plan.generation?.usage ? `${(plan.generation.usage.input_tokens || 0).toLocaleString()} input / ${(plan.generation.usage.output_tokens || 0).toLocaleString()} output tokens` : 'Token usage not recorded'}{plan.generation?.total_cost_usd !== undefined ? ` · $${plan.generation.total_cost_usd.toFixed(5)}` : ''}</p></> : <div className="os-empty"><Sparkles size={25} /><h3>No decision yet</h3><p>The plan and its evidence will appear after the planner processes this ticket.</p></div> : <>{selected?.job && <div className="os-timeline-item"><strong>Scheduled for automatic care</strong><p>{dateLabel(selected.job.scheduled_for)} · {Math.round(selected.job.confidence * 100)}% confidence</p><small>Queued {dateLabel(selected.job.created_at)}{selected.job.completed_at ? ` · ${selected.job.status === 'completed' ? 'Completed' : 'Stopped'} ${dateLabel(selected.job.completed_at)}` : ''}</small></div>}{plan?.actions.map(action => <div className="os-timeline-item" key={action.id}><strong>{action.title} <span className={`os-pill ${action.status === 'executed' ? 'green' : action.status === 'failed' ? 'red' : ''}`}>{action.status}</span></strong><p>{action.result || action.detail}</p>{action.type === 'send_reply' && action.status === 'executed' && <details className="os-receipt"><summary>View sent reply</summary><div className="os-message-content">{String(action.params.reply_text || '')}</div></details>}{plan.execution_receipts?.filter(r => r.action_id === action.id).map(receipt => <small className="block" key={receipt.id}>{dateLabel(receipt.started_at)} · {receipt.status}{receipt.provider_reference ? ` · Reference: ${receipt.provider_reference}` : ''}{receipt.error ? ` · ${receipt.error}` : ''}</small>)}</div>)}{detail?.events?.map(event => <div className="os-timeline-item" key={event.id}><strong>{event.event_type.replace(/_/g, ' ')}</strong><p>{event.new_value || event.old_value || `Recorded by ${event.actor}`}</p><small>{dateLabel(event.created_at)}</small></div>)}{!plan && !detail?.events?.length && <div className="os-empty"><Clock3 size={25} /><p>Action history will appear here.</p></div>}</>}
            </div>
            {active && <div className="os-compose">{composing ? <><div className="os-compose-bar"><strong className="text-xs">{internalNote ? 'Internal note' : `Reply to ${active.customer_name || active.customer_email}`}</strong><label><input type="checkbox" checked={internalNote} onChange={e => setInternalNote(e.target.checked)} />Internal note</label></div><textarea aria-label={internalNote ? 'Internal note' : 'Reply message'} placeholder="Write a considered reply…" value={reply} onChange={e => setReply(e.target.value)} /><div className="os-compose-bar"><span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Automation held while you handle this ticket.</span><button className="os-button primary" onClick={() => void sendReply()} disabled={busy || !!pendingDetail || !reply.trim()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}{internalNote ? 'Save note' : 'Send reply'}</button></div></> : <div className="os-compose-bar"><Link className="os-button" href={`/autopilot?ticket=${active.id}`}><Sparkles size={13} />Review & revise plan</Link><button className="os-button primary" onClick={() => void takeOver()} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Headphones size={13} />}Take over & reply</button></div>}</div>}
          </>}
        </section>
      </div>
    </>}
  </>;
}
