import { supabase } from '../config/supabase.js';
import type { Conversation, Message } from '../types/index.js';

export async function createConversation(data: {
  customer_email?: string;
  customer_name?: string;
  customer_phone?: string;
  page_url?: string;
  metadata?: Record<string, unknown>;
}): Promise<Conversation> {
  const { data: row, error } = await supabase
    .from('conversations')
    .insert(data)
    .select()
    .single();

  if (error) {
    console.error('[conversation.service] createConversation error:', error.message);
    throw new Error('Failed to create conversation');
  }
  return row as Conversation;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { data: row, error } = await supabase
    .from('conversations')
    .select()
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('[conversation.service] getConversation error:', error.message);
    throw new Error('Failed to get conversation');
  }
  return row as Conversation;
}

export async function updateConversation(
  id: string,
  updates: Partial<Pick<Conversation, 'status' | 'ended_at' | 'last_message_at' | 'message_count' | 'satisfaction_score' | 'resolved' | 'metadata'>>
): Promise<Conversation> {
  const { data: row, error } = await supabase
    .from('conversations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[conversation.service] updateConversation error:', error.message);
    throw new Error('Failed to update conversation');
  }
  return row as Conversation;
}

export async function addMessage(
  conversationId: string,
  role: Message['role'],
  content: string,
  metadata?: {
    model?: string;
    tokens_input?: number;
    tokens_output?: number;
    latency_ms?: number;
    tools_used?: string[];
  }
): Promise<Message> {
  const { data: msg, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      ...metadata,
    })
    .select()
    .single();

  if (error) {
    console.error('[conversation.service] addMessage error:', error.message);
    throw new Error('Failed to add message');
  }

  // Increment message_count and update last_message_at
  await supabase
    .from('conversations')
    .update({
      message_count: (await getMessageCount(conversationId)),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return msg as Message;
}

async function getMessageCount(conversationId: string): Promise<number> {
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  if (error) return 0;
  return count ?? 0;
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const { data: rows, error } = await supabase
    .from('messages')
    .select()
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[conversation.service] getMessages error:', error.message);
    throw new Error('Failed to get messages');
  }
  return (rows ?? []) as Message[];
}

export async function closeConversation(id: string): Promise<Conversation> {
  return updateConversation(id, {
    status: 'closed',
    ended_at: new Date().toISOString(),
  });
}
