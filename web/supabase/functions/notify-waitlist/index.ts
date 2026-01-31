// Supabase Edge Function to send Telegram notifications when someone joins the waitlist
// Deploy with: supabase functions deploy notify-waitlist

// Deno type declarations for Edge Functions (fixes "Cannot find name 'Deno'" in IDE)
declare global {
  const Deno: {
    env: {
      get(key: string): string | undefined;
    };
  };
}

// @ts-ignore: Deno imports work in Supabase Edge Functions runtime
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

interface WaitlistRecord {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: {
    id: string;
    email: string;
    created_at: string;
  };
  old_record: null | any;
}

serve(async (req) => {
  try {
    const payload: WaitlistRecord = await req.json();
    
    // Only process INSERT events
    if (payload.type !== 'INSERT') {
      return new Response('Not an INSERT event', { status: 200 });
    }

    const { email, created_at } = payload.record;
    const date = new Date(created_at).toLocaleString();

    // Check if Telegram credentials are configured
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return new Response('Telegram credentials not configured', { status: 500 });
    }

    // Send Telegram notification
    const message = `🎉 *New Waitlist Signup!*\n\n📧 Email: \`${email}\`\n🕐 Time: ${date}`;
    
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Telegram API error:', error);
      return new Response(`Telegram API error: ${error}`, { status: 500 });
    }

    return new Response('Notification sent!', { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

