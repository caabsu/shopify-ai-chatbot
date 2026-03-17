'use client';

import { createContext, useContext } from 'react';
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
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext);
}
