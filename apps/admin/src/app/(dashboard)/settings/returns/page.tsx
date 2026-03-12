'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SettingsReturnsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/returns/rules');
  }, [router]);

  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Redirecting to Return Rules...</p>
    </div>
  );
}
