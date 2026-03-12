'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DesignRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/chatbot/design');
  }, [router]);

  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Redirecting to Widget Design...</p>
    </div>
  );
}
