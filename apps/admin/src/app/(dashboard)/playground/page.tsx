'use client';

import { useState, useRef, useEffect } from 'react';
import { RotateCcw, Wrench, Clock, Cpu } from 'lucide-react';
import { formatDuration } from '@/lib/utils';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  metadata?: { model: string; tokensInput: number; tokensOutput: number; latencyMs: number };
}

/** Markdown renderer matching the widget exactly */
function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="aicb-inline-link">$1</a>'
  );

  const lines = html.split('\n');
  const processed: string[] = [];
  let inList = false;

  for (const line of lines) {
    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) { processed.push('<ul class="aicb-md-list">'); inList = true; }
      processed.push(`<li>${listMatch[1]}</li>`);
    } else {
      if (inList) { processed.push('</ul>'); inList = false; }
      const kvMatch = line.match(/^<strong>([^<]+)<\/strong>\s*(?:—|:|–)\s*(.+)$/);
      if (kvMatch) {
        processed.push(`<div class="aicb-kv"><span class="aicb-kv__label">${kvMatch[1]}</span><span class="aicb-kv__value">${kvMatch[2]}</span></div>`);
      } else if (line.trim() === '') {
        processed.push('{{BREAK}}');
      } else {
        processed.push(line);
      }
    }
  }
  if (inList) processed.push('</ul>');

  html = processed.join('\n');
  html = html.replace(/(?:\n?{{BREAK}}\n?)+/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>(<(?:ul|div)[^>]*>)/g, '$1');
  html = html.replace(/(<\/(?:ul|div)>)<\/p>/g, '$1');
  html = html.replace(/<p><br><\/p>/g, '');
  html = html.replace(/<br>(<div class="aicb-kv)/g, '$1');
  html = html.replace(/(aicb-kv__value">[^<]*<\/span><\/div>)<br>/g, '$1');
  html = html.replace(/<br>(<ul)/g, '$1');
  html = html.replace(/(<\/ul>)<br>/g, '$1');

  return html;
}

/** Widget CSS injected into the playground for exact visual match */
const WIDGET_CSS = `
  .pg-widget {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1a1a1a;
    -webkit-font-smoothing: antialiased;
  }
  .pg-widget *, .pg-widget *::before, .pg-widget *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  .pg-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: #1a1a1a;
    color: #fff;
    border-radius: 16px 16px 0 0;
  }
  .pg-header-info { display: flex; align-items: center; gap: 10px; }
  .pg-header-dot {
    width: 8px; height: 8px; border-radius: 50%; background: #34d399;
    animation: pg-pulse 2s infinite;
  }
  @keyframes pg-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.4); }
    50% { box-shadow: 0 0 0 4px rgba(52, 211, 153, 0); }
  }
  .pg-header-title { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
  .pg-messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: #f7f7f8;
  }
  .pg-messages::-webkit-scrollbar { width: 4px; }
  .pg-messages::-webkit-scrollbar-track { background: transparent; }
  .pg-messages::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 4px; }
  .pg-msg {
    display: flex;
    flex-direction: column;
    max-width: 85%;
    animation: pg-msg-in 0.2s ease-out;
  }
  @keyframes pg-msg-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .pg-msg--user { align-self: flex-end; }
  .pg-msg--assistant { align-self: flex-start; }
  .pg-bubble {
    padding: 10px 14px;
    border-radius: 16px;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .pg-msg--user .pg-bubble {
    background: #1a1a1a;
    color: #fff;
    border-bottom-right-radius: 4px;
    white-space: pre-wrap;
    font-size: 13.5px;
    line-height: 1.5;
  }
  .pg-msg--assistant .pg-bubble {
    background: #fff;
    color: #1a1a1a;
    border-bottom-left-radius: 4px;
    border: 1px solid rgba(0,0,0,0.06);
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    font-size: 13.5px;
    line-height: 1.6;
    letter-spacing: -0.005em;
  }
  .pg-msg--assistant .pg-bubble p { margin: 0; }
  .pg-msg--assistant .pg-bubble p + p { margin-top: 10px; }
  .pg-msg--assistant .pg-bubble strong { font-weight: 600; color: #111; }
  .pg-msg--assistant .pg-bubble em { font-style: italic; color: #555; }
  .pg-msg--assistant .pg-bubble .aicb-inline-link {
    color: #1a1a1a; font-weight: 500; text-decoration: underline;
    text-decoration-color: rgba(0,0,0,0.25); text-underline-offset: 2px;
  }
  .pg-msg--assistant .pg-bubble .aicb-inline-link:hover { text-decoration-color: #1a1a1a; }
  .pg-msg--assistant .pg-bubble .aicb-kv {
    display: flex; align-items: baseline; gap: 8px; padding: 5px 0; font-size: 13px;
  }
  .pg-msg--assistant .pg-bubble .aicb-kv__label {
    font-weight: 600; color: #1a1a1a; flex-shrink: 0;
    font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.02em;
  }
  .pg-msg--assistant .pg-bubble .aicb-kv__value { color: #444; font-size: 13px; }
  .pg-msg--assistant .pg-bubble .aicb-md-list {
    margin: 8px 0 6px; padding-left: 0; list-style: none;
  }
  .pg-msg--assistant .pg-bubble .aicb-md-list li {
    position: relative; margin-bottom: 0; line-height: 1.55;
    padding: 5px 0 5px 14px; font-size: 13px; color: #333;
    border-bottom: 1px solid rgba(0,0,0,0.04);
  }
  .pg-msg--assistant .pg-bubble .aicb-md-list li::before {
    content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
    width: 4px; height: 4px; background: #999; border-radius: 50%;
  }
  .pg-msg--assistant .pg-bubble .aicb-md-list li:last-child { border-bottom: none; }
  .pg-typing {
    display: flex; align-items: center; gap: 4px;
    padding: 12px 18px;
    background: #fff;
    border: 1px solid rgba(0,0,0,0.06);
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    border-radius: 16px;
    border-bottom-left-radius: 4px;
  }
  .pg-typing span {
    width: 6px; height: 6px; background: #c0c0c0; border-radius: 50%;
    animation: pg-bounce 1.4s infinite ease-in-out;
  }
  .pg-typing span:nth-child(2) { animation-delay: 0.16s; }
  .pg-typing span:nth-child(3) { animation-delay: 0.32s; }
  @keyframes pg-bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
    40% { transform: scale(1); opacity: 1; }
  }
  .pg-input-bar {
    display: flex; align-items: flex-end; gap: 8px;
    padding: 12px 16px 16px;
    border-top: 1px solid rgba(0,0,0,0.05);
    background: #fff;
    border-radius: 0 0 16px 16px;
  }
  .pg-input {
    flex: 1; resize: none; border: 1.5px solid rgba(0,0,0,0.08);
    border-radius: 12px; padding: 10px 14px; font-family: inherit;
    font-size: 13.5px; line-height: 1.5; outline: none;
    min-height: 40px; max-height: 100px; background: #f9fafb;
    transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;
  }
  .pg-input:focus {
    border-color: #1a1a1a; background: #fff;
    box-shadow: 0 0 0 3px rgba(26,26,26,0.06);
  }
  .pg-input::placeholder { color: #999; }
  .pg-send {
    width: 40px; height: 40px; border: none; background: #1a1a1a;
    color: #fff; border-radius: 12px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    transition: background 0.15s, opacity 0.15s, transform 0.15s;
  }
  .pg-send:hover:not(:disabled) { background: #333; transform: scale(1.04); }
  .pg-send:active:not(:disabled) { transform: scale(0.96); }
  .pg-send:disabled { opacity: 0.25; cursor: not-allowed; }
`;

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<ChatMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function startSession() {
    setMessages([]);
    setConversationId('');
    setSessionId('');
    setSelectedMsg(null);

    const res = await fetch('/api/playground', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'session' }),
    });
    const data = await res.json();
    setConversationId(data.conversationId);
    setSessionId(data.sessionId);
    if (data.greeting) {
      setMessages([{ role: 'assistant', content: data.greeting }]);
    }
  }

  useEffect(() => { startSession(); }, []);
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading || !conversationId) return;

    const userMsg = input.trim();
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message', sessionId, conversationId, message: userMsg }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.response || data.error || 'No response',
        toolsUsed: data.toolsUsed,
      }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error communicating with backend' }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{ __html: WIDGET_CSS }} />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Playground</h2>
        <button
          onClick={startSession}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RotateCcw size={14} /> New Conversation
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chat — exact widget replica */}
        <div
          className="pg-widget lg:col-span-2 flex flex-col h-[640px] rounded-2xl overflow-hidden"
          style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08), 0 24px 48px rgba(0,0,0,0.06)' }}
        >
          {/* Header */}
          <div className="pg-header">
            <div className="pg-header-info">
              <span className="pg-header-dot" />
              <span className="pg-header-title">Customer Support</span>
            </div>
          </div>

          {/* Messages */}
          <div className="pg-messages">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`pg-msg pg-msg--${m.role}`}
                onClick={() => m.role === 'assistant' ? setSelectedMsg(m) : null}
                style={{ cursor: m.role === 'assistant' ? 'pointer' : 'default' }}
              >
                <div
                  className="pg-bubble"
                  {...(m.role === 'assistant'
                    ? { dangerouslySetInnerHTML: { __html: renderMarkdown(m.content) } }
                    : { children: m.content }
                  )}
                />
              </div>
            ))}
            {loading && (
              <div className="pg-msg pg-msg--assistant">
                <div className="pg-typing">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>

          {/* Input */}
          <div className="pg-input-bar">
            <textarea
              ref={inputRef}
              className="pg-input"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              disabled={loading || !conversationId}
            />
            <button
              className="pg-send"
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="Send message"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>

        {/* Debug panel */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 h-[640px] overflow-y-auto">
          <h3 className="text-sm font-semibold mb-3">Debug Info</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-gray-500">Conversation ID</dt>
              <dd className="font-mono text-xs truncate">{conversationId || '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Session ID</dt>
              <dd className="font-mono text-xs truncate">{sessionId || '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Messages</dt>
              <dd>{messages.length}</dd>
            </div>
          </dl>

          {selectedMsg && (
            <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
              <h4 className="text-xs font-medium text-gray-500">Selected Message</h4>
              {selectedMsg.toolsUsed && selectedMsg.toolsUsed.length > 0 && (
                <div>
                  <span className="text-xs text-gray-500">Tools used:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedMsg.toolsUsed.map((t) => (
                      <span key={t} className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {selectedMsg.metadata && (
                <>
                  <div className="flex items-center gap-1 text-xs text-gray-600">
                    <Cpu size={10} /> {selectedMsg.metadata.model}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-gray-600">
                    <Clock size={10} /> {formatDuration(selectedMsg.metadata.latencyMs)}
                  </div>
                  <div className="text-xs text-gray-600">
                    {selectedMsg.metadata.tokensInput} in / {selectedMsg.metadata.tokensOutput} out tokens
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
