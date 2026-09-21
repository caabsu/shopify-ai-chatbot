'use client';

import { usePathname } from 'next/navigation';
import { Navigation } from './navigation';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hasModuleTabs = /^\/(returns|reviews|tracking|chatbot)(\/|$)/.test(pathname);
  return <div className="os-app"><Navigation /><main id="main-content" className={`os-main ${hasModuleTabs ? 'has-module-tabs' : ''}`}><div className="os-page">{children}</div></main></div>;
}
