import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase.js';
import * as conversationService from '../services/conversation.service.js';
import * as aiService from '../services/ai.service.js';
import type { PresetAction } from '../types/index.js';

export const chatRouter = Router();

// Rate limiter: per sessionId, 20 requests/min
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 60_000;

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(sessionId);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(sessionId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// POST /api/chat/session
chatRouter.post('/session', async (req: Request, res: Response) => {
  try {
    const { sessionId, customerEmail, customerName, pageUrl } = req.body as {
      sessionId?: string;
      customerEmail?: string;
      customerName?: string;
      pageUrl?: string;
    };

    // Load greeting and presets
    const { data: configRows } = await supabase
      .from('ai_config')
      .select('key, value')
      .in('key', ['greeting', 'preset_actions']);

    const configMap = new Map(
      (configRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
    );

    const greeting = configMap.get('greeting') ?? 'Hi there! How can I help you today?';
    let presetActions: PresetAction[] = [];
    try {
      presetActions = JSON.parse(configMap.get('preset_actions') ?? '[]');
    } catch {
      // Use empty presets
    }

    // Resume existing session or create new
    if (sessionId) {
      // Look for an active conversation with this sessionId in metadata
      const { data: existing } = await supabase
        .from('conversations')
        .select()
        .eq('metadata->>sessionId', sessionId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        const conv = existing[0];

        // Fetch previous messages so the widget can restore conversation history
        const previousMessages = await conversationService.getMessages(conv.id);
        const messages = previousMessages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: new Date(m.created_at).getTime(),
          }));

        res.json({
          sessionId,
          conversationId: conv.id,
          greeting,
          presetActions,
          messages,
        });
        return;
      }
    }

    // Create new conversation
    const newSessionId = sessionId || uuidv4();
    const conversation = await conversationService.createConversation({
      customer_email: customerEmail,
      customer_name: customerName,
      page_url: pageUrl,
      metadata: { sessionId: newSessionId },
    });

    // Store greeting as first assistant message
    await conversationService.addMessage(conversation.id, 'assistant', greeting);

    res.json({
      sessionId: newSessionId,
      conversationId: conversation.id,
      greeting,
      presetActions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chat.controller] session error:', message);
    res.status(500).json({ error: 'Failed to create chat session' });
  }
});

// POST /api/chat/message
chatRouter.post('/message', async (req: Request, res: Response) => {
  try {
    const { sessionId, conversationId, message, presetActionId } = req.body as {
      sessionId?: string;
      conversationId?: string;
      message?: string;
      presetActionId?: string;
    };

    // Validate
    if (!conversationId) {
      res.status(400).json({ error: 'conversationId is required' });
      return;
    }

    if (!message && !presetActionId) {
      res.status(400).json({ error: 'Either message or presetActionId is required' });
      return;
    }

    // Rate limit
    const limitKey = sessionId || conversationId;
    if (!checkRateLimit(limitKey)) {
      res.status(429).json({ error: 'Too many messages. Please wait a moment.' });
      return;
    }

    // Check message length
    if (message && message.length > 5000) {
      res.status(400).json({ error: 'Message is too long. Please keep it under 5000 characters.' });
      return;
    }

    // Verify conversation exists
    const conversation = await conversationService.getConversation(conversationId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Resolve message text
    let messageText = message || '';
    if (presetActionId) {
      const { data: configRows } = await supabase
        .from('ai_config')
        .select('value')
        .eq('key', 'preset_actions')
        .single();

      if (configRows) {
        try {
          const presets: PresetAction[] = JSON.parse(configRows.value);
          const preset = presets.find((p) => p.id === presetActionId);
          if (preset) {
            messageText = preset.prompt;
          }
        } catch {
          // Use original message
        }
      }
    }

    if (!messageText) {
      res.status(400).json({ error: 'Could not resolve message text' });
      return;
    }

    // Store user message
    await conversationService.addMessage(conversationId, 'user', messageText);

    // Process with AI
    const result = await aiService.processMessage(conversationId, messageText, {
      customerEmail: conversation.customer_email ?? undefined,
      pageUrl: conversation.page_url ?? undefined,
      cartId: (conversation.metadata as Record<string, unknown> | null)?.cartId as string | undefined,
    });

    // Store assistant response
    await conversationService.addMessage(conversationId, 'assistant', result.response, {
      model: result.metadata.model,
      tokens_input: result.metadata.tokensInput,
      tokens_output: result.metadata.tokensOutput,
      latency_ms: result.metadata.latencyMs,
      tools_used: result.toolsUsed,
    });

    res.json({
      response: result.response,
      navigationButtons: result.navigationButtons,
      productCards: result.productCards,
      cartData: result.cartData,
      toolsUsed: result.toolsUsed,
      conversationStatus: result.conversationStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 3).join('\n') : '';
    console.error('[chat.controller] message error:', message, stack);
    res.status(500).json({
      error: "I'm having trouble right now. Please try again in a moment.",
    });
  }
});
