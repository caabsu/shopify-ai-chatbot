'use client';

import { useState, useEffect } from 'react';
import type { FeatureToggle } from '@/lib/types';

const toolDescriptions: Record<string, string> = {
  search_products: 'Search the store product catalog',
  get_product_details: 'Get detailed product information',
  answer_store_policy: 'Answer store policy questions',
  lookup_order: 'Look up customer orders',
  check_return_eligibility: 'Check return eligibility for orders',
  initiate_return: 'Submit return requests',
  search_knowledge_base: 'Search internal knowledge base',
  manage_cart: 'Create and manage shopping carts',
  get_cart: 'Retrieve cart contents',
  navigate_customer: 'Suggest pages to visit',
  escalate_to_human: 'Escalate to human agent',
};

export default function ChatbotFeaturesPage() {
  const [toggles, setToggles] = useState<FeatureToggle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/feature-toggles')
      .then((r) => r.json())
      .then((data) => setToggles(data.toggles ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(featureKey: string, currentEnabled: boolean) {
    setToggles((prev) =>
      prev.map((t) => (t.feature_key === featureKey ? { ...t, enabled: !currentEnabled } : t))
    );

    const res = await fetch('/api/feature-toggles', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_key: featureKey, enabled: !currentEnabled }),
    });

    if (!res.ok) {
      setToggles((prev) =>
        prev.map((t) => (t.feature_key === featureKey ? { ...t, enabled: currentEnabled } : t))
      );
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Feature Toggles</h2>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Enable or disable individual AI tools for your chatbot.
      </p>

      <div
        className="rounded-xl divide-y"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          borderColor: 'var(--border-primary)',
        }}
      >
        {toggles.map((t) => (
          <div
            key={t.feature_key}
            className="flex items-center justify-between px-5 py-4"
            style={{ borderColor: 'var(--border-secondary)' }}
          >
            <div>
              <h4 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t.feature_key}</h4>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {toolDescriptions[t.feature_key] || ''}
              </p>
            </div>
            <button
              onClick={() => handleToggle(t.feature_key, t.enabled)}
              className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0"
              style={{
                backgroundColor: t.enabled ? 'var(--color-accent)' : 'var(--border-primary)',
              }}
            >
              <div
                className="w-4 h-4 bg-white rounded-full absolute top-1 transition-transform"
                style={{ left: t.enabled ? '20px' : '4px' }}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
