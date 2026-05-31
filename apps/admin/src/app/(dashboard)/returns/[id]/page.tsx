'use client';

import { use } from 'react';
import { ReturnDetail } from '@/components/returns/ReturnDetail';

export default function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReturnDetail id={id} backHref="/returns" />;
}
