import { NextResponse } from 'next/server';
function retired() { return NextResponse.json({ error: 'Moderation has moved to Lumenless Business.' }, { status: 410 }); }
export const GET = retired;
export const POST = retired;
