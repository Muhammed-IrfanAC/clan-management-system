import { NextResponse, NextRequest } from 'next/server';
import { authorizeActiveView } from '@/lib/auth-server';
import { loadFamilyStrength } from '@/lib/cwl/familyStrengthLoad';

/**
 * The Strength page: every active family account ranked by the attack model (familyStrength.ts),
 * with its label, mirror chance, league share and war record. Read-only; the live role check runs
 * alongside the read (see authorizeActiveView).
 */
export async function GET(request: NextRequest) {
  try {
    const view = await authorizeActiveView(request, () => loadFamilyStrength());
    return view.error ?? NextResponse.json(view.data);
  } catch (error) {
    console.error('API Strength View Error:', error);
    return NextResponse.json({ error: 'Failed to load strength' }, { status: 500 });
  }
}
