'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
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

export default function FeaturesPage() {
  const [toggles, setToggles] = useState<FeatureToggle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/feature-toggles')
      .then((r) => r.json())
      .then((data) => setToggles(data.toggles ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(featureKey: string, currentEnabled: boolean) {
    // Optimistic update
    setToggles((prev) =>
      prev.map((t) => (t.feature_key === featureKey ? { ...t, enabled: !currentEnabled } : t))
    );

    const res = await fetch('/api/feature-toggles', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_key: featureKey, enabled: !currentEnabled }),
    });

    if (!res.ok) {
      // Revert
      setToggles((prev) =>
        prev.map((t) => (t.feature_key === featureKey ? { ...t, enabled: currentEnabled } : t))
      );
    }
  }

  if (loading) return <div className="animate-pulse"><div className="h-64 bg-gray-200 rounded-xl" /></div>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Feature Toggles</h2>
      <p className="text-sm text-gray-500">Enable or disable individual AI tools for your chatbot.</p>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {toggles.map((t) => (
          <div key={t.feature_key} className="flex items-center justify-between px-5 py-4">
            <div>
              <h4 className="text-sm font-medium">{t.feature_key}</h4>
              <p className="text-xs text-gray-500 mt-0.5">{toolDescriptions[t.feature_key] || ''}</p>
            </div>
            <button
              onClick={() => handleToggle(t.feature_key, t.enabled)}
              className={cn(
                'w-10 h-6 rounded-full transition-colors relative flex-shrink-0',
                t.enabled ? 'bg-black' : 'bg-gray-300'
              )}
            >
              <div className={cn(
                'w-4 h-4 bg-white rounded-full absolute top-1 transition-transform',
                t.enabled ? 'left-5' : 'left-1'
              )} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
