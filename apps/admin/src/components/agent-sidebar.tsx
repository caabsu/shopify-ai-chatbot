'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Inbox, Headphones } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Inbox;
  badge?: number;
}

export function AgentSidebar({ userName }: { userName?: string }) {
  const pathname = usePathname();
  const [openTicketCount, setOpenTicketCount] = useState(0);

  useEffect(() => {
    fetch('/api/tickets/stats')
      .then((r) => r.json())
      .then((data) => {
        if (data.openCount != null) setOpenTicketCount(data.openCount);
      })
      .catch(() => {});
  }, []);

  const navItems: NavItem[] = [
    { href: '/agent/tickets', label: 'Ticket Inbox', icon: Inbox, badge: openTicketCount || undefined },
  ];

  return (
    <aside
      className="w-56 flex flex-col h-screen fixed left-0 top-0 z-20"
      style={{
        backgroundColor: 'var(--bg-primary)',
        borderRight: '1px solid var(--border-primary)',
      }}
    >
      {/* Brand */}
      <div
        className="px-4 py-5 flex items-center gap-2.5"
        style={{ borderBottom: '1px solid var(--border-primary)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          <Headphones size={16} className="text-white" />
        </div>
        <div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Support Hub
          </h1>
          <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Agent Workspace
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-5">
        <div>
          <p
            className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Support
          </p>
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors'
                  )}
                  style={{
                    backgroundColor: active ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
                    color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
                    fontWeight: active ? 500 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }
                  }}
                >
                  <item.icon size={16} strokeWidth={active ? 2 : 1.5} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && item.badge > 0 && (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: 'var(--color-accent)' }}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Bottom */}
      <div
        className="px-4 py-3"
        style={{
          borderTop: '1px solid var(--border-primary)',
          color: 'var(--text-tertiary)',
        }}
      >
        {userName && (
          <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-secondary)' }}>
            {userName}
          </p>
        )}
        <p className="text-[10px]">Agent Workspace</p>
      </div>
    </aside>
  );
}
