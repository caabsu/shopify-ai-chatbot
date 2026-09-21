'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Headphones, Loader2, ShieldCheck, Timer } from 'lucide-react';

export function TicketAutomationControl({ ticketId }: { ticketId: string }) {
  const [state, setState] = useState<{ ready: boolean; held: boolean; job?: { status: string; scheduled_for: string; reason: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setState(null); setError('');
    const load = async () => { try { const r = await fetch(`/api/support/${ticketId}/state`, { signal: controller.signal, cache: 'no-store' }); if (!r.ok) throw new Error('Could not check automation status.'); setState(await r.json()); } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not check automation.'); } };
    void load(); const timer = setInterval(() => void load(), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [ticketId]);
  async function hold() {
    setBusy(true); setError('');
    try { const r = await fetch(`/api/support/${ticketId}/takeover`, { method: 'POST' }); const data = await r.json(); if (!r.ok) throw new Error(data.error); setState(s => s ? { ...s, held: true } : s); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not take over.'); } finally { setBusy(false); }
  }
  return <><div className="os-ticket-control"><div className="flex gap-3 items-center"><span className="os-ticket-control-icon">{state?.job?.status === 'scheduled' && !state.held ? <Timer size={20} /> : <Headphones size={20} />}</span><div><p className="os-eyebrow">Manual workspace</p><strong>{state?.held ? 'You’re in control of this conversation.' : state?.job?.status === 'scheduled' ? `Automation scheduled for ${new Date(state.job.scheduled_for).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Good support starts with the whole story.'}</strong><p>{state?.held ? 'Automatic actions are held. Review the history and send your reply below.' : 'Customer context, order details, and your reply — together.'}</p></div></div><div className="flex gap-2 flex-wrap">{state?.ready && !state.held && <button className="os-button primary" onClick={() => void hold()} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}Take over</button>}<Link href="/support" className="os-button">Unified inbox</Link></div></div>{error && <div className="os-error" role="alert">{error}</div>}</>;
}
