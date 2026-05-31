import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { BrandProvider, type ThemeAccent } from '@/components/brand-context';
import { DashboardShell } from '@/components/dashboard-shell';

// Optional per-brand admin accent, driven from the DB so a new brand themes the
// console from config (brands.settings.console_accent) instead of a code fork.
// Falls back to the hardcoded [data-brand] defaults in globals.css when absent.
async function loadThemeAccent(brandId: string): Promise<ThemeAccent | null> {
  try {
    const { data } = await getSupabase().from('brands').select('settings').eq('id', brandId).single();
    const raw = (data?.settings as Record<string, unknown> | null)?.console_accent;
    if (!raw) return null;
    if (typeof raw === 'string') return { accent: raw };
    if (typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (typeof o.accent === 'string') {
        return {
          accent: o.accent,
          strong: typeof o.strong === 'string' ? o.strong : undefined,
          light: typeof o.light === 'string' ? o.light : undefined,
          foreground: typeof o.foreground === 'string' ? o.foreground : undefined,
        };
      }
    }
    return null;
  } catch {
    return null; // never block the dashboard on a theming lookup
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // Agents should not access admin dashboard routes
  if (session.role === 'agent') redirect('/agent/tickets');

  const themeAccent = await loadThemeAccent(session.brandId);

  return (
    <BrandProvider value={{
      brandId: session.brandId,
      brandName: session.brandName,
      brandSlug: session.brandSlug,
      role: session.role ?? 'admin',
      userName: session.name,
      userEmail: session.email,
      themeAccent,
    }}>
      <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <DashboardShell>{children}</DashboardShell>
      </div>
    </BrandProvider>
  );
}
