'use client';

import { use } from 'react';
import { TicketDetail } from '@/components/tickets/TicketDetail';

export default function AgentTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TicketDetail ticketId={id} basePath="/agent/tickets" />;
}
