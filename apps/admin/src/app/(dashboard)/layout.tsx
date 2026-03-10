import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { BrandProvider } from '@/components/brand-context';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <BrandProvider value={{ brandId: session.brandId, brandName: session.brandName, brandSlug: session.brandSlug }}>
      <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <Sidebar />
        <Header brandName={session.brandName} brandSlug={session.brandSlug} />
        <main className="ml-56 pt-14">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </BrandProvider>
  );
}
