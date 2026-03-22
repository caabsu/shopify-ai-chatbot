'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, RefreshCw, Star, Loader2 } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface Product {
  id: string;
  shopify_product_id: string;
  title: string;
  handle: string;
  featured_image_url: string | null;
  status: string;
  review_count: number;
  average_rating: number;
  created_at: string;
}

function Stars({ rating, size = 12 }: { rating: number | null; size?: number }) {
  if (rating === null || rating === 0) {
    return <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>No reviews</span>;
  }
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            size={size}
            fill={i <= Math.round(rating) ? '#f59e0b' : 'none'}
            stroke={i <= Math.round(rating) ? '#f59e0b' : 'var(--text-tertiary)'}
            strokeWidth={1.5}
          />
        ))}
      </div>
      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {rating.toFixed(1)}
      </span>
    </div>
  );
}

export default function ReviewProductsPage() {
  const { brandSlug } = useBrand();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reviews/products');
      const data = await res.json();
      setProducts(data.items ?? []);
    } catch {
      setProducts([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch('/api/reviews/products/sync', { method: 'POST' });
      await loadProducts();
    } catch {
      // ignore
    }
    setSyncing(false);
  }

  const STATUS_STYLES: Record<string, { bg: string; color: string; text: string }> = {
    active: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', text: 'Active' },
    draft: { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', text: 'Draft' },
    archived: { bg: 'rgba(107,114,128,0.12)', color: '#6b7880', text: 'Archived' },
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="h-96 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package size={20} style={{ color: 'var(--text-primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Products
          </h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {products.length} {products.length === 1 ? 'product' : 'products'}
          </span>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {syncing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Sync Now
        </button>
      </div>

      {/* Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {products.length === 0 ? (
          <div className="p-12 text-center">
            <Package size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              No products found
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Click &quot;Sync Now&quot; to import products from Shopify
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                <th
                  className="text-left text-[11px] font-semibold uppercase tracking-wider px-4 py-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Product
                </th>
                <th
                  className="text-left text-[11px] font-semibold uppercase tracking-wider px-4 py-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Handle
                </th>
                <th
                  className="text-center text-[11px] font-semibold uppercase tracking-wider px-4 py-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Reviews
                </th>
                <th
                  className="text-left text-[11px] font-semibold uppercase tracking-wider px-4 py-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Avg Rating
                </th>
                <th
                  className="text-center text-[11px] font-semibold uppercase tracking-wider px-4 py-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border-secondary)' }}>
              {products.map((product) => {
                const statusStyle = STATUS_STYLES[product.status] || STATUS_STYLES.draft;
                return (
                  <tr
                    key={product.id}
                    className="transition-colors cursor-pointer"
                    onClick={() => {
                      window.location.href = `/reviews?product_id=${product.id}`;
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                          style={{
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border-primary)',
                          }}
                        >
                          {product.featured_image_url ? (
                            <img
                              src={product.featured_image_url}
                              alt={product.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Package size={16} style={{ color: 'var(--text-tertiary)' }} />
                          )}
                        </div>
                        <span
                          className="text-sm font-medium truncate max-w-[240px]"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {product.title}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                        {product.handle}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {product.review_count}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Stars rating={product.average_rating} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: statusStyle.bg,
                          color: statusStyle.color,
                        }}
                      >
                        {statusStyle.text}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
