'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Users, X,
} from 'lucide-react';
import type { AgentUser } from '@/lib/types';

export default function TeamPage() {
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Form
  const [formName, setFormName] = useState('');
  const [formAgentId, setFormAgentId] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<'admin' | 'agent'>('agent');
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/agents');
    const data = await res.json();
    setAgents(data.agents ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    setFormError('');
    if (!formName || !formAgentId.trim() || !formPassword) {
      setFormError('All fields are required');
      return;
    }
    setFormSaving(true);
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formName,
        agentId: formAgentId,
        password: formPassword,
        role: formRole,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      setFormError(data.error || 'Failed to create agent');
    } else {
      setShowModal(false);
      setFormName('');
      setFormAgentId('');
      setFormPassword('');
      setFormRole('agent');
      load();
    }
    setFormSaving(false);
  }

  async function toggleActive(agent: AgentUser) {
    await fetch('/api/agents', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agent.id, is_active: !agent.is_active }),
    });
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? { ...a, is_active: !a.is_active } : a))
    );
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/settings" className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>
            <ArrowLeft size={16} />
          </Link>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Team Management</h2>
          <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>({agents.length})</span>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          <Plus size={14} /> Add Agent
        </button>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        {agents.length === 0 ? (
          <div className="p-12 text-center">
            <Users size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No team members</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Add your first support agent</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-primary)' }}>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Agent ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium"
                        style={{
                          backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                          color: 'var(--color-accent)',
                        }}
                      >
                        {agent.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{agent.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{agent.agent_id || agent.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full capitalize font-medium"
                      style={{
                        backgroundColor: agent.role === 'admin'
                          ? 'rgba(168,85,247,0.1)'
                          : 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                        color: agent.role === 'admin' ? '#a855f7' : 'var(--color-accent)',
                      }}
                    >
                      {agent.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center gap-1 text-xs"
                      style={{ color: agent.is_active ? '#22c55e' : 'var(--text-tertiary)' }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: agent.is_active ? '#22c55e' : 'var(--text-tertiary)' }}
                      />
                      {agent.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(agent)}
                      className="text-xs px-2 py-1 rounded transition-colors"
                      style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {agent.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Agent Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="w-full max-w-md rounded-xl shadow-xl p-6 space-y-4"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Add Agent</h3>
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
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Agent ID</label>
                <input
                  type="text"
                  placeholder="e.g. sebastien"
                  value={formAgentId}
                  onChange={(e) => setFormAgentId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Password</label>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Role</label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as 'admin' | 'agent')}
                  className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--color-accent)',
                  } as React.CSSProperties}
                >
                  <option value="agent">Agent</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {formError && <p className="text-xs" style={{ color: '#ef4444' }}>{formError}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm rounded-lg"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={formSaving}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                {formSaving ? 'Creating...' : 'Create Agent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
