'use client';

import { createContext, useContext, useEffect } from 'react';
import type { UserRole } from '@/lib/auth';

interface BrandSession {
  brandId: string;
  brandName: string;
  brandSlug: string;
  role: UserRole;
  userName?: string;
  userEmail?: string;
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
  // Drive per-brand accent theming: globals.css defines [data-brand="..."] overrides
  // so the whole OS re-skins to the active brand's accent.
  useEffect(() => {
    if (value.brandSlug) {
      document.documentElement.dataset.brand = value.brandSlug;
    }
    return () => { delete document.documentElement.dataset.brand; };
  }, [value.brandSlug]);

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext);
}
