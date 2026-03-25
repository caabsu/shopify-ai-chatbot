'use client';

import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, ExternalLink, Hash, ArrowRight, Zap, Mail, Settings, AlertCircle } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface DebugEvent {
  id: number;
  type: string;
  label: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export default function ReturnsPlaygroundPage() {
  const [iframeKey, setIframeKey] = useState(0);
  const [currentStep, setCurrentStep] = useState('lookup');
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [orderData, setOrderData] = useState<Record<string, unknown> | null>(null);
  const [ruleResult, setRuleResult] = useState<Record<string, unknown> | null>(null);
  const [aiDecision, setAiDecision] = useState<Record<string, unknown> | null>(null);
  const [emailTriggers, setEmailTriggers] = useState<string[]>([]);
  const [settingsApplied, setSettingsApplied] = useState<Record<string, unknown> | null>(null);
  const [debugMode, setDebugMode] = useState(false);

  const { brandSlug } = useBrand();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
  const brandQs = brandSlug && brandSlug !== 'outlight' ? `brand=${brandSlug}` : '';

  let eventCounter = 0;

  const handleReset = useCallback(() => {
    setIframeKey((k) => k + 1);
    setCurrentStep('lookup');
    setEvents([]);
    setOrderData(null);
    setRuleResult(null);
    setAiDecision(null);
    setEmailTriggers([]);
    setSettingsApplied(null);
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const { type, data } = event.data || {};
      if (!type?.startsWith('srp:')) return;

      const newEvent: DebugEvent = {
        id: ++eventCounter,
        type,
        label: type.replace('srp:', ''),
        data,
        timestamp: Date.now(),
      };
      setEvents((prev) => [...prev, newEvent]);

      if (type === 'srp:step_change') {
        setCurrentStep(data?.step || 'lookup');
      }
      if (type === 'srp:order_loaded') {
        setOrderData(data || null);
      }
      if (type === 'srp:submit_result') {
        if (data?.rule_result) setRuleResult(data.rule_result);
        if (data?.ai_recommendation) setAiDecision(data.ai_recommendation);
        if (data?.emails_sent) setEmailTriggers(data.emails_sent);
      }
      if (type === 'srp:config_loaded') {
        setSettingsApplied(data?.settings || null);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stepStyles: Record<string, { color: string; bg: string }> = {
    lookup: { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
    select_items: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
    confirm: { color: '#a855f7', bg: 'rgba(168,85,247,0.10)' },
    success: { color: '#22c55e', bg: 'rgba(34,197,94,0.10)' },
  };
  const currentStepStyle = stepStyles[currentStep] || stepStyles.lookup;

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Returns Playground</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Test the returns portal with debug information
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setDebugMode(!debugMode); setIframeKey(k => k + 1); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{
              border: '1px solid var(--border-primary)',
              color: debugMode ? '#f59e0b' : 'var(--text-tertiary)',
              backgroundColor: debugMode ? 'rgba(245,158,11,0.08)' : 'transparent',
            }}
          >
            {debugMode ? 'Debug ON' : 'Debug OFF'}
          </button>
          <a
            href={`${backendUrl}/widget/playground-returns${brandQs ? `?${brandQs}` : ''}`}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            <ExternalLink size={12} /> Standalone
          </a>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
            style={{ border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 min-h-0">
        {/* Widget iframe */}
        <div
          className="relative rounded-2xl overflow-hidden min-h-[500px]"
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          <iframe
            key={iframeKey}
            src={`${backendUrl}/widget/preview-returns?${[brandQs, debugMode ? 'debug=1' : ''].filter(Boolean).join('&')}`}
            className="absolute inset-0 w-full h-full border-0"
            style={{ background: 'var(--bg-primary)' }}
            title="Returns Portal Preview"
          />
        </div>

        {/* Debug panel */}
        <div
          className="rounded-xl p-4 overflow-y-auto flex flex-col gap-4"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Debug
          </h3>

          {/* Flow State */}
          <div>
            <dt className="text-[11px] flex items-center gap-1 mb-1" style={{ color: 'var(--text-tertiary)' }}>
              <ArrowRight size={10} /> Flow State
            </dt>
            <dd>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: currentStepStyle.bg, color: currentStepStyle.color }}
              >
                {currentStep.replace(/_/g, ' ')}
              </span>
            </dd>
          </div>

          {/* Order Data */}
          {orderData && (
            <div className="pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
              <h4 className="text-[11px] flex items-center gap-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>
                <Hash size={10} /> Order Data
              </h4>
              <div className="space-y-1">
                {Object.entries(orderData).map(([key, val]) => (
                  <div key={key} className="flex justify-between text-[10px]">
                    <span style={{ color: 'var(--text-tertiary)' }}>{key}</span>
                    <span className="font-mono truncate max-w-[140px]" style={{ color: 'var(--text-secondary)' }}>
                      {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rule Evaluation */}
          {ruleResult && (
            <div className="pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
              <h4 className="text-[11px] flex items-center gap-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>
                <Zap size={10} /> Rule Evaluation
              </h4>
              <pre className="text-[9px] font-mono p-2 rounded-lg overflow-x-auto" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                {JSON.stringify(ruleResult, null, 2)}
              </pre>
            </div>
          )}

          {/* AI Decision */}
          {aiDecision && (
            <div className="pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
              <h4 className="text-[11px] flex items-center gap-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>
                <AlertCircle size={10} /> AI Decision
              </h4>
              <pre className="text-[9px] font-mono p-2 rounded-lg overflow-x-auto" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                {JSON.stringify(aiDecision, null, 2)}
              </pre>
            </div>
          )}

          {/* Email Triggers */}
          {emailTriggers.length > 0 && (
            <div className="pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
              <h4 className="text-[11px] flex items-center gap-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>
                <Mail size={10} /> Emails Triggered
              </h4>
              <div className="flex flex-wrap gap-1">
                {emailTriggers.map((e) => (
                  <span
                    key={e}
                    className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                    style={{ backgroundColor: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}
                  >
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Settings Applied */}
          {settingsApplied && (
            <div className="pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
              <h4 className="text-[11px] flex items-center gap-1 mb-2" style={{ color: 'var(--text-tertiary)' }}>
                <Settings size={10} /> Settings Applied
              </h4>
              <div className="space-y-1">
                {Object.entries(settingsApplied).map(([key, val]) => (
                  <div key={key} className="flex justify-between text-[10px]">
                    <span style={{ color: 'var(--text-tertiary)' }}>{key.replace(/_/g, ' ')}</span>
                    <span className="font-mono truncate max-w-[120px]" style={{ color: 'var(--text-secondary)' }}>
                      {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Event Log */}
          {events.length > 0 && (
            <div className="pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
              <h4 className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Event Log ({events.length})
              </h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {events.slice().reverse().map((evt) => (
                  <div key={evt.id} className="text-[9px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{evt.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-auto pt-3" style={{ borderTop: '1px solid var(--border-secondary)' }}>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Returns portal with debug mode. Step through the return flow to see rule evaluation, AI decisions, and email triggers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
