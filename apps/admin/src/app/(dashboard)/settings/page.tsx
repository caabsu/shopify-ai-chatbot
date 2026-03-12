'use client';

import Link from 'next/link';
import { Building2, Clock, MessageSquareText, Users, ChevronRight } from 'lucide-react';

const sections = [
  {
    href: '/settings/general',
    icon: Building2,
    label: 'General',
    description: 'Brand information, business hours, and basic configuration',
  },
  {
    href: '/settings/sla',
    icon: Clock,
    label: 'SLA Rules',
    description: 'Configure first response and resolution targets by priority',
  },
  {
    href: '/settings/canned-responses',
    icon: MessageSquareText,
    label: 'Canned Responses',
    description: 'Manage pre-written reply templates for common scenarios',
  },
  {
    href: '/settings/team',
    icon: Users,
    label: 'Team Management',
    description: 'Add and manage support agents, roles, and permissions',
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Settings</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-xl p-5 transition-colors group"
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-sm)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-primary)';
            }}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                  }}
                >
                  <section.icon size={18} style={{ color: 'var(--color-accent)' }} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {section.label}
                  </h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {section.description}
                  </p>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
