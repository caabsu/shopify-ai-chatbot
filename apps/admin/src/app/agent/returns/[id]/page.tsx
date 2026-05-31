'use client';

import { use } from 'react';
import { ReturnDetail } from '@/components/returns/ReturnDetail';

export default function AgentReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReturnDetail id={id} backHref="/agent/returns" />;
}
