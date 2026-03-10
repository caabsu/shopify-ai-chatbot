import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'Support <onboarding@resend.dev>';

export async function sendTicketReplyEmail(opts: {
  to: string;
  customerName?: string;
  ticketNumber: number;
  subject: string;
  replyContent: string;
  agentName?: string;
  brandName?: string;
}): Promise<{ messageId?: string; error?: string }> {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping email');
    return { error: 'Email not configured' };
  }

  const { to, customerName, ticketNumber, subject, replyContent, agentName, brandName } = opts;
  const brand = brandName || 'Support';
  const greeting = customerName ? `Hi ${customerName},` : 'Hi,';
  const signature = agentName ? `${agentName}\n${brand} Team` : `${brand} Team`;

  const emailSubject = `Re: [Ticket #${ticketNumber}] ${subject}`;

  const textBody = `${greeting}

${replyContent}

---
${signature}

Ticket #${ticketNumber} — Please reply to this email to continue the conversation.`;

  const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>${greeting}</p>
  <div style="white-space: pre-wrap; line-height: 1.6;">${escapeHtml(replyContent)}</div>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #888; font-size: 13px;">
    ${escapeHtml(signature).replace(/\n/g, '<br>')}<br><br>
    <span style="color: #aaa;">Ticket #${ticketNumber} — Reply to this email to continue the conversation.</span>
  </p>
</div>`;

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [to],
      subject: emailSubject,
      text: textBody,
      html: htmlBody,
      headers: {
        'X-Ticket-Number': String(ticketNumber),
      },
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return { error: error.message };
    }

    console.log(`[email] Sent reply for ticket #${ticketNumber} to ${to} (id: ${data?.id})`);
    return { messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email] Failed to send:', msg);
    return { error: msg };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
