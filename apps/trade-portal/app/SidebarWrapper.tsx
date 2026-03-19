'use client';
import { usePathname } from 'next/navigation';
import Sidebar from '../components/sidebar';

export default function SidebarWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === '/login' || pathname.startsWith('/login');

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, padding: '2rem 2.5rem', background: '#fafaf9' }}>
        {children}
      </main>
    </div>
  );
}
