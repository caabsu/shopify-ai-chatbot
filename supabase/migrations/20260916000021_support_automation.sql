-- Durable, brand-scoped unattended support. Existing execution receipts remain
-- the authority for external side effects; this table owns delay and takeover.
create table if not exists public.support_automation_settings (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  enabled boolean not null default false,
  min_confidence numeric not null default 0.90 check (min_confidence between 0.80 and 1),
  mutation_min_confidence numeric not null default 0.95 check (mutation_min_confidence between 0.90 and 1),
  allow_cancellation boolean not null default true,
  allow_retention_refund boolean not null default true,
  activated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_worker_at timestamptz,
  check (mutation_min_confidence >= min_confidence)
);
create table if not exists public.support_automation_holds (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.support_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  plan_id uuid not null unique,
  plan_fingerprint text not null,
  context_version bigint not null,
  status text not null default 'scheduled' check (status in ('scheduled','running','completed','needs_review','cancelled')),
  scheduled_for timestamptz not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  reason text,
  confidence numeric not null check (confidence between 0 and 1),
  plan_snapshot jsonb not null,
  result jsonb
);
create index if not exists support_jobs_due on public.support_automation_jobs(scheduled_for) where status = 'scheduled';
create index if not exists support_jobs_brand_status on public.support_automation_jobs(brand_id,status,created_at desc);
create index if not exists support_jobs_ticket on public.support_automation_jobs(ticket_id,created_at desc);
alter table public.support_automation_settings enable row level security;
alter table public.support_automation_holds enable row level security;
alter table public.support_automation_jobs enable row level security;
create policy service_support_settings on public.support_automation_settings for all to service_role using (true) with check (true);
create policy service_support_holds on public.support_automation_holds for all to service_role using (true) with check (true);
create policy service_support_jobs on public.support_automation_jobs for all to service_role using (true) with check (true);
insert into public.support_automation_settings(brand_id,enabled)
select id,true from public.brands where slug = 'warm-by-design' on conflict do nothing;

-- A queue claim is atomic and never automatically reclaims an interrupted run.
-- Interrupted side effects require the existing receipt reconciliation flow.
create or replace function public.claim_support_automation_job(p_job_id uuid)
returns setof public.support_automation_jobs language sql security definer set search_path = public as $$
  update public.support_automation_jobs j set status = 'running', started_at = now()
  where j.id = p_job_id and j.status = 'scheduled' and j.scheduled_for <= now()
    and exists (select 1 from public.support_automation_settings s where s.brand_id = j.brand_id and s.enabled)
    and not exists (select 1 from public.support_automation_holds h where h.ticket_id = j.ticket_id)
    and exists (select 1 from public.tickets t where t.id = j.ticket_id and t.brand_id = j.brand_id
      and t.context_version = j.context_version and t.metadata->'autopilot'->>'id' = j.plan_id::text
      and t.metadata->'autopilot'->>'status' = 'proposed' and t.status in ('open','pending'))
  returning j.*;
$$;
revoke all on function public.claim_support_automation_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_support_automation_job(uuid) to service_role;

-- One current job per ticket, joined to the exact current plan. Historical
-- executions never make a new incoming message appear already handled.
create or replace view public.support_inbox_queue with (security_invoker = true) as
select t.id, t.brand_id, t.subject, t.customer_email, t.customer_name, t.updated_at,
  to_jsonb(t) as ticket, to_jsonb(j) as job,
  (j.status = 'needs_review' or h.ticket_id is not null or
    (coalesce(j.status,'') not in ('scheduled','running','completed') and
      t.metadata->'autopilot'->>'status' in ('proposed','failed','partially_executed'))) as needs_review
from public.tickets t
left join public.support_automation_jobs j on j.plan_id::text = t.metadata->'autopilot'->>'id' and j.ticket_id = t.id and j.brand_id = t.brand_id
left join public.support_automation_holds h on h.ticket_id = t.id and h.brand_id = t.brand_id
where t.status in ('open','pending') and t.merged_into_ticket_id is null;
revoke all on public.support_inbox_queue from anon, authenticated;
grant select on public.support_inbox_queue to service_role;
