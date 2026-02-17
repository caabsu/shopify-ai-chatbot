import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <Header brandName={session.brandName} />
      <main className="ml-56 pt-14">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
