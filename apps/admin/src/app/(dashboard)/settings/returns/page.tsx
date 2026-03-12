'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Pencil, Trash2, Save, Check, X } from 'lucide-react';
import type { ReturnRule } from '@/lib/types';

const ACTION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  auto_approve: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', label: 'Auto Approve' },
  auto_deny: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', label: 'Auto Deny' },
  flag_review: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', label: 'Flag for Review' },
  ai_review: { bg: 'rgba(168,85,247,0.12)', text: '#a855f7', label: 'AI Review' },
};

const REASON_OPTIONS = [
  { value: '', label: 'Any reason' },
  { value: 'defective', label: 'Defective' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'changed_mind', label: 'Changed mind' },
  { value: 'too_small', label: 'Too small' },
  { value: 'too_large', label: 'Too large' },
  { value: 'arrived_late', label: 'Arrived late' },
  { value: 'other', label: 'Other' },
];

interface RuleForm {
  name: string;
  reason: string;
  max_amount: string;
  max_order_age_days: string;
  action: string;
  resolution_type: string;
  priority: string;
}

const emptyForm: RuleForm = {
  name: '',
  reason: '',
  max_amount: '',
  max_order_age_days: '',
  action: 'ai_review',
  resolution_type: '',
  priority: '0',
};

function conditionsToText(conditions: Record<string, unknown>): string {
  const parts: string[] = [];
  if (conditions.reason) parts.push(`Reason: ${String(conditions.reason).replace(/_/g, ' ')}`);
  if (conditions.max_amount) parts.push(`Max $${conditions.max_amount}`);
  if (conditions.max_order_age_days) parts.push(`Within ${conditions.max_order_age_days} days`);
  return parts.length > 0 ? parts.join(' | ') : 'No conditions';
}

export default function ReturnRulesPage() {
  const [rules, setRules] = useState<ReturnRule[]>([]);
  const [loading, setLoading] = useState(true);

  // Add/Edit form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadRules();
  }, []);

  async function loadRules() {
    setLoading(true);
    try {
      const res = await fetch('/api/returns/rules');
      const data = await res.json();
      setRules(data.rules ?? []);
    } catch {
      // ignore
    }
    setLoading(false);
  }

  function openAddForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  }

  function openEditForm(rule: ReturnRule) {
    setForm({
      name: rule.name,
      reason: (rule.conditions?.reason as string) || '',
      max_amount: rule.conditions?.max_amount ? String(rule.conditions.max_amount) : '',
      max_order_age_days: rule.conditions?.max_order_age_days ? String(rule.conditions.max_order_age_days) : '',
      action: rule.action,
      resolution_type: rule.resolution_type || '',
      priority: String(rule.priority),
    });
    setEditingId(rule.id);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.action) return;
    setSaving(true);

    const conditions: Record<string, unknown> = {};
    if (form.reason) conditions.reason = form.reason;
    if (form.max_amount) conditions.max_amount = parseFloat(form.max_amount);
    if (form.max_order_age_days) conditions.max_order_age_days = parseInt(form.max_order_age_days);

    const body = {
      name: form.name,
      conditions,
      action: form.action,
      resolution_type: form.action === 'auto_approve' && form.resolution_type ? form.resolution_type : null,
      priority: parseInt(form.priority) || 0,
    };

    try {
      if (editingId) {
        await fetch(`/api/returns/rules/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetch('/api/returns/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      await loadRules();
      cancelForm();
    } catch {
      // ignore
    }
    setSaving(false);
  }

  async function toggleEnabled(rule: ReturnRule) {
    await fetch(`/api/returns/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    await loadRules();
  }

  async function deleteRule(ruleId: string) {
    await fetch(`/api/returns/rules/${ruleId}`, { method: 'DELETE' });
    setDeletingId(null);
    await loadRules();
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-40 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings" className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>
            <ArrowLeft size={16} />
          </Link>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Return Rules</h2>
        </div>
        <button
          onClick={openAddForm}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          <Plus size={14} /> Add Rule
        </button>
      </div>

      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Define rules to automatically handle return requests based on conditions.
      </p>

      {/* Add/Edit Form */}
      {showForm && (
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            {editingId ? 'Edit Rule' : 'New Rule'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Rule Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Auto-approve defective items"
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
            </div>

            {/* Action */}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Action
              </label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              >
                <option value="auto_approve">Auto Approve</option>
                <option value="auto_deny">Auto Deny</option>
                <option value="flag_review">Flag for Review</option>
                <option value="ai_review">AI Review</option>
              </select>
            </div>

            {/* Reason */}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Reason (condition)
              </label>
              <select
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              >
                {REASON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Max amount */}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Max Amount ($, optional)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.max_amount}
                onChange={(e) => setForm({ ...form, max_amount: e.target.value })}
                placeholder="e.g., 50.00"
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
            </div>

            {/* Max order age */}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Max Order Age (days, optional)
              </label>
              <input
                type="number"
                value={form.max_order_age_days}
                onChange={(e) => setForm({ ...form, max_order_age_days: e.target.value })}
                placeholder="e.g., 30"
                className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-accent)',
                } as React.CSSProperties}
              />
            </div>

            {/* Resolution type (only for auto_approve) */}
            {form.action === 'auto_approve' && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                  Resolution Type
                </label>
                <select
                  value={form.resolution_type}
                  onChange={(e) => setForm({ ...form, resolution_type: e.target.value })}
                  className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                >
                  <option value="">Select...</option>
                  <option value="refund">Refund</option>
                  <option value="store_credit">Store Credit</option>
                  <option value="exchange">Exchange</option>
                </select>
              </div>
            )}

            {/* Priority */}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                Priority (lower = higher priority)
              </label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
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

          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              onClick={cancelForm}
              className="text-xs px-4 py-2 rounded-lg font-medium transition-colors"
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
              disabled={saving || !form.name.trim()}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              <Save size={12} /> {saving ? 'Saving...' : editingId ? 'Update Rule' : 'Create Rule'}
            </button>
          </div>
        </div>
      )}

      {/* Rules List */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        {rules.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No return rules configured</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Add a rule to automatically handle return requests
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border-secondary)' }}>
            {rules.map((rule) => {
              const actionStyle = ACTION_STYLES[rule.action] || ACTION_STYLES.flag_review;

              return (
                <div
                  key={rule.id}
                  className="px-4 py-3"
                  style={{
                    opacity: rule.enabled ? 1 : 0.5,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {rule.name}
                        </span>
                        <span
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: actionStyle.bg,
                            color: actionStyle.text,
                          }}
                        >
                          {actionStyle.label}
                        </span>
                        {rule.resolution_type && (
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded capitalize"
                            style={{
                              backgroundColor: 'rgba(59,130,246,0.10)',
                              color: '#3b82f6',
                            }}
                          >
                            {rule.resolution_type.replace(/_/g, ' ')}
                          </span>
                        )}
                        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                          Priority: {rule.priority}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {conditionsToText(rule.conditions)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Enabled toggle */}
                      <button
                        onClick={() => toggleEnabled(rule)}
                        className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0"
                        style={{
                          backgroundColor: rule.enabled ? 'var(--color-accent)' : 'var(--border-primary)',
                        }}
                      >
                        <div
                          className="w-4 h-4 bg-white rounded-full absolute top-1 transition-transform"
                          style={{ left: rule.enabled ? '20px' : '4px' }}
                        />
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => openEditForm(rule)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--text-tertiary)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                      >
                        <Pencil size={13} />
                      </button>

                      {/* Delete */}
                      {deletingId === rule.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: '#ef4444' }}
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingId(rule.id)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: 'var(--text-tertiary)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = '#ef4444'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
