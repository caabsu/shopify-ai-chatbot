'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Pencil, Trash2, X, Save, MessageSquareText,
} from 'lucide-react';
import type { CannedResponse } from '@/lib/types';

export default function CannedResponsesPage() {
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CannedResponse | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formVariables, setFormVariables] = useState('');
  const [formSaving, setFormSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/canned-responses');
    const data = await res.json();
    setResponses(data.responses ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormCategory('');
    setFormContent('');
    setFormVariables('');
    setShowModal(true);
  }

  function openEdit(cr: CannedResponse) {
    setEditing(cr);
    setFormName(cr.name);
    setFormCategory(cr.category);
    setFormContent(cr.content);
    setFormVariables(cr.variables.join(', '));
    setShowModal(true);
  }

  async function handleSave() {
    setFormSaving(true);
    const body = {
      name: formName,
      category: formCategory,
      content: formContent,
      variables: formVariables.split(',').map((v) => v.trim()).filter(Boolean),
    };

    if (editing) {
      await fetch(`/api/settings/canned-responses/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      await fetch('/api/settings/canned-responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    setFormSaving(false);
    setShowModal(false);
    load();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/settings/canned-responses/${id}`, { method: 'DELETE' });
    setDeleteConfirm(null);
    load();
  }

  // Group by category
  const grouped = responses.reduce<Record<string, CannedResponse[]>>((acc, cr) => {
    const cat = cr.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(cr);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-60 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings" className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>
            <ArrowLeft size={16} />
          </Link>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Canned Responses</h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>({responses.length})</span>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          <Plus size={14} /> New Response
        </button>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div
          className="rounded-xl p-12 text-center"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <MessageSquareText size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No canned responses yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Create your first response template</p>
        </div>
      ) : (
        Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--text-tertiary)' }}>
              {category}
            </h3>
            <div
              className="rounded-xl overflow-hidden divide-y"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderColor: 'var(--border-primary)',
              }}
            >
              {items.map((cr) => (
                <div
                  key={cr.id}
                  className="px-4 py-3 flex items-start justify-between gap-3"
                  style={{ borderColor: 'var(--border-secondary)' }}
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{cr.name}</h4>
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                      {cr.content}
                    </p>
                    {cr.variables.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {cr.variables.map((v) => (
                          <span
                            key={v}
                            className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                            style={{
                              backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                              color: 'var(--color-accent)',
                            }}
                          >
                            {`{{${v}}}`}
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="text-[10px] mt-1 block" style={{ color: 'var(--text-tertiary)' }}>
                      Used {cr.usage_count} times
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(cr)}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: 'var(--text-tertiary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <Pencil size={13} />
                    </button>
                    {deleteConfirm === cr.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(cr.id)}
                          className="text-[10px] px-2 py-1 rounded text-white"
                          style={{ backgroundColor: '#ef4444' }}
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-[10px] px-2 py-1 rounded"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(cr.id)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--text-tertiary)' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                          e.currentTarget.style.color = '#ef4444';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.color = 'var(--text-tertiary)';
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="w-full max-w-lg rounded-xl shadow-xl p-6 space-y-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editing ? 'Edit Response' : 'New Canned Response'}
              </h3>
              <button onClick={() => setShowModal(false)} style={{ color: 'var(--text-tertiary)' }}>
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Name</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                  placeholder="e.g. Shipping Delay Apology"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Category</label>
                <input
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                  placeholder="e.g. Shipping"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Content</label>
                <textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 text-sm rounded-lg resize-y focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                  placeholder="Hi {{customer_name}}, I apologize for the delay..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Variables (comma-separated)
                </label>
                <input
                  value={formVariables}
                  onChange={(e) => setFormVariables(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                  placeholder="customer_name, order_number"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm rounded-lg transition-colors"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formName || !formContent || formSaving}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                {formSaving ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
