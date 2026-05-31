import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { BrandProvider, type ThemeAccent } from '@/components/brand-context';
import { DashboardShell } from '@/components/dashboard-shell';
import { brandTokensFor } from '@/lib/brand-tokens';

// Per-brand admin accent. Precedence: DB override (brands.settings.console_accent)
// → canonical BRAND_TOKENS for the slug → the hardcoded [data-brand] defaults in
// globals.css. So a brand themes the console from config/source, not a code fork.
async function loadThemeAccent(brandId: string, brandSlug: string): Promise<ThemeAccent | null> {
  const fallback = (): ThemeAccent | null => {
    const t = brandTokensFor(brandSlug);
    return t ? { accent: t.accent, strong: t.accentStrong, light: t.accentLight, foreground: t.accentForeground } : null;
  };
  try {
    const { data } = await getSupabase().from('brands').select('settings').eq('id', brandId).single();
    const raw = (data?.settings as Record<string, unknown> | null)?.console_accent;
    if (!raw) return fallback();
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
    return fallback();
  } catch {
    return fallback(); // never block the dashboard on a theming lookup
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // Agents should not access admin dashboard routes
  if (session.role === 'agent') redirect('/agent/tickets');

  const themeAccent = await loadThemeAccent(session.brandId, session.brandSlug);

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
