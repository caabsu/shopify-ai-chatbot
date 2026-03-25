'use client';

import { useState, useEffect } from 'react';
import { Package, Plus, Trash2, Edit2, Check, X, Ruler } from 'lucide-react';

interface LabelPreset {
  id: string;
  brand_id: string;
  sku: string;
  product_title: string | null;
  length: number;
  width: number;
  height: number;
  weight: number;
  weight_unit: string;
  dimension_unit: string;
  created_at: string;
}

const EMPTY_FORM = {
  sku: '',
  product_title: '',
  length: '',
  width: '',
  height: '',
  weight: '',
  weight_unit: 'lb',
  dimension_unit: 'in',
};

export default function LabelPresetsPage() {
  const [presets, setPresets] = useState<LabelPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingSkus, setDeletingSkus] = useState<Set<string>>(new Set());

  async function loadPresets() {
    setLoading(true);
    try {
      const res = await fetch('/api/returns/label-presets');
      const data = await res.json();
      setPresets(data.presets ?? []);
    } catch {
      setError('Failed to load label presets');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPresets();
  }, []);

  function openAddForm() {
    setForm({ ...EMPTY_FORM });
    setEditingSku(null);
    setShowForm(true);
    setError(null);
  }

  function openEditForm(preset: LabelPreset) {
    setForm({
      sku: preset.sku,
      product_title: preset.product_title ?? '',
      length: String(preset.length),
      width: String(preset.width),
      height: String(preset.height),
      weight: String(preset.weight),
      weight_unit: preset.weight_unit,
      dimension_unit: preset.dimension_unit,
    });
    setEditingSku(preset.sku);
    setShowForm(true);
    setError(null);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingSku(null);
    setForm({ ...EMPTY_FORM });
    setError(null);
  }

  async function handleSave() {
    if (!form.sku.trim()) {
      setError('SKU is required');
      return;
    }
    if (!form.length || !form.width || !form.height || !form.weight) {
      setError('All dimension and weight fields are required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/returns/label-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: form.sku.trim(),
          product_title: form.product_title.trim() || null,
          length: parseFloat(form.length),
          width: parseFloat(form.width),
          height: parseFloat(form.height),
          weight: parseFloat(form.weight),
          weight_unit: form.weight_unit,
          dimension_unit: form.dimension_unit,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? 'Failed to save preset');
        return;
      }

      await loadPresets();
      cancelForm();
    } catch {
      setError('Failed to save preset');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(sku: string) {
    if (!confirm(`Delete preset for SKU "${sku}"?`)) return;

    setDeletingSkus((prev) => new Set(prev).add(sku));
    try {
      const res = await fetch(`/api/returns/label-presets/${encodeURIComponent(sku)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setPresets((prev) => prev.filter((p) => p.sku !== sku));
      } else {
        const d = await res.json();
        setError(d.error ?? 'Failed to delete preset');
      }
    } catch {
      setError('Failed to delete preset');
    } finally {
      setDeletingSkus((prev) => {
        const next = new Set(prev);
        next.delete(sku);
        return next;
      });
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Ruler size={18} />
            Label Presets
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Define package dimensions per SKU for automatic return label generation.
          </p>
        </div>
        <button
          onClick={openAddForm}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium text-white"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          <Plus size={12} /> Add Preset
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="rounded-xl p-3 flex items-center justify-between gap-2"
          style={{
            backgroundColor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          <span className="text-sm" style={{ color: '#ef4444' }}>{error}</span>
          <button onClick={() => setError(null)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Add / Edit Form */}
      {showForm && (
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            {editingSku ? `Edit Preset — ${editingSku}` : 'New Label Preset'}
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                SKU <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                disabled={!!editingSku}
                placeholder="e.g. PROD-001"
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                Product Title
              </label>
              <input
                type="text"
                value={form.product_title}
                onChange={(e) => setForm((f) => ({ ...f, product_title: e.target.value }))}
                placeholder="e.g. Adventure Headlamp Pro"
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
              Dimensions (L x W x H) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.length}
                onChange={(e) => setForm((f) => ({ ...f, length: e.target.value }))}
                placeholder="Length"
                className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
              <span style={{ color: 'var(--text-tertiary)' }}>x</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.width}
                onChange={(e) => setForm((f) => ({ ...f, width: e.target.value }))}
                placeholder="Width"
                className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
              <span style={{ color: 'var(--text-tertiary)' }}>x</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.height}
                onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))}
                placeholder="Height"
                className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
              <select
                value={form.dimension_unit}
                onChange={(e) => setForm((f) => ({ ...f, dimension_unit: e.target.value }))}
                className="text-sm rounded-lg px-2 py-2 focus:outline-none"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="in">in</option>
                <option value="cm">cm</option>
              </select>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                Weight <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.weight}
                  onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
                  placeholder="0.00"
                  className="flex-1 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                />
                <select
                  value={form.weight_unit}
                  onChange={(e) => setForm((f) => ({ ...f, weight_unit: e.target.value }))}
                  className="text-sm rounded-lg px-2 py-2 focus:outline-none"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="lb">lb</option>
                  <option value="oz">oz</option>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              onClick={cancelForm}
              className="text-xs px-4 py-2 rounded-lg font-medium"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {saving ? 'Saving...' : <><Check size={12} /> {editingSku ? 'Update' : 'Create'} Preset</>}
            </button>
          </div>
        </div>
      )}

      {/* Presets Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-pulse space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
              ))}
            </div>
          </div>
        ) : presets.length === 0 ? (
          <div className="p-12 text-center">
            <Package size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No label presets yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Add a preset to auto-populate dimensions when creating return labels for a SKU.
            </p>
            <button
              onClick={openAddForm}
              className="mt-4 text-xs px-4 py-2 rounded-lg font-medium text-white"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              Add First Preset
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>SKU</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Dimensions (L x W x H)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Weight</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {presets.map((preset, i) => (
                <tr
                  key={preset.id}
                  style={{
                    borderBottom: i < presets.length - 1 ? '1px solid var(--border-secondary)' : 'none',
                  }}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-medium px-2 py-1 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
                      {preset.sku}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {preset.product_title ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {preset.length} x {preset.width} x {preset.height} {preset.dimension_unit}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      {preset.weight} {preset.weight_unit}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEditForm(preset)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                        style={{
                          backgroundColor: 'var(--bg-secondary)',
                          border: '1px solid var(--border-secondary)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <Edit2 size={11} /> Edit
                      </button>
                      <button
                        onClick={() => handleDelete(preset.sku)}
                        disabled={deletingSkus.has(preset.sku)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        style={{
                          backgroundColor: 'rgba(239,68,68,0.08)',
                          border: '1px solid rgba(239,68,68,0.2)',
                          color: '#ef4444',
                        }}
                      >
                        <Trash2 size={11} /> {deletingSkus.has(preset.sku) ? '...' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
