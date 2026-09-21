'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Gauge,
  Layers3,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import {
  DEFAULT_AUTOPILOT_BATCH_SETTINGS,
  MIN_AUTOPILOT_BATCH_MODEL_REVIEWS,
  batchResultStopsScheduling,
  type AutopilotBatchCandidate,
  type AutopilotBatchExclusionReason,
  type AutopilotBatchPreview,
  type AutopilotBatchSettings,
} from '@/lib/autopilot-batch-policy';
import {
  autopilotConflictNeedsRegeneration,
  batchDecisionCompletion,
  requestAutopilotPlanRefresh,
  submitAutopilotBatchCandidate,
} from '@/lib/autopilot-client';

type BatchItemStatus = 'pending' | 'running' | 'succeeded' | 'stale' | 'failed' | 'in_progress' | 'not_run';

export interface AutopilotBatchItemResult {
  candidate: AutopilotBatchCandidate;
  status: BatchItemStatus;
  message: string;
}

export interface AutopilotBatchSummary {
  results: AutopilotBatchItemResult[];
  succeeded: number;
  stale: number;
  failed: number;
  inProgress: number;
  notRun: number;
}

interface BatchRunPanelProps {
  open: boolean;
  excludeTicketIds: string[];
  onClose: () => void;
  onRunningChange: (running: boolean) => void;
  onComplete: (summary: AutopilotBatchSummary) => void | Promise<void>;
}

type PreviewResponse = AutopilotBatchPreview & {
  scannedQueue: number;
  truncated: boolean;
};

type PreviewState = PreviewResponse & {
  clientScopeKey: string;
};

const EXCLUSION_LABELS: Record<AutopilotBatchExclusionReason, string> = {
  not_actionable: 'not actionable',
  already_executing: 'already running',
  review_only: 'manual revision required',
  legacy_or_malformed: 'legacy / malformed',
  stale_context: 'stale context',
  missing_evidence: 'missing evidence',
  expired_evidence: 'expired evidence',
  model_cold_start: `strict cohort below ${MIN_AUTOPILOT_BATCH_MODEL_REVIEWS} reviews`,
  uncalibrated: 'not calibrated',
  below_range: 'below range',
  above_range: 'above range',
  high_impact_excluded: 'order changes excluded',
  local_changes: 'unsaved edits',
  customer_collision: 'same customer / order',
  batch_limit: 'over batch limit',
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function batchSettingsKey(settings: AutopilotBatchSettings): string {
  return JSON.stringify([
    settings.minConfidencePercent,
    settings.maxConfidencePercent,
    settings.maxPlans,
    settings.concurrency,
    settings.requireCalibrated,
    settings.includeHighImpact,
    settings.order,
    settings.failureMode,
  ]);
}

function statusTone(status: BatchItemStatus): string {
  if (status === 'succeeded') return 'var(--color-success)';
  if (status === 'stale' || status === 'in_progress' || status === 'not_run') return 'var(--color-warning)';
  if (status === 'failed') return 'var(--color-danger)';
  return 'var(--color-source-ai)';
}

function statusIcon(status: BatchItemStatus) {
  if (status === 'succeeded') return <CheckCircle2 size={14} />;
  if (status === 'stale' || status === 'not_run') return <Clock3 size={14} />;
  if (status === 'failed') return <XCircle size={14} />;
  if (status === 'in_progress') return <RefreshCw size={14} />;
  return <Loader2 size={14} className={status === 'running' ? 'animate-spin' : ''} />;
}

export function BatchRunPanel({
  open,
  excludeTicketIds,
  onClose,
  onRunningChange,
  onComplete,
}: BatchRunPanelProps) {
  const [settings, setSettings] = useState<AutopilotBatchSettings>(DEFAULT_AUTOPILOT_BATCH_SETTINGS);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<AutopilotBatchItemResult[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previewRequestRef = useRef(0);
  const excludedKey = [...excludeTicketIds].sort().join(',');
  const previewScopeKey = `${batchSettingsKey(settings)}::${excludedKey}`;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => previousFocusRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !running) {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
      ) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open, running]);

  useEffect(() => {
    if (!open || running || results.length > 0) return;
    const controller = new AbortController();
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    const requestedSettingsKey = batchSettingsKey(settings);
    const requestedScopeKey = previewScopeKey;
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const response = await fetch('/api/autopilot/batch/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            settings,
            exclude_ticket_ids: excludeTicketIds,
          }),
        });
        const payload = await response.json() as PreviewResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Batch preview failed.');
        if (controller.signal.aborted || previewRequestRef.current !== requestId) return;
        if (batchSettingsKey(payload.settings) !== requestedSettingsKey) {
          throw new Error('The preview settings did not match this request. Refresh before running.');
        }
        setPreview({ ...payload, clientScopeKey: requestedScopeKey });
      } catch (error) {
        if (!controller.signal.aborted && previewRequestRef.current === requestId) {
          setPreview(null);
          setPreviewError(error instanceof Error ? error.message : 'Batch preview failed.');
        }
      } finally {
        if (!controller.signal.aborted && previewRequestRef.current === requestId) {
          setPreviewLoading(false);
        }
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (previewRequestRef.current === requestId) previewRequestRef.current += 1;
    };
  }, [excludedKey, excludeTicketIds, open, previewScopeKey, refreshNonce, results.length, running, settings]);

  const highImpactCount = preview?.eligible.filter((item) => item.hasHighImpact).length ?? 0;
  const processedCount = results.filter((item) =>
    !['pending', 'running', 'not_run'].includes(item.status),
  ).length;
  const runProgress = results.length > 0 ? processedCount / results.length : 0;
  const summary = useMemo<AutopilotBatchSummary>(() => ({
    results,
    succeeded: results.filter((item) => item.status === 'succeeded').length,
    stale: results.filter((item) => item.status === 'stale').length,
    failed: results.filter((item) => item.status === 'failed').length,
    inProgress: results.filter((item) => item.status === 'in_progress').length,
    notRun: results.filter((item) => item.status === 'not_run').length,
  }), [results]);

  if (!open) return null;

  const patchSettings = (patch: Partial<AutopilotBatchSettings>) => {
    setPreview(null);
    setSettings((current) => ({ ...current, ...patch }));
  };

  const updateResult = (
    target: AutopilotBatchItemResult[],
    index: number,
    patch: Partial<AutopilotBatchItemResult>,
  ) => {
    target[index] = { ...target[index], ...patch };
    setResults(target.map((item) => ({ ...item })));
  };

  const runBatch = async () => {
    if (!preview || preview.eligible.length === 0 || running) return;
    if (preview.clientScopeKey !== previewScopeKey) {
      setPreviewError('These settings changed after the preview. A current exact set is being rebuilt.');
      setPreview(null);
      setRefreshNonce((value) => value + 1);
      return;
    }
    if (Date.parse(preview.expiresAt) <= Date.now()) {
      setPreviewError('This preview expired. Refresh it before running so no newer plan is silently included.');
      setPreview(null);
      setRefreshNonce((value) => value + 1);
      return;
    }
    if (highImpactCount > 0) {
      const ticketNumbers = preview.eligible
        .filter((item) => item.hasHighImpact)
        .map((item) => `#${item.ticketNumber}`)
        .join(', ');
      const confirmed = window.confirm(
        `This exact preview includes ${highImpactCount} plan${highImpactCount === 1 ? '' : 's'} that will change Shopify orders (${ticketNumbers}). They will run sequentially with live evidence checks. Continue?`,
      );
      if (!confirmed) return;
    }

    const working: AutopilotBatchItemResult[] = preview.eligible.map((candidate) => ({
      candidate,
      status: 'pending',
      message: 'Waiting',
    }));
    const idempotencyKeys = preview.eligible.map(() => crypto.randomUUID());
    setResults(working);
    setRunning(true);
    onRunningChange(true);

    let nextIndex = 0;
    let stopScheduling = false;
    const workers = Array.from(
      { length: Math.min(preview.effectiveConcurrency, preview.eligible.length) },
      async () => {
        while (true) {
          if (stopScheduling) return;
          const index = nextIndex;
          nextIndex += 1;
          if (index >= preview.eligible.length) return;
          updateResult(working, index, { status: 'running', message: 'Running live safety checks…' });
          const candidate = preview.eligible[index];
          let result = await submitAutopilotBatchCandidate({
            candidate,
            idempotencyKey: idempotencyKeys[index],
          });
          // A dropped browser response is safe to retry with the same key. The
          // per-plan executor will replay receipts instead of repeating effects.
          if (result.status === 0) {
            result = await submitAutopilotBatchCandidate({
              candidate,
              idempotencyKey: idempotencyKeys[index],
            });
          }

          let status: BatchItemStatus;
          let message: string;
          if (result.status === 202) {
            status = 'in_progress';
            message = 'A durable worker still owns this run; it remains in the queue for safe resume.';
          } else if (result.ok) {
            const completion = batchDecisionCompletion(result);
            status = completion.completed ? 'succeeded' : 'failed';
            message = completion.message;
          } else if (result.status === 409 || result.status === 412) {
            status = 'stale';
            if (autopilotConflictNeedsRegeneration(result.code)) {
              const refresh = await requestAutopilotPlanRefresh({
                ticketId: candidate.ticketId,
                planId: candidate.planId,
                planRevision: candidate.planRevision,
                contextFingerprint: candidate.contextFingerprint,
                contextVersion: candidate.contextVersion,
                reason: result.code ?? 'batch_stale_conflict',
              });
              message = refresh.ok
                ? `${result.error || 'Plan changed.'} Nothing ran; Autopilot rebuilt it for a future reviewed run.`
                : `${result.error || 'Plan changed.'} Nothing ran, and regeneration failed: ${refresh.error || 'try again shortly.'}`;
            } else {
              message = result.error || 'Plan changed; skipped without substituting the newer plan.';
            }
          } else {
            status = 'failed';
            message = result.error || 'Execution failed.';
          }
          updateResult(working, index, { status, message });

          if (batchResultStopsScheduling({ failureMode: settings.failureMode, status })) {
            stopScheduling = true;
          }
        }
      },
    );
    await Promise.all(workers);
    for (let index = 0; index < working.length; index++) {
      if (working[index].status === 'pending') {
        updateResult(working, index, {
          status: 'not_run',
          message: 'Not started because this batch stopped on an earlier result.',
        });
      }
    }
    const finalSummary: AutopilotBatchSummary = {
      results: working.map((item) => ({ ...item })),
      succeeded: working.filter((item) => item.status === 'succeeded').length,
      stale: working.filter((item) => item.status === 'stale').length,
      failed: working.filter((item) => item.status === 'failed').length,
      inProgress: working.filter((item) => item.status === 'in_progress').length,
      notRun: working.filter((item) => item.status === 'not_run').length,
    };
    setRunning(false);
    onRunningChange(false);
    await onComplete(finalSummary);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end"
      style={{ background: 'rgba(3, 7, 18, 0.62)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-run-title"
        aria-describedby="batch-run-description"
        className="h-full w-full max-w-[560px] flex flex-col shadow-2xl"
        style={{
          background: 'var(--bg-primary)',
          borderLeft: '1px solid var(--border-primary)',
        }}
      >
        <header className="flex items-start gap-3 px-4 sm:px-6 py-5" style={{ borderBottom: '1px solid var(--border-primary)' }}>
          <span
            className="grid place-items-center flex-shrink-0"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              color: 'var(--color-source-ai)',
              background: 'color-mix(in srgb, var(--color-source-ai) 12%, transparent)',
            }}
          >
            <SlidersHorizontal size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="batch-run-title" style={{ fontSize: 16, fontWeight: 750, color: 'var(--text-primary)' }}>
              Batch approve &amp; run
            </h2>
            <p id="batch-run-description" className="mt-0.5" style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
              Freeze an exact confidence-matched set, then run each plan through the normal live safety fences.
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            disabled={running}
            aria-label="Close batch settings"
            className="grid place-items-center rounded-lg disabled:opacity-35"
            style={{ width: 32, height: 32, color: 'var(--text-tertiary)' }}
          >
            <X size={17} />
          </button>
        </header>

        {results.length > 0 ? (
          <>
            <div className="px-4 sm:px-6 py-5" style={{ borderBottom: '1px solid var(--border-secondary)' }} aria-live="polite">
              <div className="flex items-end justify-between">
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-quaternary)' }}>
                    {running ? 'Batch in progress' : 'Batch complete'}
                  </div>
                  <div className="mt-1" style={{ fontSize: 22, fontWeight: 760, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {processedCount} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-tertiary)' }}>/ {results.length} processed</span>
                  </div>
                </div>
                <Gauge size={24} style={{ color: running ? 'var(--color-source-ai)' : 'var(--color-success)' }} />
              </div>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full"
                style={{ background: 'var(--bg-tertiary)' }}
                role="progressbar"
                aria-label="Batch processing progress"
                aria-valuemin={0}
                aria-valuemax={results.length}
                aria-valuenow={processedCount}
                aria-valuetext={`${processedCount} of ${results.length} plans processed`}
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${runProgress * 100}%`,
                    background: running ? 'var(--color-source-ai)' : 'var(--color-success)',
                    transition: 'width 180ms ease',
                  }}
                />
              </div>
              {!running && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1" style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                  <span style={{ color: 'var(--color-success)' }}>{summary.succeeded} completed</span>
                  {summary.stale > 0 && <span style={{ color: 'var(--color-warning)' }}>{summary.stale} refreshed / skipped</span>}
                  {summary.failed > 0 && <span style={{ color: 'var(--color-danger)' }}>{summary.failed} failed</span>}
                  {summary.inProgress > 0 && <span>{summary.inProgress} still running</span>}
                  {summary.notRun > 0 && <span>{summary.notRun} not started</span>}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {results.map((item) => (
                <div
                  key={item.candidate.ticketId}
                  className="flex items-start gap-3 px-3 py-3"
                  style={{ borderBottom: '1px solid var(--border-secondary)' }}
                >
                  <span className="mt-0.5" style={{ color: statusTone(item.status) }}>{statusIcon(item.status)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 11, fontWeight: 750, color: 'var(--text-tertiary)' }}>
                        #{item.candidate.ticketNumber}
                      </span>
                      <span className="truncate" style={{ fontSize: 12.5, fontWeight: 620, color: 'var(--text-primary)' }}>
                        {item.candidate.subject}
                      </span>
                      <span className="ml-auto" style={{ fontSize: 11, fontWeight: 700, color: statusTone(item.status) }}>
                        {item.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-1" style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-tertiary)' }}>
                      {item.message}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <footer className="flex flex-col items-stretch gap-3 px-4 sm:px-6 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderTop: '1px solid var(--border-primary)' }}>
              <p style={{ fontSize: 11, color: 'var(--text-quaternary)' }}>
                {running ? 'Keep this tab open while the remaining plans start.' : 'Changed plans were never replaced or retried automatically.'}
              </p>
              {!running && (
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setResults([]);
                      setPreview(null);
                      setRefreshNonce((value) => value + 1);
                    }}
                    className="px-3.5 py-2 rounded-lg"
                    style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
                  >
                    New preview
                  </button>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg"
                    style={{ fontSize: 12, fontWeight: 700, background: 'var(--color-accent)', color: 'var(--color-accent-foreground, #fff)' }}
                  >
                    Done
                  </button>
                </div>
              )}
            </footer>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <section className="px-4 sm:px-6 py-5" aria-labelledby="confidence-range-label">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 id="confidence-range-label" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                      Effective confidence range
                    </h3>
                    <p className="mt-0.5" style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      Uses the lowest policy-capped score across the plan and its actions, never a higher raw model score.
                    </p>
                  </div>
                  <strong style={{ fontSize: 15, color: 'var(--color-source-ai)', fontVariantNumeric: 'tabular-nums' }}>
                    {settings.minConfidencePercent}–{settings.maxConfidencePercent}%
                  </strong>
                </div>
                <div className="mt-4 relative h-1.5 rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
                  <span
                    className="absolute h-full rounded-full"
                    style={{
                      left: `${settings.minConfidencePercent}%`,
                      right: `${100 - settings.maxConfidencePercent}%`,
                      background: 'var(--color-source-ai)',
                    }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div role="group" aria-labelledby="batch-minimum-confidence-label" style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    <span id="batch-minimum-confidence-label">Minimum</span>
                    <div className="flex items-center gap-2 mt-1.5">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={settings.minConfidencePercent}
                        onChange={(event) => patchSettings({
                          minConfidencePercent: Math.min(settings.maxConfidencePercent, Number(event.target.value)),
                        })}
                        className="min-w-0 flex-1"
                        aria-label="Minimum confidence percentage slider"
                      />
                      <input
                        type="number"
                        min={0}
                        max={settings.maxConfidencePercent}
                        value={settings.minConfidencePercent}
                        onChange={(event) => patchSettings({
                          minConfidencePercent: Math.min(settings.maxConfidencePercent, clampPercent(Number(event.target.value))),
                        })}
                        className="w-16 rounded-md px-2 py-1.5 text-right"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', fontSize: 12 }}
                        aria-label="Minimum confidence percentage"
                      />
                    </div>
                  </div>
                  <div role="group" aria-labelledby="batch-maximum-confidence-label" style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    <span id="batch-maximum-confidence-label">Maximum</span>
                    <div className="flex items-center gap-2 mt-1.5">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={settings.maxConfidencePercent}
                        onChange={(event) => patchSettings({
                          maxConfidencePercent: Math.max(settings.minConfidencePercent, Number(event.target.value)),
                        })}
                        className="min-w-0 flex-1"
                        aria-label="Maximum confidence percentage slider"
                      />
                      <input
                        type="number"
                        min={settings.minConfidencePercent}
                        max={100}
                        value={settings.maxConfidencePercent}
                        onChange={(event) => patchSettings({
                          maxConfidencePercent: Math.max(settings.minConfidencePercent, clampPercent(Number(event.target.value))),
                        })}
                        className="w-16 rounded-md px-2 py-1.5 text-right"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', fontSize: 12 }}
                        aria-label="Maximum confidence percentage"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="px-4 sm:px-6 py-5" style={{ borderTop: '1px solid var(--border-secondary)' }} aria-labelledby="run-controls-label">
                <h3 id="run-controls-label" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Run controls</h3>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    Maximum plans
                    <select
                      value={settings.maxPlans}
                      onChange={(event) => patchSettings({ maxPlans: Number(event.target.value) })}
                      className="mt-1.5 w-full rounded-lg px-2.5 py-2"
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', fontSize: 12 }}
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    Parallel plans
                    <select
                      value={settings.concurrency}
                      onChange={(event) => patchSettings({ concurrency: Number(event.target.value) })}
                      disabled={settings.includeHighImpact}
                      className="mt-1.5 w-full rounded-lg px-2.5 py-2 disabled:opacity-45"
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', fontSize: 12 }}
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    On failure
                    <select
                      value={settings.failureMode}
                      onChange={(event) => patchSettings({ failureMode: event.target.value as 'continue' | 'stop' })}
                      className="mt-1.5 w-full rounded-lg px-2.5 py-2"
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', fontSize: 12 }}
                    >
                      <option value="continue">Continue safe plans</option>
                      <option value="stop">Stop batch</option>
                    </select>
                  </label>
                </div>

                <label className="mt-4 flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.requireCalibrated}
                    onChange={(event) => patchSettings({ requireCalibrated: event.target.checked })}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block" style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)' }}>
                      Require mature reviewed calibration (strict)
                    </span>
                    <span className="block mt-0.5" style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--text-quaternary)' }}>
                      Requires at least {MIN_AUTOPILOT_BATCH_MODEL_REVIEWS} individual reviews for this model cohort and reviewed evidence for the limiting score.
                    </span>
                  </span>
                </label>
                <div
                  className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5"
                  style={{
                    border: '1px solid var(--border-secondary)',
                    background: 'color-mix(in srgb, var(--color-source-ai) 5%, transparent)',
                  }}
                >
                  <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-source-ai)' }} />
                  <p style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-quaternary)' }}>
                    {settings.requireCalibrated
                      ? `Strict mode includes only mature, reviewed-calibrated plans.`
                      : 'Guarded mode uses the lowest policy-capped plan/action confidence, never a higher raw model score. Live evidence, stale-plan, duplicate-customer, idempotency, and Shopify mutation safeguards still apply. Batch outcomes remain lower-trust and never calibrate their own cohort.'}
                  </p>
                </div>
                <label
                  className="mt-3 flex items-start gap-3 rounded-lg px-3 py-3 cursor-pointer"
                  style={{
                    border: `1px solid ${settings.includeHighImpact ? 'color-mix(in srgb, var(--color-danger) 45%, var(--border-primary))' : 'var(--border-secondary)'}`,
                    background: settings.includeHighImpact ? 'color-mix(in srgb, var(--color-danger) 6%, transparent)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={settings.includeHighImpact}
                    onChange={(event) => patchSettings({ includeHighImpact: event.target.checked })}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 650, color: settings.includeHighImpact ? 'var(--color-danger)' : 'var(--text-secondary)' }}>
                      <Ban size={12} /> Include Shopify order changes
                    </span>
                    <span className="block mt-0.5" style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--text-quaternary)' }}>
                      Cancellation, refund, and address updates. Forces one-at-a-time execution and an exact-set confirmation.
                    </span>
                  </span>
                </label>
              </section>

              <section
                className="px-4 sm:px-6 py-5"
                style={{ borderTop: '1px solid var(--border-secondary)' }}
                aria-labelledby="preview-label"
                aria-live="polite"
                aria-busy={previewLoading}
              >
                <div className="flex items-center justify-between">
                  <h3 id="preview-label" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Exact preview</h3>
                  {previewLoading && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-source-ai)' }} />}
                </div>

                {previewError ? (
                  <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5" style={{ background: 'color-mix(in srgb, var(--color-danger) 9%, transparent)', color: 'var(--color-danger)' }}>
                    <WifiOff size={14} className="mt-0.5 flex-shrink-0" />
                    <p style={{ fontSize: 11.5, lineHeight: 1.45 }}>{previewError}</p>
                  </div>
                ) : preview ? (
                  <>
                    <div className="mt-3 flex items-center gap-4">
                      <div>
                        <div style={{ fontSize: 25, fontWeight: 780, color: preview.eligible.length ? 'var(--color-success)' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                          {preview.eligible.length}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-quaternary)' }}>eligible of {preview.totalQueue}</div>
                      </div>
                      <div className="h-9" style={{ width: 1, background: 'var(--border-secondary)' }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
                           {Object.entries(preview.excludedCounts)
                             .filter(([, count]) => Number(count) > 0)
                             .map(([reason, count]) => (
                              <span key={reason}>{count} {EXCLUSION_LABELS[reason as AutopilotBatchExclusionReason]}</span>
                            ))}
                        </div>
                        <p className="mt-1.5" style={{ fontSize: 10.5, color: 'var(--text-quaternary)' }}>
                          {preview.effectiveConcurrency === 1 ? 'Sequential run' : `${preview.effectiveConcurrency} plans at a time`}
                          {' · '}preview expires {new Date(preview.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    {preview.truncated && (
                      <div className="mt-3 flex items-start gap-2" style={{ fontSize: 11, color: 'var(--color-warning)' }}>
                        <AlertTriangle size={13} className="mt-0.5" />
                        The queue exceeded {preview.scannedQueue} scanned plans. This preview still freezes only the listed set.
                      </div>
                    )}
                    <div className="mt-3">
                      {preview.eligible.slice(0, 8).map((candidate) => (
                        <div
                          key={candidate.ticketId}
                          className="flex items-center gap-2 py-2"
                          style={{ borderBottom: '1px solid var(--border-secondary)' }}
                        >
                          <span style={{ fontSize: 10.5, fontWeight: 750, color: 'var(--text-tertiary)' }}>#{candidate.ticketNumber}</span>
                          <span className="truncate min-w-0 flex-1" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{candidate.subject}</span>
                          {candidate.hasConsolidation && (
                            <span title="Consolidates related tickets" role="img" aria-label="Consolidates related tickets">
                              <Layers3 size={12} style={{ color: 'var(--color-source-ai)' }} />
                            </span>
                          )}
                          {candidate.hasHighImpact && (
                            <span title="Changes a Shopify order" role="img" aria-label="Changes a Shopify order">
                              <Ban size={12} style={{ color: 'var(--color-danger)' }} />
                            </span>
                          )}
                          <span
                            title={candidate.confidenceIsCalibrated ? 'Reviewed-calibrated effective confidence' : 'Policy-capped effective confidence; the limiting score has no reviewed calibration yet'}
                            style={{ fontSize: 11, fontWeight: 750, color: candidate.effectiveConfidence >= 0.85 ? 'var(--color-success)' : 'var(--color-warning)', fontVariantNumeric: 'tabular-nums' }}
                          >
                            {candidate.effectiveConfidencePercent.toFixed(1)}% {candidate.confidenceIsCalibrated ? 'cal.' : 'guarded'}
                          </span>
                        </div>
                      ))}
                      {preview.eligible.length > 8 && (
                        <p className="pt-2.5" style={{ fontSize: 10.5, color: 'var(--text-quaternary)' }}>
                          + {preview.eligible.length - 8} more exact plans in this preview
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="mt-3" style={{ fontSize: 11.5, color: 'var(--text-quaternary)' }}>Building a current preview…</p>
                )}
              </section>
            </div>

            <footer className="px-4 sm:px-6 py-4" style={{ borderTop: '1px solid var(--border-primary)' }}>
              <div className="flex items-center gap-2 mb-3" style={{ fontSize: 10.5, color: 'var(--text-quaternary)' }}>
                <ShieldCheck size={12} style={{ color: 'var(--color-success)' }} />
                Changed plans are skipped, never replaced. Every run keeps its own durable idempotency key.
              </div>
              <button
                onClick={runBatch}
                disabled={!preview || previewLoading || preview.eligible.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg py-3 disabled:opacity-40"
                style={{ fontSize: 13, fontWeight: 750, background: 'var(--color-accent)', color: 'var(--color-accent-foreground, #fff)' }}
              >
                <Play size={14} fill="currentColor" />
                Approve &amp; run {preview?.eligible.length ?? 0} plan{preview?.eligible.length === 1 ? '' : 's'}
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
