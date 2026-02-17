'use client';

import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Wrench, Hash, MessageSquare, ExternalLink } from 'lucide-react';

export default function PlaygroundPage() {
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
          <h2 className="text-lg font-semibold">Playground</h2>
          <p className="text-xs text-gray-400 mt-0.5">Live widget preview — auto-syncs with every deployment</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${backendUrl}/widget/playground`}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ExternalLink size={12} /> Standalone
          </a>
          <button
            onClick={handleNewConversation}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
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
          style={{
            boxShadow: '0 0 0 1px rgba(92,61,46,0.06), 0 12px 40px rgba(44,24,16,0.10), 0 4px 12px rgba(44,24,16,0.05)',
          }}
        >
          <iframe
            key={iframeKey}
            src={`${backendUrl}/widget/playground`}
            className="absolute inset-0 w-full h-full border-0"
            style={{ background: '#FAF6F0' }}
            allow="clipboard-read; clipboard-write"
            title="Chat Widget Preview"
          />
        </div>

        {/* Debug panel */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 overflow-y-auto flex flex-col gap-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Debug</h3>

          <div className="space-y-3">
            <div>
              <dt className="text-[11px] text-gray-400 flex items-center gap-1 mb-0.5">
                <Hash size={10} /> Conversation
              </dt>
              <dd className="font-mono text-[11px] text-gray-600 truncate">{conversationId || '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-gray-400 flex items-center gap-1 mb-0.5">
                <Hash size={10} /> Session
              </dt>
              <dd className="font-mono text-[11px] text-gray-600 truncate">{sessionId || '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-gray-400 flex items-center gap-1 mb-0.5">
                <MessageSquare size={10} /> Exchanges
              </dt>
              <dd className="text-sm font-medium">{messageCount}</dd>
            </div>
          </div>

          {lastTools.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <h4 className="text-[11px] text-gray-400 flex items-center gap-1 mb-2">
                <Wrench size={10} /> Last Tools
              </h4>
              <div className="flex flex-wrap gap-1">
                {lastTools.map((t) => (
                  <span key={t} className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200/60 px-1.5 py-0.5 rounded font-mono">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {allToolsUsed.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <h4 className="text-[11px] text-gray-400 flex items-center gap-1 mb-2">
                <Wrench size={10} /> All Tools
              </h4>
              <div className="flex flex-wrap gap-1">
                {allToolsUsed.map((t) => (
                  <span key={t} className="text-[10px] bg-gray-50 text-gray-600 border border-gray-200/60 px-1.5 py-0.5 rounded font-mono">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-auto pt-3 border-t border-gray-100">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              This is the live widget embedded via iframe. Design and behavior changes deploy automatically.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
