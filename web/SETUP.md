# Lumenless Waitlist Setup Guide

This guide will help you set up the Lumenless waitlist website with Supabase integration.

## Prerequisites

- Node.js 18+ installed
- A Supabase account (free tier works great!)

## Step 1: Supabase Setup

1. **Create a Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Click "Start your project"
   - Create a new project (choose a name, password, and region)

2. **Create the Waitlist Table**
   - Go to the SQL Editor in your Supabase dashboard
   - Run the following SQL command:

```sql
-- Create waitlist table
create table waitlist (
  id uuid default gen_random_uuid() primary key,
  email text unique not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table waitlist enable row level security;

-- Create a policy to allow inserts (so users can join the waitlist)
create policy "Allow public inserts" on waitlist
  for insert
  to anon
  with check (true);

-- Create a policy to allow reads for authenticated users only (optional - for admin dashboard)
create policy "Allow authenticated reads" on waitlist
  for select
  to authenticated
  using (true);
```

3. **Get Your Supabase Credentials**
   - Go to Settings > API
   - Copy your `Project URL`
   - Copy your `anon` `public` key

## Step 2: Environment Variables

1. Create a `.env.local` file in the root of your project:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url-here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

2. Replace `your-project-url-here` and `your-anon-key-here` with your actual Supabase credentials

## Step 3: Install Dependencies

```bash
npm install
```

## Step 4: Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see your waitlist page!

## Features

✨ **Beautiful Animations** - Built with Framer Motion for smooth, engaging interactions
🎨 **Modern UI** - Clean, responsive design that works on all devices
🔒 **Email Validation** - Built-in validation and duplicate checking
💾 **Supabase Integration** - Secure, scalable database storage
🌓 **Dark Mode Support** - Automatic dark mode support

## Optional: View Your Waitlist Data

You can view all waitlist signups in your Supabase dashboard:

1. Go to your Supabase project
2. Click on "Table Editor"
3. Select the "waitlist" table
4. See all email addresses that have joined!

## Deployment

This app is ready to deploy to Vercel:

1. Push your code to GitHub
2. Import your repository on Vercel
3. Add your environment variables in the Vercel dashboard
4. Deploy!

Remember to add your environment variables in your deployment platform's settings.

## Need Help?

Check the [Supabase Documentation](https://supabase.com/docs) for more information about database management and API usage.

