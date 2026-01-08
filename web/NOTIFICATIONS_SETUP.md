# Telegram Waitlist Notifications Setup

Get instant Telegram notifications when someone joins your waitlist! 📱

## Setup Guide

### Step 1: Create a Telegram Bot
1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` command
3. Follow the instructions to create your bot
4. Copy the **Bot Token** (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Step 2: Get Your Chat ID
1. Search for [@userinfobot](https://t.me/userinfobot) on Telegram
2. Start a chat with it
3. Copy your **Chat ID** (a number like: `123456789`)

### Step 3: Deploy Supabase Edge Function

#### Install Supabase CLI (if not already installed):
```bash
npm install -g supabase
```

#### Login to Supabase:
```bash
supabase login
```

#### Link your project:
```bash
supabase link --project-ref your-project-ref
```
(Find your project ref in Supabase Dashboard → Settings → General → Reference ID)

#### Set the Telegram secrets:
```bash
supabase secrets set TELEGRAM_BOT_TOKEN=your-bot-token-here
supabase secrets set TELEGRAM_CHAT_ID=your-chat-id-here
```

#### Deploy the Edge Function:
```bash
supabase functions deploy notify-waitlist
```

### Step 4: Create Database Trigger

You have two options to trigger the notification:

#### Option A: Using Database Webhooks (Easier)
1. Go to **Supabase Dashboard → Database → Database Webhooks**
2. Click "Create a new hook" or "Enable Webhooks"
3. Configure:
   - **Name**: `notify_waitlist_telegram`
   - **Table**: `waitlist`
   - **Events**: Check `INSERT`
   - **Type**: `Supabase Edge Functions`
   - **Edge Function**: Select `notify-waitlist`
4. Save the webhook

#### Option B: Using SQL Trigger (More reliable)
Run this SQL in your Supabase SQL Editor:

```sql
-- Enable HTTP extension
create extension if not exists http with schema extensions;

-- Create a function to call the Edge Function
create or replace function notify_waitlist()
returns trigger
language plpgsql
security definer
as $$
declare
  request_id bigint;
  project_url text := 'https://your-project-ref.supabase.co'; -- Replace with your project URL
  service_role_key text := 'your-service-role-key'; -- Replace with your service role key
begin
  -- Call the Edge Function
  perform extensions.http((
    'POST',
    project_url || '/functions/v1/notify-waitlist',
    ARRAY[extensions.http_header('Content-Type', 'application/json'),
          extensions.http_header('Authorization', 'Bearer ' || service_role_key)],
    'application/json',
    json_build_object(
      'type', 'INSERT',
      'table', 'waitlist',
      'record', row_to_json(NEW)
    )::text
  )::extensions.http_request);
  
  return NEW;
end;
$$;

-- Create the trigger
drop trigger if exists on_waitlist_insert on waitlist;
create trigger on_waitlist_insert
  after insert on waitlist
  for each row
  execute function notify_waitlist();
```

**Important:** Replace `your-project-ref` and `your-service-role-key` with your actual values from:
- Project URL: Settings → API → Project URL
- Service Role Key: Settings → API → service_role key (keep this secret!)

**Done!** You'll now receive Telegram messages for each signup! 📲

---

## Testing Your Setup

### Test the Edge Function directly:
```bash
curl -X POST "https://your-project-ref.supabase.co/functions/v1/notify-waitlist" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "type": "INSERT",
    "table": "waitlist",
    "record": {
      "email": "test@example.com",
      "created_at": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
    }
  }'
```

### Test Telegram Bot directly:
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id":"YOUR_CHAT_ID","text":"Test message from Lumenless Waitlist! 🎉"}'
```

Or just add a test email to your waitlist form!

---

## Troubleshooting

**Not receiving notifications?**

1. **Check Edge Function logs:**
   ```bash
   supabase functions logs notify-waitlist
   ```

2. **Verify secrets are set:**
   ```bash
   supabase secrets list
   ```

3. **Test Telegram bot token:**
   ```bash
   curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getMe"
   ```
   Should return bot information

4. **Verify Chat ID:**
   - Send a message to your bot
   - Visit: `https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates`
   - Look for your chat ID in the response

---

## Need Help?

- **Telegram Bots**: [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- **Supabase Edge Functions**: [Supabase Functions Guide](https://supabase.com/docs/guides/functions)
- **Supabase CLI**: [CLI Reference](https://supabase.com/docs/reference/cli/introduction)

