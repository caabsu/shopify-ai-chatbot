import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { supabase } from '../config/supabase.js';
import { agentAuthMiddleware, signAgentToken, requireAdmin } from '../middleware/agent-auth.middleware.js';
import type { Agent } from '../types/index.js';

export const agentRouter = Router();

const SALT_ROUNDS = 10;

// ── POST /login — Agent Login ──────────────────────────────────────────────
agentRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const { data: agent, error } = await supabase
      .from('agents')
      .select()
      .eq('email', email)
      .eq('is_active', true)
      .single();

    if (error || !agent) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const typedAgent = agent as Agent;
    const passwordMatch = await bcrypt.compare(password, typedAgent.password_hash);

    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = await signAgentToken({
      id: typedAgent.id,
      email: typedAgent.email,
      name: typedAgent.name,
      role: typedAgent.role,
      brandId: typedAgent.brand_id,
    });

    // Set cookie
    res.setHeader('Set-Cookie', `agent_token=${token}; HttpOnly; Path=/; Max-Age=${24 * 60 * 60}; SameSite=Lax`);

    console.log(`[agent.controller] Agent logged in: ${typedAgent.email} (${typedAgent.role})`);

    res.json({
      token,
      agent: {
        id: typedAgent.id,
        email: typedAgent.email,
        name: typedAgent.name,
        role: typedAgent.role,
        avatar_url: typedAgent.avatar_url,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agent.controller] POST /login error:', message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /logout — Clear Cookie ────────────────────────────────────────────
agentRouter.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'agent_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ success: true });
});

// ── GET /me — Get Current Agent Info ────────────────────────────────────────
agentRouter.get('/me', agentAuthMiddleware, async (req, res) => {
  try {
    if (!req.agent) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { data: agent, error } = await supabase
      .from('agents')
      .select('id, brand_id, name, email, role, is_active, avatar_url, notification_preferences, created_at, updated_at')
      .eq('id', req.agent.id)
      .single();

    if (error || !agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json(agent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agent.controller] GET /me error:', message);
    res.status(500).json({ error: 'Failed to get agent info' });
  }
});

// ── GET / — List Agents (Admin Only) ────────────────────────────────────────
agentRouter.get('/', agentAuthMiddleware, requireAdmin, async (req, res) => {
  try {
    const brandId = req.agent?.brandId;
    let query = supabase
      .from('agents')
      .select('id, brand_id, name, email, role, is_active, avatar_url, created_at, updated_at');
    if (brandId) query = query.eq('brand_id', brandId);
    const { data: agents, error } = await query.order('created_at', { ascending: true });

    if (error) {
      console.error('[agent.controller] GET / error:', error.message);
      res.status(500).json({ error: 'Failed to list agents' });
      return;
    }

    res.json(agents ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agent.controller] GET / error:', message);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// ── POST / — Create Agent (Admin Only) ──────────────────────────────────────
agentRouter.post('/', agentAuthMiddleware, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role, avatar_url } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: 'name, email, and password are required' });
      return;
    }

    // Check for existing agent with same email
    const { data: existing } = await supabase
      .from('agents')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      res.status(409).json({ error: 'An agent with this email already exists' });
      return;
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const brandId = req.agent?.brandId;
    const { data: agent, error } = await supabase
      .from('agents')
      .insert({
        name,
        email,
        password_hash,
        role: role ?? 'agent',
        avatar_url: avatar_url ?? null,
        is_active: true,
        ...(brandId ? { brand_id: brandId } : {}),
      })
      .select('id, brand_id, name, email, role, is_active, avatar_url, created_at, updated_at')
      .single();

    if (error) {
      console.error('[agent.controller] POST / insert error:', error.message);
      res.status(500).json({ error: 'Failed to create agent' });
      return;
    }

    console.log(`[agent.controller] Created agent: ${email} (${role ?? 'agent'})`);
    res.status(201).json(agent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agent.controller] POST / error:', message);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// ── PATCH /:id — Update Agent (Admin Only) ──────────────────────────────────
agentRouter.patch('/:id', agentAuthMiddleware, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role, is_active, avatar_url, notification_preferences } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (role !== undefined) updates.role = role;
    if (is_active !== undefined) updates.is_active = is_active;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    if (notification_preferences !== undefined) updates.notification_preferences = notification_preferences;

    if (password) {
      updates.password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    }

    let updateQuery = supabase
      .from('agents')
      .update(updates)
      .eq('id', req.params.id);
    if (req.agent?.brandId) updateQuery = updateQuery.eq('brand_id', req.agent.brandId);
    const { data: agent, error } = await updateQuery
      .select('id, brand_id, name, email, role, is_active, avatar_url, notification_preferences, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      console.error('[agent.controller] PATCH /:id error:', error.message);
      res.status(500).json({ error: 'Failed to update agent' });
      return;
    }

    console.log(`[agent.controller] Updated agent: ${req.params.id}`);
    res.json(agent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agent.controller] PATCH /:id error:', message);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});
