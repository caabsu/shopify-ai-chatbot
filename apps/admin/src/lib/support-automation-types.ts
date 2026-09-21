import type { AutopilotPlan, Ticket } from './types';

export interface SupportAutomationSettings {
  brand_id: string;
  enabled: boolean;
  min_confidence: number;
  mutation_min_confidence: number;
  allow_cancellation: boolean;
  allow_retention_refund: boolean;
  activated_at: string;
  updated_at: string;
  last_worker_at: string | null;
}
export interface SupportAutomationJob {
  id: string;
  brand_id: string;
  ticket_id: string;
  plan_id: string;
  plan_fingerprint: string;
  context_version: number;
  status: 'scheduled' | 'running' | 'completed' | 'needs_review' | 'cancelled';
  scheduled_for: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  reason: string | null;
  confidence: number;
  plan_snapshot: AutopilotPlan;
  result: Record<string, unknown> | null;
}
export interface SupportFeedItem {
  ticket: Ticket;
  job: SupportAutomationJob | null;
}
export interface SupportFeed {
  items: SupportFeedItem[];
  counts: { inbox: number; scheduled: number; completed: number; review: number };
  settings: SupportAutomationSettings | null;
  automation_ready: boolean;
  worker_configured: boolean;
  total: number;
  page: number;
  page_size: number;
}
