let running = false;
/** Railway drives the durable admin executor. Nothing depends on a browser
 * being open, and no customer payload or identity is forwarded in this call. */
export async function tickSupportAutomation(): Promise<void> {
  const base = process.env.SUPPORT_AUTOMATION_ADMIN_URL?.trim();
  const secret = process.env.SUPPORT_AUTOMATION_SECRET?.trim();
  if (!base || !secret || secret.length < 32 || running) return;
  running = true;
  try {
    const url = new URL('/api/internal/support-automation', base);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Automation executor requires HTTPS.');
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(290000), redirect: 'error' });
    if (!response.ok) throw new Error(`Executor returned HTTP ${response.status}`);
  } catch (error) { console.error('[support-automation-worker]', error instanceof Error ? error.message : 'Worker tick failed'); }
  finally { running = false; }
}
