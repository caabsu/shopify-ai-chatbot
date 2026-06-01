import { TicketInbox } from '@/components/tickets/TicketInbox';

// Agent inbox: same C4 inbox as admin, minus destructive bulk-cleanup actions.
export default function AgentTicketInboxPage() {
  return <TicketInbox basePath="/agent/tickets" showAdminActions={false} title="Tickets" />;
}
