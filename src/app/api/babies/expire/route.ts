import { NextResponse, NextRequest } from 'next/server';
import { authorizeActive } from '@/lib/auth-server';
import { expireBabies } from '@/lib/babies';

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const result = await expireBabies();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('API Baby Expire Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
