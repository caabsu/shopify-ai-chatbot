'use client';

import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Wrench, Clock, Cpu, Hash, MessageSquare, ExternalLink } from 'lucide-react';
import { formatDuration } from '@/lib/utils';

interface DebugMessage {
  response: string;
  toolsUsed?: string[];
  metadata?: { model: string; tokensInput: number; tokensOutput: number; latencyMs: number };
}

export default function PlaygroundPage() {
  const [iframeKey, setIframeKey] = useState(0);
  const [conversationId, setConversationId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [messageCount, setMessageCount] = useState(0);
  const [lastResponse, setLastResponse] = useState<DebugMessage | null>(null);
  const [allToolsUsed, setAllToolsUsed] = useState<string[]>([]);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  const handleNewConversation = useCallback(() => {
    setIframeKey((k) => k + 1);
    setConversationId('');
    setSessionId('');
    setMessageCount(0);
    setLastResponse(null);
    setAllToolsUsed([]);
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const { type, data } = event.data || {};

      if (type === 'widget:session') {
        setConversationId(data.conversationId || '');
        setSessionId(data.sessionId || '');
        setMessageCount(0);
        setLastResponse(null);
        setAllToolsUsed([]);
      }

      if (type === 'widget:message') {
        setMessageCount((c) => c + 1);
        setLastResponse({
          response: data.response,
          toolsUsed: data.toolsUsed,
        });
        if (data.toolsUsed && data.toolsUsed.length > 0) {
          setAllToolsUsed((prev) => {
            const combined = new Set([...prev, ...data.toolsUsed]);
            return Array.from(combined);
          });
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="space-y-4 h-[calc(100vh-2rem)]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Playground</h2>
          <p className="text-sm text-gray-500">Live widget preview — changes auto-sync</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={backendUrl + '/widget/playground'}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ExternalLink size={14} /> Open Standalone
          </a>
          <button
            onClick={handleNewConversation}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RotateCcw size={14} /> New Conversation
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1" style={{ height: 'calc(100% - 70px)' }}>
        {/* Live widget iframe */}
        <div className="lg:col-span-2 h-full min-h-[640px]">
          <iframe
            key={iframeKey}
            src={`${backendUrl}/widget/playground${iframeKey > 0 ? '?reset=1' : ''}`}
            className="w-full h-full rounded-2xl border-0"
            style={{
              boxShadow: '0 0 0 1px rgba(92,61,46,0.06), 0 12px 40px rgba(44,24,16,0.12), 0 4px 12px rgba(44,24,16,0.06)',
              background: '#FAF6F0',
            }}
            allow="clipboard-read; clipboard-write"
          />
        </div>

        {/* Debug panel */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 overflow-y-auto">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-1.5">
            <Cpu size={14} className="text-gray-400" />
            Debug Info
          </h3>

          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs text-gray-500 flex items-center gap-1">
                <Hash size={10} /> Conversation ID
              </dt>
              <dd className="font-mono text-xs truncate mt-0.5">{conversationId || '—'}</dd>
            </div>

            <div>
              <dt className="text-xs text-gray-500 flex items-center gap-1">
                <Hash size={10} /> Session ID
              </dt>
              <dd className="font-mono text-xs truncate mt-0.5">{sessionId || '—'}</dd>
            </div>

            <div>
              <dt className="text-xs text-gray-500 flex items-center gap-1">
                <MessageSquare size={10} /> Messages Exchanged
              </dt>
              <dd className="mt-0.5">{messageCount}</dd>
            </div>
          </dl>

          {/* Latest response tools */}
          {lastResponse?.toolsUsed && lastResponse.toolsUsed.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <h4 className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-2">
                <Wrench size={10} /> Last Response Tools
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {lastResponse.toolsUsed.map((t) => (
                  <span
                    key={t}
                    className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-md font-mono"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* All tools used in conversation */}
          {allToolsUsed.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <h4 className="text-xs font-medium text-gray-500 flex items-center gap-1 mb-2">
                <Wrench size={10} /> All Tools Used
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {allToolsUsed.map((t) => (
                  <span
                    key={t}
                    className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-md font-mono"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Hint */}
          <div className="mt-6 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 leading-relaxed">
              This is the live widget. Design and behavior changes deploy automatically.
              Click on &quot;New Conversation&quot; to start fresh.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
