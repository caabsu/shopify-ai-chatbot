'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, Plus, X, Trash2, Pencil, Check } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface ProductPool {
  id: string;
  name: string;
  description: string;
  profile_keys: string[];
  product_handles: string[];
  priority: number;
  enabled: boolean;
}

interface PoolFormData {
  name: string;
  description: string;
  profile_keys: string;
  product_handles: string;
  priority: number;
  enabled: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────────

const ACCENT = '#10b981';

const EMPTY_FORM: PoolFormData = {
  name: '',
  description: '',
  profile_keys: '',
  product_handles: '',
  priority: 0,
  enabled: true,
};

// ── Component ───────────────────────────────────────────────────────────────

export default function ProductPoolsPage() {
  const [pools, setPools] = useState<ProductPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingPool, setEditingPool] = useState<ProductPool | null>(null);
  const [form, setForm] = useState<PoolFormData>(EMPTY_FORM);

  const base = process.env.NEXT_PUBLIC_BACKEND_URL || '';

  const loadPools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/quiz/product-pools`);
      if (!res.ok) throw new Error(`Failed to load pools (${res.status})`);
      const data = await res.json();
      setPools(Array.isArray(data) ? data : data.pools || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load product pools');
    }
    setLoading(false);
  }, [base]);

  useEffect(() => { loadPools(); }, [loadPools]);

  function openCreate() {
    setEditingPool(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(pool: ProductPool) {
    setEditingPool(pool);
    setForm({
      name: pool.name,
      description: pool.description,
      profile_keys: pool.profile_keys.join(', '),
      product_handles: pool.product_handles.join('\n'),
      priority: pool.priority,
      enabled: pool.enabled,
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingPool(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      profile_keys: form.profile_keys
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      product_handles: form.product_handles
        .split('\n')
        .map((h) => h.trim())
        .filter(Boolean),
      priority: form.priority,
      enabled: form.enabled,
    };

    try {
      const url = editingPool
        ? `${base}/api/quiz/product-pools/${editingPool.id}`
        : `${base}/api/quiz/product-pools`;
      const method = editingPool ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Failed to save pool (${res.status})`);

      closeModal();
      await loadPools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pool');
    }
    setSaving(false);
  }

  async function handleDelete(poolId: string) {
    if (!confirm('Delete this product pool?')) return;

    try {
      const res = await fetch(`${base}/api/quiz/product-pools/${poolId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Failed to delete pool (${res.status})`);
      await loadPools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete pool');
    }
  }

  async function handleToggleEnabled(pool: ProductPool) {
    try {
      const res = await fetch(`${base}/api/quiz/product-pools/${pool.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...pool, enabled: !pool.enabled }),
      });
      if (!res.ok) throw new Error(`Failed to update pool (${res.status})`);
      await loadPools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle pool');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Package size={20} style={{ color: ACCENT }} />
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Product Pools
          </h2>
        </div>
        <button
          onClick={openCreate}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 500,
            color: '#fff',
            backgroundColor: ACCENT,
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          <Plus size={14} /> Add Pool
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            backgroundColor: 'rgba(239,68,68,0.08)',
            color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: '140px',
                borderRadius: '12px',
                backgroundColor: 'var(--bg-tertiary)',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          ))}
        </div>
      ) : pools.length === 0 ? (
        <div
          style={{
            padding: '64px 20px',
            textAlign: 'center',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '12px',
          }}
        >
          <Package size={32} style={{ color: 'var(--text-tertiary)', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)', margin: '0 0 4px' }}>
            No product pools yet
          </p>
          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', margin: 0 }}>
            Create a pool to map quiz profiles to product recommendations
          </p>
        </div>
      ) : (
        /* ── Pool Cards ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {pools.map((pool) => (
            <div
              key={pool.id}
              style={{
                padding: '20px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '12px',
                opacity: pool.enabled ? 1 : 0.6,
              }}
            >
              {/* Card header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    {pool.name}
                  </h3>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '6px',
                      backgroundColor: `rgba(107,114,128,0.1)`,
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    Priority: {pool.priority}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {/* Enable/Disable toggle */}
                  <button
                    onClick={() => handleToggleEnabled(pool)}
                    title={pool.enabled ? 'Disable' : 'Enable'}
                    style={{
                      width: '40px',
                      height: '22px',
                      borderRadius: '11px',
                      border: 'none',
                      cursor: 'pointer',
                      position: 'relative',
                      backgroundColor: pool.enabled ? ACCENT : 'var(--border-primary)',
                      transition: 'background-color 200ms ease',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: '2px',
                        left: pool.enabled ? '20px' : '2px',
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        backgroundColor: '#fff',
                        transition: 'left 200ms ease',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }}
                    />
                  </button>

                  {/* Edit */}
                  <button
                    onClick={() => openEdit(pool)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: 'var(--text-secondary)',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    <Pencil size={12} /> Edit
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(pool.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: '#ef4444',
                      backgroundColor: 'rgba(239,68,68,0.06)',
                      border: '1px solid rgba(239,68,68,0.2)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>

              {/* Description */}
              {pool.description && (
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                  {pool.description}
                </p>
              )}

              {/* Profile keys as chips */}
              <div style={{ marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Profile Keys
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                  {pool.profile_keys.length === 0 ? (
                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>None</span>
                  ) : (
                    pool.profile_keys.map((key) => (
                      <span
                        key={key}
                        style={{
                          display: 'inline-block',
                          fontSize: '11px',
                          fontWeight: 500,
                          padding: '3px 10px',
                          borderRadius: '9999px',
                          backgroundColor: `${ACCENT}1a`,
                          color: ACCENT,
                        }}
                      >
                        {key}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Product handles */}
              <div>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Products
                </span>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
                  {pool.product_handles.length === 0
                    ? 'No products'
                    : pool.product_handles.join(', ')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal ── */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '560px',
              maxHeight: '90vh',
              overflow: 'auto',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '16px',
              padding: '24px',
            }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {editingPool ? 'Edit Pool' : 'Create Pool'}
              </h3>
              <button
                onClick={closeModal}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-tertiary)',
                  backgroundColor: 'var(--bg-secondary)',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Form fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Name */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Name
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Bold Statement Pieces"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '13px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-primary)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Description */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  placeholder="Brief description of this pool..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '13px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-primary)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Profile Keys */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Profile Keys <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(comma-separated)</span>
                </label>
                <input
                  value={form.profile_keys}
                  onChange={(e) => setForm({ ...form, profile_keys: e.target.value })}
                  placeholder="bold-minimalist, edgy-classic"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '13px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-primary)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Product Handles */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Product Handles <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>(one per line)</span>
                </label>
                <textarea
                  value={form.product_handles}
                  onChange={(e) => setForm({ ...form, product_handles: e.target.value })}
                  rows={4}
                  placeholder={"classic-leather-jacket\nvintage-denim-tee\n..."}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '13px',
                    fontFamily: 'var(--font-mono, monospace)',
                    borderRadius: '8px',
                    border: '1px solid var(--border-primary)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Priority + Enabled */}
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Priority
                  </label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '13px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-primary)',
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 0',
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    style={{ accentColor: ACCENT }}
                  />
                  Enabled
                </label>
              </div>
            </div>

            {/* Modal footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
              <button
                onClick={closeModal}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#fff',
                  backgroundColor: saving || !form.name.trim() ? '#9ca3af' : ACCENT,
                  border: 'none',
                  borderRadius: '8px',
                  cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                <Check size={14} />
                {saving ? 'Saving...' : editingPool ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
