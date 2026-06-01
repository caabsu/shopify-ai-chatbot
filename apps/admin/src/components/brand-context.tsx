'use client';

import { createContext, useContext, useEffect } from 'react';
import type { UserRole } from '@/lib/auth';

export interface ThemeAccent {
  accent: string;
  strong?: string;
  light?: string;
  foreground?: string;
}

interface BrandSession {
  brandId: string;
  brandName: string;
  brandSlug: string;
  role: UserRole;
  userName?: string;
  userEmail?: string;
  themeAccent?: ThemeAccent | null;
}

const BrandContext = createContext<BrandSession>({
  brandId: '',
  brandName: '',
  brandSlug: '',
  role: 'admin',
});

export function BrandProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: BrandSession;
}) {
  // Unified design: supportOS uses ONE accent for every brand (see globals.css).
  // data-brand is still tagged for metadata/analytics; themeAccent remains only as
  // an optional escape hatch and is null by default, so the console looks identical
  // no matter which brand is active.
  const accentKey = value.themeAccent ? JSON.stringify(value.themeAccent) : '';
  useEffect(() => {
    const root = document.documentElement;
    if (value.brandSlug) root.dataset.brand = value.brandSlug;

    const a = value.themeAccent;
    if (a?.accent) {
      root.style.setProperty('--color-accent', a.accent);
      if (a.strong) root.style.setProperty('--color-accent-strong', a.strong);
      if (a.light) root.style.setProperty('--color-accent-light', a.light);
      if (a.foreground) root.style.setProperty('--color-accent-foreground', a.foreground);
    }

    return () => {
      delete root.dataset.brand;
      root.style.removeProperty('--color-accent');
      root.style.removeProperty('--color-accent-strong');
      root.style.removeProperty('--color-accent-light');
      root.style.removeProperty('--color-accent-foreground');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.brandSlug, accentKey]);

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext);
}
