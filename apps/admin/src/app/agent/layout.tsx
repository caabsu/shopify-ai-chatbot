import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { AgentSidebar } from '@/components/agent-sidebar';
import { Header } from '@/components/header';
import { BrandProvider } from '@/components/brand-context';

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // Admins can also view agent workspace, but agents are the primary users
  const role = session.role ?? 'admin';

  return (
    <BrandProvider value={{
      brandId: session.brandId,
      brandName: session.brandName,
      brandSlug: session.brandSlug,
      role,
      userName: session.name,
      userEmail: session.email,
    }}>
      <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <AgentSidebar userName={session.name} />
        <Header brandName={session.brandName} brandSlug={session.brandSlug} userName={session.name} role={role} />
        <main className="ml-56 pt-14">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </BrandProvider>
  );
}
