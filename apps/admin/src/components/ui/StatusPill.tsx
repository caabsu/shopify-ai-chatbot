/**
 * StatusPill — the single source of truth for semantic status/priority/source/
 * classification colors across the dashboard. Replaces the per-page color objects
 * (PRIORITY_STYLES, STATUS_STYLES, SOURCE_STYLES, CLASSIFICATION_STYLES, …) that
 * were duplicated in 15+ files. Colors come from the design tokens in globals.css,
 * so a rebrand changes one place. See docs/PLATFORM-OVERHAUL.md (Stage 1).
 *
 * Usage:
 *   <StatusPill kind="status" value={ticket.status} />
 *   <StatusPill kind="priority" value={ticket.priority} />
 *   <StatusPill kind="source" value={ticket.source} />
 */
import type { CSSProperties, ReactNode } from 'react';

type Kind = 'status' | 'priority' | 'source' | 'classification';

// Maps each semantic value to a CSS token (var) defined in globals.css.
const TOKENS: Record<Kind, Record<string, string>> = {
  status: {
    open: 'var(--color-status-open)',
    pending: 'var(--color-status-pending)',
    resolved: 'var(--color-status-resolved)',
    closed: 'var(--color-status-closed)',
    active: 'var(--color-status-open)',
    escalated: 'var(--color-priority-urgent)',
  },
  priority: {
    urgent: 'var(--color-priority-urgent)',
    high: 'var(--color-priority-high)',
    medium: 'var(--color-priority-medium)',
    low: 'var(--color-priority-low)',
  },
  source: {
    email: 'var(--color-source-email)',
    form: 'var(--color-source-form)',
    ai_escalation: 'var(--color-source-ai)',
    ai: 'var(--color-source-ai)',
  },
  classification: {
    customer_support: 'var(--color-success)',
    promotional: 'var(--color-warning)',
    transactional: 'var(--color-info)',
    automated: 'var(--color-priority-low)',
    spam: 'var(--color-danger)',
    internal: 'var(--color-source-ai)',
  },
};

const FALLBACK = 'var(--text-secondary)';

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface StatusPillProps {
  kind: Kind;
  value: string | null | undefined;
  label?: string;
  icon?: ReactNode;
  className?: string;
}

export function StatusPill({ kind, value, label, icon, className }: StatusPillProps) {
  if (!value) return null;
  const color = TOKENS[kind][value] ?? FALLBACK;
  const text = label ?? humanize(value);
  return (
    <span
      className={`ds-pill${className ? ` ${className}` : ''}`}
      style={{ ['--pill-color' as keyof CSSProperties]: color } as CSSProperties}
      title={text}
    >
      {icon}
      {text}
    </span>
  );
}
