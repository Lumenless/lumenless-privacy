import { NextResponse } from 'next/server';
import { privateResponse } from '@/lib/business/session';
// Credential export is retired, including for old cookies containing tokens.
export async function POST() {
  return privateResponse(NextResponse.json({ error: 'Credentials are stored on the server. Export is disabled.' }, { status: 410 }));
}
