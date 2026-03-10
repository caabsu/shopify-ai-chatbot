'use client';

import { createContext, useContext } from 'react';

interface BrandSession {
  brandId: string;
  brandName: string;
  brandSlug: string;
}

const BrandContext = createContext<BrandSession>({
  brandId: '',
  brandName: '',
  brandSlug: '',
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
