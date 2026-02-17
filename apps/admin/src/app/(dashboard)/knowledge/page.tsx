'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KnowledgeDocument } from '@/lib/types';

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeDocument | null>(null);
  const [form, setForm] = useState({ title: '', content: '', category: '', priority: 0, enabled: true });

  const load = useCallback(async () => {
    const res = await fetch('/api/knowledge');
    const data = await res.json();
    setDocuments(data.documents ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ title: '', content: '', category: '', priority: 0, enabled: true });
    setDialogOpen(true);
  }

  function openEdit(doc: KnowledgeDocument) {
    setEditing(doc);
    setForm({ title: doc.title, content: doc.content, category: doc.category, priority: doc.priority, enabled: doc.enabled });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (editing) {
      await fetch(`/api/knowledge/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    } else {
      await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    }
    setDialogOpen(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this document?')) return;
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    load();
  }

  async function toggleEnabled(doc: KnowledgeDocument) {
    await fetch(`/api/knowledge/${doc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...doc, enabled: !doc.enabled }),
    });
    load();
  }

  const categories = [...new Set(documents.map((d) => d.category))].sort();

  if (loading) return <div className="animate-pulse"><div className="h-64 bg-gray-200 rounded-xl" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Knowledge Base ({documents.length})</h2>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800"
        >
          <Plus size={14} /> Add Document
        </button>
      </div>

      {categories.map((cat) => (
        <div key={cat} className="space-y-2">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">{cat}</h3>
          <div className="space-y-2">
            {documents.filter((d) => d.category === cat).map((doc) => (
              <div key={doc.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium">{doc.title}</h4>
                      <span className={cn(
                        'text-xs px-1.5 py-0.5 rounded',
                        doc.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      )}>
                        {doc.enabled ? 'Active' : 'Disabled'}
                      </span>
                      <span className="text-xs text-gray-400">Priority: {doc.priority}</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1 line-clamp-2">{doc.content}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => toggleEnabled(doc)} className="p-1.5 text-gray-400 hover:text-black rounded">
                      <div className={cn('w-8 h-5 rounded-full transition-colors relative', doc.enabled ? 'bg-black' : 'bg-gray-300')}>
                        <div className={cn('w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-transform', doc.enabled ? 'left-4' : 'left-0.5')} />
                      </div>
                    </button>
                    <button onClick={() => openEdit(doc)} className="p-1.5 text-gray-400 hover:text-black rounded">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(doc.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDialogOpen(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">{editing ? 'Edit Document' : 'New Document'}</h3>
              <button onClick={() => setDialogOpen(false)} className="text-gray-400 hover:text-black"><X size={18} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="e.g., shipping, returns, faq"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={8}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black resize-y"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                      className="rounded"
                    />
                    Enabled
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setDialogOpen(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} className="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
