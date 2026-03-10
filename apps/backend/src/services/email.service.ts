import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'Support <onboarding@resend.dev>';

export function isEmailConfigured(): boolean {
  return resend !== null;
}

export async function sendTicketConfirmation(opts: {
  to: string;
  customerName?: string;
  ticketNumber: number;
  subject: string;
  brandName?: string;
}): Promise<{ messageId?: string; error?: string }> {
  if (!resend) return { error: 'Email not configured' };

  const { to, customerName, ticketNumber, subject, brandName } = opts;
  const brand = brandName || 'Support';
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';

  const emailSubject = `[Ticket #${ticketNumber}] ${subject}`;

  const textBody = `${greeting}

Thank you for reaching out. We've received your message and created ticket #${ticketNumber} for you.

Our team will review your request and get back to you as soon as possible. You can reply to this email to add more information.

---
${brand} Team`;

  const htmlBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <p>${greeting}</p>
  <p>Thank you for reaching out. We've received your message and created <strong>ticket #${ticketNumber}</strong> for you.</p>
  <p>Our team will review your request and get back to you as soon as possible. You can reply to this email to add more information.</p>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 13px;">${escapeHtml(brand)} Team</p>
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

    console.log(`[email] Sent confirmation for ticket #${ticketNumber} to ${to}`);
    return { messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email] Failed to send confirmation:', msg);
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
