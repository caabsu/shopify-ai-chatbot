'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Inbox,
  BarChart3,
  MessageSquare,
  TestTube,
  Brain,
  Zap,
  ToggleLeft,
  BookOpen,
  Settings,
  Paintbrush,
  Palette,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Package,
  SlidersHorizontal,
  Mail,
  Briefcase,
  FileText,
  Users,
  Star,
  Upload,
  Truck,
  Ruler,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

const navGroups: NavGroup[] = [
  {
    label: 'Main',
    items: [
      { href: '/overview', label: 'Overview', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Support',
    collapsible: true,
    defaultCollapsed: false,
    items: [
      { href: '/tickets', label: 'Ticket Inbox', icon: Inbox },
      { href: '/chatbot/conversations', label: 'AI Conversations', icon: MessageSquare },
      { href: '/knowledge', label: 'Knowledge Base', icon: BookOpen },
      { href: '/insights', label: 'Insights', icon: BarChart3 },
    ],
  },
  {
    label: 'Returns',
    collapsible: true,
    defaultCollapsed: false,
    items: [
      { href: '/returns', label: 'Requests', icon: Package },
      { href: '/returns/rma', label: 'RMA Sync', icon: Truck },
      { href: '/returns/rules', label: 'Rules', icon: SlidersHorizontal },
      { href: '/returns/label-presets', label: 'Label Presets', icon: Ruler },
      { href: '/returns/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/returns/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    label: 'Reviews',
    collapsible: true,
    defaultCollapsed: false,
    items: [
      { href: '/reviews', label: 'All Reviews', icon: Star },
      { href: '/reviews/products', label: 'Products', icon: Package },
      { href: '/reviews/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/reviews/import', label: 'Import', icon: Upload },
      { href: '/reviews/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    label: 'Order Tracking',
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { href: '/tracking/insights', label: 'Insights', icon: Search },
      { href: '/tracking/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    label: 'Trade Program',
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { href: '/trade', label: 'Overview', icon: Briefcase },
      { href: '/trade/applications', label: 'Applications', icon: FileText },
      { href: '/trade/members', label: 'Members', icon: Users },
      { href: '/trade/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    label: 'Customize',
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { href: '/chatbot/playground', label: 'Chat Playground', icon: TestTube },
      { href: '/chatbot/design', label: 'Chat Widget', icon: Palette },
      { href: '/chatbot/ai-config', label: 'AI Config', icon: Brain },
      { href: '/chatbot/capabilities', label: 'AI Capabilities', icon: Zap },
      { href: '/chatbot/features', label: 'AI Features', icon: ToggleLeft },
      { href: '/chatbot/design-agent', label: 'Design Agent', icon: Paintbrush },
      { href: '/returns/playground', label: 'Returns Portal', icon: TestTube },
      { href: '/returns/design', label: 'Returns Design', icon: Palette },
      { href: '/returns/emails', label: 'Return Emails', icon: Mail },
      { href: '/returns/label-stats', label: 'Label Stats', icon: BarChart3 },
      { href: '/reviews/playground', label: 'Review Widget', icon: TestTube },
      { href: '/reviews/design', label: 'Review Design', icon: Palette },
      { href: '/reviews/emails', label: 'Review Emails', icon: Mail },
      { href: '/tracking/playground', label: 'Tracking Widget', icon: TestTube },
      { href: '/tracking/design', label: 'Tracking Design', icon: Palette },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [openTicketCount, setOpenTicketCount] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of navGroups) {
      if (group.collapsible) {
        initial[group.label] = group.defaultCollapsed ?? false;
      }
    }
    return initial;
  });

  useEffect(() => {
    fetch('/api/tickets/stats')
      .then((r) => r.json())
      .then((data) => {
        if (data.openCount != null) setOpenTicketCount(data.openCount);
      })
      .catch(() => {});
  }, []);

  // Auto-expand a collapsed section if the current page is within it
  useEffect(() => {
    for (const group of navGroups) {
      if (group.collapsible && collapsed[group.label]) {
        const isInGroup = group.items.some(
          (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
        );
        if (isInGroup) {
          setCollapsed((prev) => ({ ...prev, [group.label]: false }));
        }
      }
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleGroup(label: string) {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  }

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
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          O
        </div>
        <div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Outlight
          </h1>
          <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            Support Hub
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-4">
        {navGroups.map((group) => {
          const isCollapsed = group.collapsible && collapsed[group.label];
          const hasActiveChild = group.items.some(
            (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
          );

          return (
            <div key={group.label}>
              {group.collapsible ? (
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-3 mb-1 group"
                  style={{ background: 'none', border: 'none', padding: '0 12px' }}
                >
                  <p
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{
                      color: hasActiveChild ? 'var(--color-accent)' : 'var(--text-tertiary)',
                    }}
                  >
                    {group.label}
                  </p>
                  {isCollapsed ? (
                    <ChevronRight
                      size={12}
                      style={{ color: 'var(--text-tertiary)' }}
                    />
                  ) : (
                    <ChevronDown
                      size={12}
                      style={{ color: 'var(--text-tertiary)' }}
                    />
                  )}
                </button>
              ) : (
                <p
                  className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{
                    color: hasActiveChild ? 'var(--color-accent)' : 'var(--text-tertiary)',
                  }}
                >
                  {group.label}
                </p>
              )}
              {!isCollapsed && (
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const couldMatch =
                      pathname === item.href || pathname.startsWith(item.href + '/');
                    // Avoid false positives: if a sibling route is a longer prefix match, defer to it
                    const active = couldMatch && !group.items.some(
                      (sibling) =>
                        sibling.href !== item.href &&
                        sibling.href.startsWith(item.href + '/') &&
                        (pathname === sibling.href || pathname.startsWith(sibling.href + '/')),
                    );
                    const showBadge = item.href === '/tickets' && openTicketCount > 0;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors'
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
                        <item.icon size={15} strokeWidth={active ? 2 : 1.5} />
                        <span className="flex-1">{item.label}</span>
                        {showBadge && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: 'var(--color-accent)' }}
                          >
                            {openTicketCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div
        className="px-4 py-3 text-[10px]"
        style={{
          borderTop: '1px solid var(--border-primary)',
          color: 'var(--text-tertiary)',
        }}
      >
        Outlight Support Hub v2.0
      </div>
    </aside>
  );
}
