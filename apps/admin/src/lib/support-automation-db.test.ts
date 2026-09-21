import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('durable queue enforces one claim, due time, customer version, tenant, pause and human takeover', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create table brands(id uuid primary key,slug text); create table tickets(id uuid primary key,brand_id uuid,context_version bigint,metadata jsonb,status text,subject text,customer_email text,customer_name text,updated_at timestamptz default now(),merged_into_ticket_id uuid);`);
    await db.exec(await readFile(new URL('../../../../supabase/migrations/20260916000021_support_automation.sql', import.meta.url), 'utf8'));
    const brand = '00000000-0000-4000-8000-000000000001';
    const ticket = '00000000-0000-4000-8000-000000000002';
    const plan = '00000000-0000-4000-8000-000000000003';
    await db.query('insert into brands values ($1,$2)', [brand, 'test']);
    await db.query('insert into support_automation_settings(brand_id,enabled) values ($1,true)', [brand]);
    await db.query('insert into tickets(id,brand_id,context_version,metadata,status) values ($1,$2,1,$3,\'open\')', [ticket, brand, JSON.stringify({ autopilot: { id: plan, status: 'proposed' } })]);
    const result = await db.query<{ id: string }>(`insert into support_automation_jobs(brand_id,ticket_id,plan_id,plan_fingerprint,context_version,scheduled_for,confidence,plan_snapshot) values ($1,$2,$3,'frozen',1,now()+interval '20 minutes',0.97,'{}') returning id`, [brand, ticket, plan]);
    const job = result.rows[0].id;
    const view = await db.query<{ needs_review: boolean }>('select needs_review from support_inbox_queue');
    assert.equal(view.rows[0].needs_review, false, 'scheduled work does not also appear in human review');
    const claim = () => db.query('select * from claim_support_automation_job($1)', [job]);
    assert.equal((await claim()).rows.length, 0, 'cannot run early');
    await db.exec("update support_automation_jobs set scheduled_for=now()-interval '1 minute'");
    await db.exec('update support_automation_settings set enabled=false');
    assert.equal((await claim()).rows.length, 0, 'paused brand');
    await db.exec('update support_automation_settings set enabled=true');
    await db.query('insert into support_automation_holds(ticket_id,brand_id) values($1,$2)', [ticket, brand]);
    assert.equal((await claim()).rows.length, 0, 'human takeover');
    await db.exec('delete from support_automation_holds; update tickets set context_version=2');
    assert.equal((await claim()).rows.length, 0, 'new customer reply');
    await db.exec('update tickets set context_version=1');
    await db.query('update tickets set brand_id=$1', ['00000000-0000-4000-8000-000000000009']);
    assert.equal((await claim()).rows.length, 0, 'brand mismatch');
    await db.query('update tickets set brand_id=$1', [brand]);
    const claims = await Promise.all([claim(), claim()]);
    assert.equal(claims.reduce((sum, r) => sum + r.rows.length, 0), 1, 'exactly one worker claims');
    assert.equal((await claim()).rows.length, 0, 'running jobs never auto-retry');
    const rls = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname in ('support_automation_jobs','support_automation_holds','support_automation_settings')");
    assert.ok(rls.rows.every(row => row.relrowsecurity));
  } finally { await db.close(); }
});
