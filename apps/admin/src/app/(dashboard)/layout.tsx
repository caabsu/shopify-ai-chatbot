import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { BrandProvider } from '@/components/brand-context';
import { DashboardShell } from '@/components/dashboard-shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // Agents should not access admin dashboard routes
  if (session.role === 'agent') redirect('/agent/tickets');

  return (
    <BrandProvider value={{
      brandId: session.brandId,
      brandName: session.brandName,
      brandSlug: session.brandSlug,
      role: session.role ?? 'admin',
      userName: session.name,
      userEmail: session.email,
    }}>
      <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <DashboardShell>{children}</DashboardShell>
      </div>
    </BrandProvider>
  );
}
