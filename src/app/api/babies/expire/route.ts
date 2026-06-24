import { NextResponse, NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { expireBabies } from '@/lib/babies';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
      await jwtVerify(token, JWT_SECRET);
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const result = await expireBabies();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('API Baby Expire Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
