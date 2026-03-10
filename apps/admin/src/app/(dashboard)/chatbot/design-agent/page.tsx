'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Loader2, RotateCcw, Paintbrush } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Show me the current widget design settings',
  'Make the header font thinner and more elegant',
  'Change the preset actions — make them more professional',
  'Suggest a warm color palette for the widget',
  'Update the greeting to be more friendly and concise',
  'Show me the current preset action buttons',
];

export default function DesignAgentPage() {
  const { brandName } = useBrand();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [appliedChanges, setAppliedChanges] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text?: string) {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput('');

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: msg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch('/api/design-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      setMessages([...newMessages, { role: 'assistant', content: data.response }]);
      if (data.appliedChanges?.length > 0) {
        setAppliedChanges((prev) => [...prev, ...data.appliedChanges]);
      }
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}` },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function resetConversation() {
    setMessages([]);
    setAppliedChanges([]);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' }}
          >
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Design Agent
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              AI-powered design assistant for {brandName}&apos;s chatbot &amp; form
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {appliedChanges.length > 0 && (
            <span className="text-[11px] px-2 py-1 rounded-full font-medium" style={{ background: 'rgba(34,197,94,0.1)', color: '#16a34a' }}>
              {appliedChanges.length} change{appliedChanges.length > 1 ? 's' : ''} applied
            </span>
          )}
          <button
            onClick={resetConversation}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>

      {/* Chat area */}
      <div
        className="flex-1 rounded-xl overflow-hidden flex flex-col min-h-0"
        style={{ border: '1px solid var(--border-primary)', background: 'var(--bg-primary)' }}
      >
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-5 py-8">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.1), rgba(99,102,241,0.1))' }}
              >
                <Paintbrush size={24} style={{ color: '#8b5cf6' }} />
              </div>
              <div>
                <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  Design Agent
                </p>
                <p className="text-sm max-w-md" style={{ color: 'var(--text-tertiary)' }}>
                  Tell me what you want to change about your chatbot widget, preset actions, greeting message, or contact form. I can read your current settings and apply changes directly.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 max-w-lg justify-center">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-xs px-3 py-1.5 rounded-lg transition-all hover:scale-[1.02]"
                    style={{
                      border: '1px solid var(--border-primary)',
                      color: 'var(--text-secondary)',
                      background: 'var(--bg-secondary)',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                style={
                  msg.role === 'user'
                    ? { background: '#6366f1', color: '#fff' }
                    : { background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-secondary)' }
                }
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div
                className="rounded-2xl px-4 py-3 flex items-center gap-2 text-sm"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)', border: '1px solid var(--border-secondary)' }}
              >
                <Loader2 size={14} className="animate-spin" /> Thinking...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe a design change..."
              rows={1}
              className="flex-1 resize-none rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{
                border: '1px solid var(--border-primary)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                // @ts-expect-error CSS custom property
                '--tw-ring-color': '#6366f150',
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white transition-opacity disabled:opacity-40"
              style={{ background: '#6366f1' }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
