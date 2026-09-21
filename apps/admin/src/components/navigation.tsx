'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Activity, ArrowUpRight, BookOpen, Command, Headphones, Inbox, LayoutDashboard, LogOut, Menu, MessageSquare, Moon, RotateCcw, Settings, ShieldCheck, Sparkles, Star, Sun, Truck, X } from 'lucide-react';
import { useBrand } from './brand-context';
import { useTheme } from './theme-provider';

const workspace = [
  { href: '/overview', label: 'Command center', icon: LayoutDashboard },
  { href: '/support', label: 'Support inbox', icon: Inbox },
  { href: '/autopilot', label: 'Plan review', icon: Sparkles },
  { href: '/tickets', label: 'All tickets', icon: Headphones },
  { href: '/activity', label: 'Activity', icon: Activity },
];
const intelligence = [
  { href: '/knowledge', label: 'Knowledge library', icon: BookOpen },
  { href: '/support/settings', label: 'Automation rules', icon: ShieldCheck },
  { href: '/chatbot/conversations', label: 'Chat conversations', icon: MessageSquare },
];
const operations = [
  { href: '/returns', label: 'Returns', icon: RotateCcw },
  { href: '/reviews', label: 'Reviews', icon: Star },
  { href: '/tracking/insights', label: 'Order tracking', icon: Truck },
];
const sectionLinks: Record<string, Array<[string, string]>> = {
  returns: [['/returns', 'Requests'], ['/returns/rma', 'RMA sync'], ['/returns/rules', 'Rules'], ['/returns/analytics', 'Analytics'], ['/returns/emails', 'Emails'], ['/returns/settings', 'Settings'], ['/returns/label-presets', 'Labels'], ['/returns/design', 'Design'], ['/returns/playground', 'Preview']],
  reviews: [['/reviews', 'Reviews'], ['/reviews/products', 'Products'], ['/reviews/analytics', 'Analytics'], ['/reviews/import', 'Import'], ['/reviews/widgets', 'Widgets'], ['/reviews/emails', 'Emails'], ['/reviews/settings', 'Settings']],
  tracking: [['/tracking/insights', 'Insights'], ['/tracking/design', 'Design'], ['/tracking/playground', 'Preview'], ['/tracking/settings', 'Settings']],
  chatbot: [['/chatbot/conversations', 'Conversations'], ['/chatbot/ai-config', 'AI config'], ['/chatbot/capabilities', 'Capabilities'], ['/chatbot/features', 'Features'], ['/chatbot/design', 'Widget'], ['/chatbot/playground', 'Playground'], ['/chatbot/design-agent', 'Design agent']],
};

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const brand = useBrand();
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const module = pathname.split('/')[1];
  const current = [...workspace, ...intelligence, ...operations].find(item => pathname === item.href)?.label || module.replace(/-/g, ' ');
  const active = (href: string) => pathname === href || (href !== '/support' && pathname.startsWith(`${href}/`));
  const group = (label: string, items: typeof workspace) => <div className="os-nav-group"><p>{label}</p>{items.map(({ href, label: title, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`os-nav-link ${active(href) ? 'is-active' : ''}`} aria-current={active(href) ? 'page' : undefined}><Icon size={17} strokeWidth={1.7} /><span>{title}</span>{href === '/support' && <span className="os-live-dot" />}</Link>)}</div>;

  return <>
    {mobileOpen && <button className="os-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`os-sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <Link className="os-wordmark" href="/overview"><span className="os-logo"><Command size={22} /></span>support<span>OS</span><small>WORKSPACE</small></Link>
      <div className="os-brand"><div className="os-brand-avatar">{(brand.brandName || 'S').slice(0, 1)}</div><div><strong>{brand.brandName || 'Support workspace'}</strong><span>Customer experience</span></div></div>
      <nav aria-label="Main navigation">{group('Workspace', workspace)}{group('Intelligence', intelligence)}{group('Store operations', operations)}</nav>
      <div className="os-sidebar-bottom"><Link href="/support/settings" className="os-engine-card"><span className="os-engine-symbol"><Sparkles size={17} /></span><div><strong>Thoughtful automation</strong><span>Your rules. Every action visible.</span></div><ArrowUpRight size={13} /></Link><Link className="os-nav-link" href="/settings"><Settings size={17} />Workspace settings</Link><div className="os-profile"><span className="os-user-avatar">{(brand.userName || brand.brandName || 'A').slice(0, 1)}</span><div><strong>{brand.userName || 'Administrator'}</strong><span>{brand.role === 'agent' ? 'Support agent' : 'Workspace admin'}</span></div><button title="Sign out" aria-label="Sign out" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push(`/login/${brand.brandSlug}`); }}><LogOut size={15} /></button></div></div>
    </aside>
    <header className="os-topbar"><div className="flex items-center gap-3"><button className="os-menu-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button><span className="os-breadcrumb">Workspace <span>/</span> <strong>{current}</strong></span></div><div className="flex items-center gap-3"><span className="os-topbar-label">Customer care, considered.</span><button className="os-icon-button" aria-label="Toggle color theme" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>{resolvedTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><Link href="/settings" className="os-user-avatar" aria-label="Your workspace settings">{(brand.userName || 'A').slice(0, 1)}</Link></div></header>
    {sectionLinks[module] && <nav className="os-module-tabs" aria-label={`${module} navigation`}>{sectionLinks[module].map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>)}</nav>}
  </>;
}
