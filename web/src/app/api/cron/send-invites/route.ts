import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const BATCH_SIZE = 10;

// TEST MODE: Only send to this email. Remove to send to all waitlist entries.
const TEST_EMAIL = '';// 'mike@dangervalley.com';

export async function GET(request: Request) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch waitlist entries that haven't been invited yet (oldest first)
  let query = supabase
    .from('waitlist')
    .select('id, email')
    .is('invited_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  // TEST MODE: only fetch the test email
  if (TEST_EMAIL) {
    query = query.eq('email', TEST_EMAIL);
  }

  const { data: entries, error: fetchError } = await query;

  if (fetchError) {
    console.error('Failed to fetch waitlist entries:', fetchError);
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }

  if (!entries || entries.length === 0) {
    return NextResponse.json({ message: 'No pending invites', sent: 0 });
  }

  const results: { email: string; success: boolean; error?: string }[] = [];

  for (const entry of entries) {
    try {
      await resend.emails.send({
        from: 'Lumenless <invite@lumenless.com>',
        to: entry.email,
        subject: "You're invited to test Lumenless on Solana Mobile",
        html: getInviteEmailHtml(),
      });

      // Mark as invited
      const { error: updateError } = await supabase
        .from('waitlist')
        .update({ invited_at: new Date().toISOString() })
        .eq('id', entry.id);

      if (updateError) {
        console.error(`Failed to mark ${entry.email} as invited:`, updateError);
      }

      results.push({ email: entry.email, success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Failed to send invite to ${entry.email}:`, message);
      results.push({ email: entry.email, success: false, error: message });
    }
  }

  const sent = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`Invite batch complete: ${sent} sent, ${failed} failed`);

  return NextResponse.json({ sent, failed, results });
}

function getInviteEmailHtml(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:40px 40px 20px;text-align:center;">
              <h1 style="color:#ffffff;font-size:28px;margin:0 0 8px;">Lumenless</h1>
              <p style="color:#888888;font-size:14px;margin:0;">Private invoices on Solana</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;">
              <h2 style="color:#ffffff;font-size:22px;margin:0 0 16px;">You're invited to test Lumenless!</h2>
              <p style="color:#cccccc;font-size:16px;line-height:1.6;margin:0 0 16px;">
                Thank you for joining our waitlist. We're excited to invite you to be among the first to try Lumenless — private, shielded invoices on Solana.
              </p>
              <p style="color:#cccccc;font-size:16px;line-height:1.6;margin:0 0 24px;">
                The Lumenless app is now available for testing on the <strong style="color:#ffffff;">Solana Mobile dApp Store</strong>. Download it today and experience truly private invoices.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 20px;">
              <h3 style="color:#ffffff;font-size:16px;margin:0 0 12px;">How to get started:</h3>
              <ol style="color:#cccccc;font-size:14px;line-height:1.8;margin:0;padding-left:20px;">
                <li>Open the <strong style="color:#ffffff;">Solana Mobile dApp Store</strong> on your device</li>
                <li>Search for <strong style="color:#ffffff;">"Lumenless"</strong></li>
                <li>Install the app and create your account</li>
                <li>Start sending invoices privately</li>
              </ol>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 40px;">
              <p style="color:#888888;font-size:13px;line-height:1.5;margin:0;border-top:1px solid #222222;padding-top:20px;">
                You're receiving this because you signed up for the Lumenless waitlist. If you believe this was sent in error, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
