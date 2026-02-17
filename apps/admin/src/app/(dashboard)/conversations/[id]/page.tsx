'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, User, Bot, Clock, Cpu, Wrench } from 'lucide-react';
import { formatDate, formatDuration, cn } from '@/lib/utils';
import { ChatMarkdown } from '@/components/chat-markdown';
import type { Conversation, Message } from '@/lib/types';

const roleBadge: Record<string, { label: string; color: string; icon: typeof User }> = {
  user: { label: 'Customer', color: 'bg-blue-100 text-blue-800', icon: User },
  assistant: { label: 'AI', color: 'bg-purple-100 text-purple-800', icon: Bot },
  system: { label: 'System', color: 'bg-gray-100 text-gray-800', icon: Cpu },
  human_agent: { label: 'Agent', color: 'bg-orange-100 text-orange-800', icon: User },
};

export default function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/conversations/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setConversation(data.conversation);
        setMessages(data.messages ?? []);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="animate-pulse"><div className="h-96 bg-gray-200 rounded-xl" /></div>;
  if (!conversation) return <p className="text-gray-500">Conversation not found</p>;

  return (
    <div className="space-y-4">
      <Link href="/conversations" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-black">
        <ArrowLeft size={14} /> Back to conversations
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Messages */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-base font-semibold">Messages ({messages.length})</h2>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            {messages.map((m) => {
              const badge = roleBadge[m.role] ?? roleBadge.system;
              const Icon = badge.icon;
              return (
                <div key={m.id} className="flex gap-3">
                  <div className={cn('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0', badge.color)}>
                    <Icon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', badge.color)}>{badge.label}</span>
                      <span className="text-xs text-gray-400">{formatDate(m.created_at)}</span>
                      {m.latency_ms && (
                        <span className="text-xs text-gray-400 flex items-center gap-0.5">
                          <Clock size={10} /> {formatDuration(m.latency_ms)}
                        </span>
                      )}
                      {m.tokens_input && (
                        <span className="text-xs text-gray-400">
                          {m.tokens_input + (m.tokens_output ?? 0)} tokens
                        </span>
                      )}
                    </div>
                    {m.role === 'assistant' ? (
                      <ChatMarkdown content={m.content} className="text-sm break-words" />
                    ) : (
                      <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                    )}
                    {m.tools_used && m.tools_used.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <Wrench size={10} className="text-gray-400" />
                        {m.tools_used.map((t) => (
                          <span key={t} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Info sidebar */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 h-fit">
          <h3 className="text-sm font-semibold">Details</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-gray-500 text-xs">Status</dt>
              <dd className="font-medium capitalize">{conversation.status}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Customer</dt>
              <dd>{conversation.customer_email || conversation.customer_name || 'Anonymous'}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Messages</dt>
              <dd>{conversation.message_count}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs">Started</dt>
              <dd>{formatDate(conversation.created_at)}</dd>
            </div>
            {conversation.page_url && (
              <div>
                <dt className="text-gray-500 text-xs">Page URL</dt>
                <dd className="truncate">{conversation.page_url}</dd>
              </div>
            )}
            {conversation.satisfaction_score && (
              <div>
                <dt className="text-gray-500 text-xs">Satisfaction</dt>
                <dd>{conversation.satisfaction_score}/5</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
