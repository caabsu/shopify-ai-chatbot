'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, User, Bot, Clock, Cpu, Wrench } from 'lucide-react';
import { formatDate, formatDuration, cn } from '@/lib/utils';
import { ChatMarkdown } from '@/components/chat-markdown';
import type { Conversation, Message } from '@/lib/types';

const roleBadge: Record<string, { label: string; bg: string; text: string; icon: typeof User }> = {
  user: { label: 'Customer', bg: 'rgba(59,130,246,0.12)', text: '#3b82f6', icon: User },
  assistant: { label: 'AI', bg: 'rgba(168,85,247,0.12)', text: '#a855f7', icon: Bot },
  system: { label: 'System', bg: 'rgba(156,163,175,0.12)', text: '#9ca3af', icon: Cpu },
  human_agent: { label: 'Agent', bg: 'rgba(249,115,22,0.12)', text: '#f97316', icon: User },
};

export default function ChatbotConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-96 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }
  if (!conversation) {
    return <p style={{ color: 'var(--text-tertiary)' }}>Conversation not found</p>;
  }

  return (
    <div className="space-y-4">
      <Link
        href="/chatbot/conversations"
        className="inline-flex items-center gap-1.5 text-sm transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft size={14} /> Back to conversations
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Messages */}
        <div
          className="lg:col-span-3 rounded-xl p-5 space-y-4"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Messages ({messages.length})
          </h2>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            {messages.map((m) => {
              const badge = roleBadge[m.role] ?? roleBadge.system;
              const Icon = badge.icon;
              return (
                <div key={m.id} className="flex gap-3">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: badge.bg }}
                  >
                    <Icon size={14} style={{ color: badge.text }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-xs font-medium px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: badge.bg, color: badge.text }}
                      >
                        {badge.label}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{formatDate(m.created_at)}</span>
                      {m.latency_ms && (
                        <span className="text-xs flex items-center gap-0.5" style={{ color: 'var(--text-tertiary)' }}>
                          <Clock size={10} /> {formatDuration(m.latency_ms)}
                        </span>
                      )}
                      {m.tokens_input && (
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {m.tokens_input + (m.tokens_output ?? 0)} tokens
                        </span>
                      )}
                    </div>
                    {m.role === 'assistant' ? (
                      <ChatMarkdown content={m.content} className="text-sm break-words" />
                    ) : (
                      <p className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}>
                        {m.content}
                      </p>
                    )}
                    {m.tools_used && m.tools_used.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <Wrench size={10} style={{ color: 'var(--text-tertiary)' }} />
                        {m.tools_used.map((t) => (
                          <span
                            key={t}
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: 'var(--bg-tertiary)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {t}
                          </span>
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
        <div
          className="rounded-xl p-5 space-y-4 h-fit"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Details</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Status</dt>
              <dd className="font-medium capitalize" style={{ color: 'var(--text-primary)' }}>{conversation.status}</dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Customer</dt>
              <dd style={{ color: 'var(--text-primary)' }}>
                {conversation.customer_email || conversation.customer_name || 'Anonymous'}
              </dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Messages</dt>
              <dd style={{ color: 'var(--text-primary)' }}>{conversation.message_count}</dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Started</dt>
              <dd style={{ color: 'var(--text-primary)' }}>{formatDate(conversation.created_at)}</dd>
            </div>
            {conversation.page_url && (
              <div>
                <dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Page URL</dt>
                <dd className="truncate" style={{ color: 'var(--text-primary)' }}>{conversation.page_url}</dd>
              </div>
            )}
            {conversation.satisfaction_score && (
              <div>
                <dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Satisfaction</dt>
                <dd style={{ color: 'var(--text-primary)' }}>{conversation.satisfaction_score}/5</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
