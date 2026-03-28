'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { useTheme } from './theme-provider';
import { useBrand } from './brand-context';
import {
  LayoutDashboard,
  Headphones,
  RotateCcw,
  Star,
  Truck,
  Briefcase,
  Settings,
  Sun,
  Moon,
  LogOut,
  ChevronDown,
  Inbox,
  MessageSquare,
  BookOpen,
  BarChart3,
  SlidersHorizontal,
  Ruler,
  Mail,
  Package,
  Upload,
  FileText,
  Users,
  Search,
  TestTube,
  Palette,
  Brain,
  Zap,
  ToggleLeft,
  Paintbrush,
  Shield,
  User,
  Wrench,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: typeof Inbox;
  badge?: boolean;
}

interface Module {
  id: string;
  label: string;
  icon: typeof Inbox;
  color: string;
  href?: string;
  basePaths?: string[];
  items?: NavItem[];
  configItems?: NavItem[];
}

// ── Module definitions ────────────────────────────────────────────────────────

const modules: Module[] = [
  {
    id: 'overview',
    label: 'Home',
    icon: LayoutDashboard,
    color: '#6366f1',
    href: '/overview',
  },
  {
    id: 'support',
    label: 'Support',
    icon: Headphones,
    color: '#6366f1',
    basePaths: ['/tickets', '/chatbot', '/knowledge', '/insights'],
    items: [
      { href: '/tickets', label: 'Tickets', icon: Inbox, badge: true },
      { href: '/chatbot/conversations', label: 'Conversations', icon: MessageSquare },
      { href: '/knowledge', label: 'Knowledge', icon: BookOpen },
      { href: '/insights', label: 'Insights', icon: BarChart3 },
    ],
    configItems: [
      { href: '/chatbot/playground', label: 'Chat Playground', icon: TestTube },
      { href: '/chatbot/design', label: 'Widget Design', icon: Palette },
      { href: '/chatbot/ai-config', label: 'AI Config', icon: Brain },
      { href: '/chatbot/capabilities', label: 'Capabilities', icon: Zap },
      { href: '/chatbot/features', label: 'Features', icon: ToggleLeft },
      { href: '/chatbot/design-agent', label: 'Design Agent', icon: Paintbrush },
    ],
  },
  {
    id: 'returns',
    label: 'Returns',
    icon: RotateCcw,
    color: '#f59e0b',
    basePaths: ['/returns'],
    items: [
      { href: '/returns', label: 'Requests', icon: Inbox },
      { href: '/returns/rma', label: 'RMA Sync', icon: Truck },
      { href: '/returns/rules', label: 'Rules', icon: SlidersHorizontal },
      { href: '/returns/label-presets', label: 'Presets', icon: Ruler },
      { href: '/returns/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/returns/emails', label: 'Emails', icon: Mail },
    ],
    configItems: [
      { href: '/returns/playground', label: 'Portal Preview', icon: TestTube },
      { href: '/returns/design', label: 'Portal Design', icon: Palette },
      { href: '/returns/label-stats', label: 'Label Stats', icon: BarChart3 },
      { href: '/returns/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    id: 'reviews',
    label: 'Reviews',
    icon: Star,
    color: '#eab308',
    basePaths: ['/reviews'],
    items: [
      { href: '/reviews', label: 'Reviews', icon: Star },
      { href: '/reviews/products', label: 'Products', icon: Package },
      { href: '/reviews/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/reviews/import', label: 'Import', icon: Upload },
      { href: '/reviews/emails', label: 'Emails', icon: Mail },
    ],
    configItems: [
      { href: '/reviews/playground', label: 'Widget Preview', icon: TestTube },
      { href: '/reviews/design', label: 'Widget Design', icon: Palette },
      { href: '/reviews/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    id: 'tracking',
    label: 'Tracking',
    icon: Truck,
    color: '#3b82f6',
    basePaths: ['/tracking'],
    items: [
      { href: '/tracking/insights', label: 'Insights', icon: Search },
    ],
    configItems: [
      { href: '/tracking/playground', label: 'Widget Preview', icon: TestTube },
      { href: '/tracking/design', label: 'Widget Design', icon: Palette },
      { href: '/tracking/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    id: 'trade',
    label: 'Trade',
    icon: Briefcase,
    color: '#a855f7',
    basePaths: ['/trade'],
    items: [
      { href: '/trade', label: 'Overview', icon: Briefcase },
      { href: '/trade/applications', label: 'Applications', icon: FileText },
      { href: '/trade/members', label: 'Members', icon: Users },
    ],
    configItems: [
      { href: '/trade/settings', label: 'Settings', icon: Settings },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function getActiveModule(pathname: string): Module | undefined {
  // Exact href match first
  for (const mod of modules) {
    if (mod.href && pathname === mod.href) return mod;
  }
  // basePaths match
  for (const mod of modules) {
    if (mod.basePaths?.some((p) => pathname === p || pathname.startsWith(p + '/'))) return mod;
  }
  // Item match
  for (const mod of modules) {
    const all = [...(mod.items ?? []), ...(mod.configItems ?? [])];
    if (all.some((item) => pathname === item.href || pathname.startsWith(item.href + '/'))) {
      return mod;
    }
  }
  return undefined;
}

function isItemActive(pathname: string, item: NavItem, allItems: NavItem[]): boolean {
  const couldMatch = pathname === item.href || pathname.startsWith(item.href + '/');
  if (!couldMatch) return false;
  return !allItems.some(
    (sibling) =>
      sibling.href !== item.href &&
      sibling.href.startsWith(item.href + '/') &&
      (pathname === sibling.href || pathname.startsWith(sibling.href + '/')),
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const brand = useBrand();
  const [ticketCount, setTicketCount] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const configRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const activeModule = getActiveModule(pathname);
  const moduleColor = activeModule?.color ?? '#6366f1';
  const allSubItems = [...(activeModule?.items ?? []), ...(activeModule?.configItems ?? [])];
  const hasSubNav = activeModule && activeModule.id !== 'overview' && !pathname.startsWith('/settings');

  // Active config item detection (for highlighting "Configure" button)
  const configItemActive = activeModule?.configItems?.some((item) =>
    isItemActive(pathname, item, allSubItems),
  );

  useEffect(() => {
    fetch('/api/tickets/stats')
      .then((r) => r.json())
      .then((d) => { if (d.openCount != null) setTicketCount(d.openCount); })
      .catch(() => {});
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (configRef.current && !configRef.current.contains(e.target as Node)) setConfigOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Close dropdowns on nav
  useEffect(() => {
    setConfigOpen(false);
    setUserOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push(`/login/${brand.brandSlug}`);
  }

  return (
    <>
      {/* ── Primary Nav ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-30"
        style={{
          backgroundColor: 'var(--bg-primary)',
          borderBottom: hasSubNav ? 'none' : '1px solid var(--border-primary)',
        }}
      >
        <div className="h-14 px-5 flex items-center gap-1">
          {/* Brand */}
          <Link href="/overview" className="flex items-center gap-2.5 mr-5 flex-shrink-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
              style={{ backgroundColor: '#6366f1' }}
            >
              O
            </div>
            <span
              className="text-sm font-semibold hidden sm:block"
              style={{ color: 'var(--text-primary)' }}
            >
              Outlight
            </span>
          </Link>

          {/* Divider */}
          <div
            className="w-px h-6 mr-3 hidden sm:block"
            style={{ backgroundColor: 'var(--border-primary)' }}
          />

          {/* Module tabs */}
          <div className="flex items-center gap-0.5 flex-1 overflow-x-auto">
            {modules.map((mod) => {
              const isActive = activeModule?.id === mod.id;
              const href = mod.href ?? mod.items?.[0]?.href ?? '/';
              const ModIcon = mod.icon;

              return (
                <Link
                  key={mod.id}
                  href={href}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all whitespace-nowrap relative"
                  style={{
                    color: isActive ? mod.color : 'var(--text-secondary)',
                    backgroundColor: isActive
                      ? `color-mix(in srgb, ${mod.color} 10%, transparent)`
                      : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }
                  }}
                >
                  <ModIcon size={15} strokeWidth={isActive ? 2 : 1.5} />
                  <span className="hidden md:inline">{mod.label}</span>
                  {mod.id === 'support' && ticketCount > 0 && (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white leading-none"
                      style={{ backgroundColor: mod.color, minWidth: '18px', textAlign: 'center' }}
                    >
                      {ticketCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Theme toggle */}
            <button
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = 'var(--text-tertiary)';
              }}
              title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* Settings */}
            <Link
              href="/settings"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{
                color: pathname.startsWith('/settings') ? '#6366f1' : 'var(--text-tertiary)',
                backgroundColor: pathname.startsWith('/settings')
                  ? 'color-mix(in srgb, #6366f1 10%, transparent)'
                  : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!pathname.startsWith('/settings')) {
                  e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!pathname.startsWith('/settings')) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--text-tertiary)';
                }
              }}
            >
              <Settings size={16} />
            </Link>

            {/* User menu */}
            <div className="relative ml-1" ref={userRef}>
              <button
                onClick={() => setUserOpen(!userOpen)}
                className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg transition-colors"
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                  style={{ backgroundColor: '#6366f1' }}
                >
                  {(brand.userName ?? brand.brandName)?.[0]?.toUpperCase() ?? 'A'}
                </div>
                <ChevronDown size={12} style={{ color: 'var(--text-tertiary)' }} />
              </button>

              {userOpen && (
                <div
                  className="absolute right-0 top-full mt-1.5 w-56 rounded-xl py-1.5 z-50"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                  }}
                >
                  <div
                    className="px-3.5 py-2.5 mb-1"
                    style={{ borderBottom: '1px solid var(--border-secondary)' }}
                  >
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {brand.userName || 'Admin'}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {brand.brandName}
                    </p>
                    <span
                      className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor:
                          brand.role === 'admin'
                            ? 'color-mix(in srgb, #a855f7 12%, transparent)'
                            : 'color-mix(in srgb, #3b82f6 12%, transparent)',
                        color: brand.role === 'admin' ? '#a855f7' : '#3b82f6',
                      }}
                    >
                      {brand.role === 'admin' ? <Shield size={10} /> : <User size={10} />}
                      {brand.role?.toUpperCase()}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-sm transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ── Sub-Navigation ── */}
      {hasSubNav && (
        <div
          className="fixed top-14 left-0 right-0 z-20"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-primary)',
          }}
        >
          <div className="h-10 px-5 flex items-center gap-0.5">
            {/* Scrollable sub-nav items */}
            <div className="flex items-center gap-0.5 flex-1 overflow-x-auto">
              {activeModule?.items?.map((item) => {
                const active = isItemActive(pathname, item, allSubItems);
                const ItemIcon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] transition-all whitespace-nowrap"
                    style={{
                      color: active ? moduleColor : 'var(--text-secondary)',
                      backgroundColor: active
                        ? `color-mix(in srgb, ${moduleColor} 10%, transparent)`
                        : 'transparent',
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
                    <ItemIcon size={14} />
                    {item.label}
                    {item.badge && ticketCount > 0 && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white leading-none"
                        style={{ backgroundColor: moduleColor }}
                      >
                        {ticketCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Configure dropdown — OUTSIDE overflow container so it doesn't get clipped */}
            {activeModule?.configItems && activeModule.configItems.length > 0 && (
              <>
                <div
                  className="w-px h-5 mx-1 flex-shrink-0"
                  style={{ backgroundColor: 'var(--border-secondary)' }}
                />
                <div className="relative flex-shrink-0" ref={configRef}>
                  <button
                    onClick={() => setConfigOpen(!configOpen)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[13px] transition-colors whitespace-nowrap"
                    style={{
                      color: configItemActive ? moduleColor : 'var(--text-tertiary)',
                      backgroundColor: configItemActive
                        ? `color-mix(in srgb, ${moduleColor} 8%, transparent)`
                        : 'transparent',
                      fontWeight: configItemActive ? 500 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (!configItemActive)
                        e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (!configItemActive)
                        e.currentTarget.style.backgroundColor = configItemActive
                          ? `color-mix(in srgb, ${moduleColor} 8%, transparent)`
                          : 'transparent';
                    }}
                  >
                    <Wrench size={13} />
                    Configure
                    <ChevronDown size={11} />
                  </button>

                  {configOpen && (
                    <div
                      className="absolute right-0 top-full mt-1 w-52 rounded-xl py-1.5 z-50"
                      style={{
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-primary)',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                      }}
                    >
                      {activeModule.configItems.map((item) => {
                        const active = isItemActive(pathname, item, allSubItems);
                        const CfgIcon = item.icon;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] transition-colors"
                            style={{
                              color: active ? moduleColor : 'var(--text-secondary)',
                              backgroundColor: active
                                ? `color-mix(in srgb, ${moduleColor} 8%, transparent)`
                                : 'transparent',
                              fontWeight: active ? 500 : 400,
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = active
                                ? `color-mix(in srgb, ${moduleColor} 8%, transparent)`
                                : 'transparent';
                            }}
                          >
                            <CfgIcon size={14} />
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
