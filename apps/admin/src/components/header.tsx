'use client';

import { useRouter } from 'next/navigation';
import { LogOut, Sun, Moon, Shield, User } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import type { UserRole } from '@/lib/auth';

export function Header({
  brandName,
  brandSlug,
  userName,
  role,
}: {
  brandName: string;
  brandSlug: string;
  userName?: string;
  role?: UserRole;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const isAgent = role === 'agent';

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push(`/login/${brandSlug}`);
  }

  function toggleTheme() {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }

  return (
    <header
      className="h-14 flex items-center justify-between px-6 fixed top-0 right-0 z-10"
      style={{
        backgroundColor: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-primary)',
        left: isAgent ? '14rem' : '14rem',
      }}
    >
      <div />
      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="w-px h-6" style={{ backgroundColor: 'var(--border-primary)' }} />

        {/* Role badge */}
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider"
          style={{
            backgroundColor: isAgent ? 'rgba(59,130,246,0.1)' : 'rgba(168,85,247,0.1)',
            color: isAgent ? '#3b82f6' : '#a855f7',
          }}
        >
          {isAgent ? <User size={10} /> : <Shield size={10} />}
          {role ?? 'admin'}
        </span>

        {userName && (
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {userName}
          </span>
        )}

        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {brandName}
        </span>

        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          <LogOut size={14} />
          Logout
        </button>
      </div>
    </header>
  );
}
