import { NextResponse } from 'next/server';
function retired() { return NextResponse.json({ error: 'Connect X through Lumenless Business.' }, { status: 410 }); }
export const GET = retired;
export const POST = retired;
