'use client';

import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Wrench, Hash, MessageSquare, ExternalLink } from 'lucide-react';

export default function ChatbotPlaygroundPage() {
  const [iframeKey, setIframeKey] = useState(0);
  const [conversationId, setConversationId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [messageCount, setMessageCount] = useState(0);
  const [lastTools, setLastTools] = useState<string[]>([]);
  const [allToolsUsed, setAllToolsUsed] = useState<string[]>([]);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  const handleNewConversation = useCallback(() => {
    setIframeKey((k) => k + 1);
    setConversationId('');
    setSessionId('');
    setMessageCount(0);
    setLastTools([]);
    setAllToolsUsed([]);
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const { type, data } = event.data || {};
      if (type === 'widget:session') {
        setConversationId(data.conversationId || '');
        setSessionId(data.sessionId || '');
        setMessageCount(0);
        setLastTools([]);
        setAllToolsUsed([]);
      }
      if (type === 'widget:message') {
        setMessageCount((c) => c + 1);
        if (data.toolsUsed && data.toolsUsed.length > 0) {
          setLastTools(data.toolsUsed);
          setAllToolsUsed((prev) => Array.from(new Set([...prev, ...data.toolsUsed])));
        } else {
          setLastTools([]);
        }
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Playground</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Live mock store with chat widget -- click the bubble to interact
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${backendUrl}/widget/playground`}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{
              border: '1px solid var(--border-primary)',
              color: 'var(--text-secondary)',
            }}
          >
            <ExternalLink size={12} /> Standalone
          </a>
          <button
            onClick={handleNewConversation}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={{
              border: '1px solid var(--border-primary)',
              color: 'var(--text-primary)',
            }}
          >
            <RotateCcw size={12} /> New Conversation
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 min-h-0">
        {/* Widget iframe */}
        <div
          className="relative rounded-2xl overflow-hidden min-h-[500px]"
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          <iframe
            key={iframeKey}
            src={`${backendUrl}/widget/playground${iframeKey > 0 ? '?newconv=1' : ''}`}
            className="absolute inset-0 w-full h-full border-0"
            style={{ background: 'var(--bg-primary)' }}
            allow="clipboard-read; clipboard-write"
            title="Chat Widget Preview"
          />
        </div>

        {/* Debug panel */}
        <div
          className="rounded-xl p-4 overflow-y-auto flex flex-col gap-4"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Debug
          </h3>

          <div className="space-y-3">
            <div>
              <dt className="text-[11px] flex items-center gap-1 mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                <Hash size={10} /> Conversation
              </dt>
              <dd className="font-mono text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
                {conversationId || '--'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] flex items-center gap-1 mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                <Hash size={10} /> Session
              </dt>
              <dd className="font-mono text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
                {sessionId || '--'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] flex items-center gap-1 mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                <MessageSquare size={10} /> Exchanges
              </dt>
              <dd className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{messageCount}</dd>
            </div>
          </div>

          {lastTools.length > 0 && (
            <div className="pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
              <h4 className="text-[11px] flex items-center gap-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>
                <Wrench size={10} /> Last Tools
              </h4>
              <div className="flex flex-wrap gap-1">
                {lastTools.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                    style={{
                      backgroundColor: 'rgba(245,158,11,0.1)',
                      color: '#d97706',
                      border: '1px solid rgba(245,158,11,0.2)',
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {allToolsUsed.length > 0 && (
            <div className="pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
              <h4 className="text-[11px] flex items-center gap-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>
                <Wrench size={10} /> All Tools
              </h4>
              <div className="flex flex-wrap gap-1">
                {allToolsUsed.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-secondary)',
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-auto pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Mock store with live chat bubble. Click the floating button to open the widget, just like a real customer would.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
