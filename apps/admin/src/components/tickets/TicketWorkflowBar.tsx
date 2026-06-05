'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

interface QueueTicket {
  id: string;
  ticket_number: number;
}

/**
 * Sticky triage bar for the ticket detail view. Gives the page a clear
 * work-queue workflow: where you are in the queue, how many are left, and fast
 * movement to the next ticket — by button or by keyboard (J/K or ←/→).
 * Resolving a ticket does NOT auto-navigate; the agent stays put and moves on
 * deliberately via Next.
 *
 * The queue mirrors whatever filter the inbox was showing (persisted to
 * sessionStorage by TicketInbox); falls back to "open, by SLA urgency".
 */
export function TicketWorkflowBar({ ticketId, basePath }: { ticketId: string; basePath: string }) {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueTicket[]>([]);
  const [openRemaining, setOpenRemaining] = useState<number | null>(null);

  useEffect(() => {
    let params = '';
    try { params = sessionStorage.getItem('ticketQueueParams') || ''; } catch { /* ignore */ }
    const qs = params || 'status=open&order_by=sla_urgency';
    fetch(`/api/tickets?${qs}&per_page=500`)
      .then((r) => r.json())
      .then((d) => setQueue((d.tickets ?? []).map((t: QueueTicket) => ({ id: t.id, ticket_number: t.ticket_number }))))
      .catch(() => { /* non-fatal — bar just hides the counter */ });
    fetch('/api/tickets/stats')
      .then((r) => r.json())
      .then((d) => setOpenRemaining(typeof d.openCount === 'number' ? d.openCount : null))
      .catch(() => { /* ignore */ });
  }, []);

  const index = useMemo(() => queue.findIndex((t) => t.id === ticketId), [queue, ticketId]);
  const total = queue.length;
  const prev = index > 0 ? queue[index - 1] : null;
  const next = index >= 0 && index < total - 1 ? queue[index + 1] : null;

  const goNext = useCallback(() => {
    if (next) router.push(`${basePath}/${next.id}`);
    else router.push(basePath); // end of queue → back to inbox
  }, [next, router, basePath]);

  const goPrev = useCallback(() => {
    if (prev) router.push(`${basePath}/${prev.id}`);
  }, [prev, router, basePath]);

  // Keyboard: J/→ next, K/← prev. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  const position = index >= 0 ? index + 1 : null;
  const progress = total > 0 && position ? (position / total) * 100 : 0;

  const navBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4, height: 32, padding: '0 10px',
    borderRadius: 'var(--radius-md)', fontSize: 12.5, fontWeight: 600,
    border: '1px solid var(--border-primary)', background: 'var(--bg-primary)', color: 'var(--text-secondary)',
  };

  return (
    <div
      className="sticky z-20 flex items-center gap-3 flex-wrap"
      style={{
        top: 56,
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '8px 12px',
      }}
    >
      {/* Back to inbox */}
      <Link
        href={basePath}
        className="inline-flex items-center gap-1.5"
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}
      >
        <ArrowLeft size={15} /> Inbox
      </Link>

      {/* Position + progress */}
      {position && total > 0 && (
        <div className="flex items-center gap-2.5">
          <span style={{ width: 1, height: 18, background: 'var(--border-primary)' }} />
          <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{position}</span> of {total} in queue
          </span>
          <span className="hidden sm:block" style={{ width: 80, height: 5, borderRadius: 999, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${progress}%`, background: 'var(--color-accent)', transition: 'width var(--duration-base) var(--ease-out)' }} />
          </span>
        </div>
      )}

      <div className="flex-1" />

      {/* Open remaining */}
      {openRemaining != null && (
        <span
          className="inline-flex items-center gap-1.5"
          style={{
            fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--radius-sm)',
            color: 'var(--color-accent-strong)', background: 'var(--color-accent-soft)',
          }}
          title="Open tickets remaining"
        >
          <Inbox size={12} /> {openRemaining} open
        </span>
      )}

      {/* Prev / Next */}
      <div className="flex items-center gap-1.5">
        <button onClick={goPrev} disabled={!prev} style={{ ...navBtn, opacity: prev ? 1 : 0.4, cursor: prev ? 'pointer' : 'not-allowed' }} title="Previous ticket (K / ←)">
          <ChevronLeft size={15} />
        </button>
        <button
          onClick={goNext}
          style={{
            ...navBtn,
            background: next ? 'var(--btn-primary-bg)' : 'var(--bg-primary)',
            color: next ? 'var(--btn-primary-fg)' : 'var(--text-secondary)',
            borderColor: next ? 'var(--btn-primary-bg)' : 'var(--border-primary)',
            paddingRight: 12,
          }}
          title="Next ticket (J / →)"
        >
          {next ? 'Next' : 'Done'} <ChevronRight size={15} />
        </button>
      </div>

      {/* Keyboard hint */}
      <span className="hidden md:inline" style={{ fontSize: 11, color: 'var(--text-quaternary)' }}>
        <kbd style={{ fontFamily: 'inherit', fontWeight: 700 }}>J</kbd>/<kbd style={{ fontFamily: 'inherit', fontWeight: 700 }}>K</kbd> to move
      </span>
    </div>
  );
}
