'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  BookOpen,
  Brain,
  TestTube,
  ToggleLeft,
  Zap,
  Settings,
  Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/conversations', label: 'Conversations', icon: MessageSquare },
  { href: '/knowledge', label: 'Knowledge Base', icon: BookOpen },
  { href: '/ai-config', label: 'AI Config', icon: Brain },
  { href: '/design', label: 'Design', icon: Palette },
  { href: '/playground', label: 'Playground', icon: TestTube },
  { href: '/features', label: 'Feature Toggles', icon: ToggleLeft },
  { href: '/capabilities', label: 'Capabilities', icon: Zap },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col h-screen fixed left-0 top-0">
      <div className="px-4 py-5 border-b border-gray-200">
        <h1 className="text-base font-semibold">AI Chatbot</h1>
        <p className="text-xs text-gray-500 mt-0.5">Admin Dashboard</p>
      </div>
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-gray-100 text-black font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-black'
              )}
            >
              <item.icon size={16} strokeWidth={active ? 2 : 1.5} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
