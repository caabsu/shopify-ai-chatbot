import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const anthropic = new Anthropic();

// ── Tool definitions ────────────────────────────────────────────────────────

const tools: Anthropic.Tool[] = [
  {
    name: 'get_widget_design',
    description: 'Get the current chatbot widget design settings (colors, fonts, sizes, position, etc.)',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'update_widget_design',
    description: 'Update one or more chatbot widget design settings. Only include fields you want to change.',
    input_schema: {
      type: 'object' as const,
      properties: {
        primaryColor: { type: 'string', description: 'Hex color for buttons, accents, header gradient (e.g. "#9D6528")' },
        backgroundColor: { type: 'string', description: 'Hex background color of the chat window (e.g. "#F3EDE2")' },
        headerTitle: { type: 'string', description: 'Title shown in the chat header (e.g. "Misu Support")' },
        position: { type: 'string', enum: ['bottom-right', 'bottom-left'], description: 'Widget position on page' },
        bubbleIcon: { type: 'string', enum: ['chat', 'headset', 'sparkle', 'help'], description: 'Floating button icon' },
        welcomeMessage: { type: 'string', description: 'Tooltip message shown near bubble before user opens chat. Empty string to disable.' },
        inputPlaceholder: { type: 'string', description: 'Placeholder text in the message input box' },
        borderRadius: { type: 'string', enum: ['sharp', 'rounded', 'pill'], description: 'Corner rounding style' },
        fontSize: { type: 'string', enum: ['small', 'medium', 'large'], description: 'Base font size' },
        showBrandingBadge: { type: 'boolean', description: 'Show "Powered by" branding badge' },
        autoOpenDelay: { type: 'number', description: 'Seconds before auto-opening chat (0 = disabled)' },
        fontFamily: { type: 'string', description: 'CSS font-family for body text (e.g. "Bricolage Grotesque, sans-serif")' },
        headingFontFamily: { type: 'string', description: 'CSS font-family for header title (e.g. "Fraunces, serif")' },
        headingFontWeight: { type: 'string', description: 'CSS font-weight for header title (e.g. "200", "400", "600")' },
      },
      required: [],
    },
  },
  {
    name: 'get_preset_actions',
    description: 'Get the current preset action buttons shown to users before they send a message.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'update_preset_actions',
    description: 'Replace all preset action buttons. Each action needs: id (unique slug), label (display text), icon (one of: truck, return, search, contact, sparkles, leaf, repeat, user, help, tag, package, headphones), prompt (message sent when clicked).',
    input_schema: {
      type: 'object' as const,
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier slug' },
              label: { type: 'string', description: 'Display label on the button' },
              icon: { type: 'string', description: 'Icon name: truck, return, search, contact, sparkles, leaf, repeat, user, help, tag, package, headphones' },
              prompt: { type: 'string', description: 'Message sent to AI when user clicks this action' },
            },
            required: ['id', 'label', 'icon', 'prompt'],
          },
          description: 'Array of preset actions (recommended 3-5)',
        },
      },
      required: ['actions'],
    },
  },
  {
    name: 'get_greeting',
    description: 'Get the current greeting message shown when a new chat session starts.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'update_greeting',
    description: 'Update the greeting message shown at the start of new conversations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        greeting: { type: 'string', description: 'The greeting text (supports emoji)' },
      },
      required: ['greeting'],
    },
  },
  {
    name: 'get_contact_form_config',
    description: 'Get the current contact form configuration (header, subtitle, categories, success messages, field visibility).',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'update_contact_form_config',
    description: 'Update the contact form configuration. Only include fields you want to change.',
    input_schema: {
      type: 'object' as const,
      properties: {
        headerTitle: { type: 'string', description: 'Form heading text (e.g. "Get in Touch")' },
        subtitle: { type: 'string', description: 'Paragraph below the heading explaining the form purpose' },
        submitButtonText: { type: 'string', description: 'Text on the submit button (e.g. "Send Message")' },
        successTitle: { type: 'string', description: 'Title shown after successful submission (e.g. "Message Received")' },
        successMessage: { type: 'string', description: 'Body text shown after successful submission' },
        categories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string', description: 'Internal value (snake_case slug)' },
              label: { type: 'string', description: 'Display label shown in the dropdown' },
            },
            required: ['value', 'label'],
          },
          description: 'Dropdown categories for "What can we help with?" (recommended 4-6)',
        },
        showOrderNumber: { type: 'boolean', description: 'Show the optional Order Number field' },
        showPhone: { type: 'boolean', description: 'Show the optional Phone field' },
      },
      required: [],
    },
  },
];

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a design and content specialist for an AI chatbot widget and contact form. You help brand owners customize the appearance and messaging of their customer support tools.

You have tools to read and modify:
- **Widget Design** — colors, fonts, font weights, border radius, position, bubble icon, branding badge
- **Preset Actions** — the quick-action buttons shown to users (label, icon, prompt)
- **Greeting** — the first message users see when opening the chat
- **Contact Form** — the support contact form (header, subtitle, categories, submit button text, success messages, optional fields like order number and phone)

When the user asks you to change something, ALWAYS use your tools to:
1. First read the current config (so you know what to preserve)
2. Then apply the requested changes (merging with existing values)

Available icons for preset actions: truck, return, search, contact, sparkles, leaf, repeat, user, help, tag, package, headphones.

Available bubble icons: chat, headset, sparkle, help.
Available border radius: sharp (8px), rounded (16px), pill (24px).
Available font sizes: small, medium, large.
Available positions: bottom-right, bottom-left.

When suggesting colors, provide hex codes. When suggesting fonts, use CSS font-family values with fallbacks.

For contact form categories, use snake_case values (e.g. "order_issue") and human-readable labels (e.g. "Order Issue"). Recommended 4-6 categories. The form also has optional fields (order number, phone) that can be toggled on/off.

Be concise and proactive. After making changes, briefly confirm what was updated. If the user asks for suggestions, offer specific, opinionated recommendations based on modern design best practices.`;

// ── Tool handlers ───────────────────────────────────────────────────────────

async function handleTool(
  name: string,
  input: Record<string, unknown>,
  brandId: string,
): Promise<string> {
  switch (name) {
    case 'get_widget_design': {
      const { data } = await supabase
        .from('ai_config').select('value')
        .eq('brand_id', brandId).eq('key', 'widget_design').single();
      return data?.value || '{}';
    }

    case 'update_widget_design': {
      // Merge with existing
      const { data: existing } = await supabase
        .from('ai_config').select('value')
        .eq('brand_id', brandId).eq('key', 'widget_design').single();
      const current = existing?.value ? JSON.parse(existing.value) : {};
      const updated = { ...current, ...input };
      await supabase.from('ai_config').upsert(
        { brand_id: brandId, key: 'widget_design', value: JSON.stringify(updated), updated_at: new Date().toISOString() },
        { onConflict: 'brand_id,key' },
      );
      return JSON.stringify(updated);
    }

    case 'get_preset_actions': {
      const { data } = await supabase
        .from('ai_config').select('value')
        .eq('brand_id', brandId).eq('key', 'preset_actions').single();
      return data?.value || '[]';
    }

    case 'update_preset_actions': {
      const actions = input.actions as Array<Record<string, string>>;
      await supabase.from('ai_config').upsert(
        { brand_id: brandId, key: 'preset_actions', value: JSON.stringify(actions), updated_at: new Date().toISOString() },
        { onConflict: 'brand_id,key' },
      );
      return JSON.stringify(actions);
    }

    case 'get_greeting': {
      const { data } = await supabase
        .from('ai_config').select('value')
        .eq('brand_id', brandId).eq('key', 'greeting').single();
      return data?.value || '';
    }

    case 'update_greeting': {
      const greeting = input.greeting as string;
      await supabase.from('ai_config').upsert(
        { brand_id: brandId, key: 'greeting', value: greeting, updated_at: new Date().toISOString() },
        { onConflict: 'brand_id,key' },
      );
      return greeting;
    }

    case 'get_contact_form_config': {
      const { data } = await supabase
        .from('ai_config').select('value')
        .eq('brand_id', brandId).eq('key', 'contact_form_config').single();
      return data?.value || '{}';
    }

    case 'update_contact_form_config': {
      const { data: existing } = await supabase
        .from('ai_config').select('value')
        .eq('brand_id', brandId).eq('key', 'contact_form_config').single();
      const current = existing?.value ? JSON.parse(existing.value) : {};
      const updated = { ...current, ...input };
      await supabase.from('ai_config').upsert(
        { brand_id: brandId, key: 'contact_form_config', value: JSON.stringify(updated), updated_at: new Date().toISOString() },
        { onConflict: 'brand_id,key' },
      );
      return JSON.stringify(updated);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messages } = await request.json() as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'Messages required' }, { status: 400 });
  }

  try {
    // Run tool-use loop
    let anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let finalText = '';
    const appliedChanges: string[] = [];

    for (let i = 0; i < 5; i++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools,
        messages: anthropicMessages,
      });

      // Collect text and tool uses
      const textParts: string[] = [];
      const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for (const block of response.content) {
        if (block.type === 'text') textParts.push(block.text);
        if (block.type === 'tool_use') toolUses.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
      }

      if (toolUses.length === 0) {
        finalText = textParts.join('');
        break;
      }

      // Execute tools and continue conversation
      anthropicMessages = [
        ...anthropicMessages,
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: await Promise.all(toolUses.map(async (tu) => {
            const result = await handleTool(tu.name, tu.input, session.brandId);
            if (tu.name.startsWith('update_')) appliedChanges.push(tu.name.replace('update_', ''));
            return { type: 'tool_result' as const, tool_use_id: tu.id, content: result };
          })),
        },
      ];

      // If this was the last iteration and we got text, use it
      if (i === 4) finalText = textParts.join('') || 'Changes applied.';
    }

    return NextResponse.json({
      response: finalText,
      appliedChanges,
    });
  } catch (err) {
    console.error('[design-agent]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI request failed' },
      { status: 500 },
    );
  }
}
