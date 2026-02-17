'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export function Header({ brandName }: { brandName: string }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 fixed top-0 left-56 right-0 z-10">
      <div />
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">{brandName}</span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-black transition-colors"
        >
          <LogOut size={14} />
          Logout
        </button>
      </div>
    </header>
  );
}
