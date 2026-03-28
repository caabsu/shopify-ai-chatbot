'use client';

import { usePathname } from 'next/navigation';
import { Navigation } from './navigation';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Sub-nav is shown for all module pages except overview and settings
  const isOverview = pathname === '/overview';
  const isSettings = pathname.startsWith('/settings');
  const hasSubNav = !isOverview && !isSettings;

  return (
    <>
      <Navigation />
      <main style={{ paddingTop: hasSubNav ? '96px' : '56px' }}>
        <div className="px-6 sm:px-8 py-6 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </>
  );
}
