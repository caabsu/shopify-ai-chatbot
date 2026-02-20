'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Save, Check, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Promotion {
  id: string;
  name: string;
  description: string;
  discountType: 'percentage' | 'fixed' | 'free_shipping' | 'other';
  discountValue: string;
  code: string;
  active: boolean;
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function formatPromotionsForAI(promotions: Promotion[]): string {
  const active = promotions.filter((p) => p.active);
  if (active.length === 0) return '';

  return active
    .map((p) => {
      const parts: string[] = [];
      parts.push(`**${p.name}**`);
      if (p.description) parts.push(p.description);

      if (p.discountType === 'percentage' && p.discountValue) {
        parts.push(`Discount: ${p.discountValue}% off`);
      } else if (p.discountType === 'fixed' && p.discountValue) {
        parts.push(`Discount: $${p.discountValue} off`);
      } else if (p.discountType === 'free_shipping') {
        parts.push('Free shipping included');
      }

      if (p.code) {
        parts.push(`Promo code: ${p.code}`);
      } else {
        parts.push('Applied automatically (no code needed)');
      }

      return parts.join('\n');
    })
    .join('\n\n');
}

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [original, setOriginal] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/ai-config');
    const data = await res.json();
    const raw = data.config?.promotions_data;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Promotion[];
        setPromotions(parsed);
        setOriginal(parsed);
      } catch {
        setPromotions([]);
        setOriginal([]);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function addPromotion() {
    setPromotions([
      ...promotions,
      {
        id: generateId(),
        name: '',
        description: '',
        discountType: 'percentage',
        discountValue: '',
        code: '',
        active: true,
      },
    ]);
  }

  function updatePromotion(id: string, updates: Partial<Promotion>) {
    setPromotions(promotions.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }

  function removePromotion(id: string) {
    setPromotions(promotions.filter((p) => p.id !== id));
  }

  function toggleActive(id: string) {
    setPromotions(promotions.map((p) => (p.id === id ? { ...p, active: !p.active } : p)));
  }

  const hasChanges = JSON.stringify(promotions) !== JSON.stringify(original);

  async function handleSave() {
    setSaving(true);

    // Save structured data for the admin page
    await fetch('/api/ai-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'promotions_data', value: JSON.stringify(promotions) }),
    });

    // Save formatted text for the AI agent
    await fetch('/api/ai-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'promotions', value: formatPromotionsForAI(promotions) }),
    });

    setOriginal([...promotions]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const activeCount = promotions.filter((p) => p.active).length;

  if (loading) return <div className="animate-pulse"><div className="h-64 bg-gray-200 rounded-xl" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Promotions</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage active promotions and discount codes. The AI agent uses this as its only source of truth for promotions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">Unsaved changes</span>}
          <button
            onClick={handleSave}
            disabled={!hasChanges && !saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving...' : <><Save size={14} /> Save All</>}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3 text-sm">
          <Tag size={16} className="text-gray-400" />
          <span className="text-gray-600">
            {promotions.length === 0
              ? 'No promotions configured. The AI will tell customers there are no active promotions.'
              : `${activeCount} active promotion${activeCount !== 1 ? 's' : ''} out of ${promotions.length} total`}
          </span>
        </div>
      </div>

      {/* AI Preview */}
      {activeCount > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">AI Agent Will See</h3>
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 rounded-lg p-3">
            {formatPromotionsForAI(promotions) || '(no active promotions)'}
          </pre>
        </div>
      )}

      {/* Promotions List */}
      <div className="space-y-3">
        {promotions.map((promo) => (
          <div key={promo.id} className={cn(
            'bg-white rounded-xl border p-5 space-y-4 transition-colors',
            promo.active ? 'border-gray-200' : 'border-gray-100 opacity-60'
          )}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleActive(promo.id)}
                  className="focus:outline-none"
                  title={promo.active ? 'Deactivate' : 'Activate'}
                >
                  <div className={cn('w-9 h-5 rounded-full transition-colors relative', promo.active ? 'bg-black' : 'bg-gray-300')}>
                    <div className={cn('w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-transform', promo.active ? 'left-[18px]' : 'left-[3px]')} />
                  </div>
                </button>
                <span className={cn('text-xs px-1.5 py-0.5 rounded', promo.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                  {promo.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <button
                onClick={() => removePromotion(promo.id)}
                className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                title="Remove promotion"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Promotion Name</label>
                <input
                  value={promo.name}
                  onChange={(e) => updatePromotion(promo.id, { name: e.target.value })}
                  placeholder="e.g., Summer Sale"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Promo Code</label>
                <input
                  value={promo.code}
                  onChange={(e) => updatePromotion(promo.id, { code: e.target.value.toUpperCase() })}
                  placeholder="e.g., SUMMER20 (leave empty if auto-applied)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                value={promo.description}
                onChange={(e) => updatePromotion(promo.id, { description: e.target.value })}
                placeholder="e.g., 20% off all orders over $100"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Discount Type</label>
                <select
                  value={promo.discountType}
                  onChange={(e) => updatePromotion(promo.id, { discountType: e.target.value as Promotion['discountType'] })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black bg-white"
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed Amount ($)</option>
                  <option value="free_shipping">Free Shipping</option>
                  <option value="other">Other</option>
                </select>
              </div>
              {(promo.discountType === 'percentage' || promo.discountType === 'fixed') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {promo.discountType === 'percentage' ? 'Percentage' : 'Amount ($)'}
                  </label>
                  <input
                    type="number"
                    value={promo.discountValue}
                    onChange={(e) => updatePromotion(promo.id, { discountValue: e.target.value })}
                    placeholder={promo.discountType === 'percentage' ? 'e.g., 20' : 'e.g., 15'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addPromotion}
        className="flex items-center gap-1.5 px-4 py-2.5 text-sm border border-dashed border-gray-300 rounded-xl hover:border-gray-400 hover:bg-gray-50 w-full justify-center text-gray-500 hover:text-black transition-colors"
      >
        <Plus size={14} /> Add Promotion
      </button>
    </div>
  );
}
