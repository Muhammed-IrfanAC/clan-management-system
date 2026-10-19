import { NextResponse, after } from 'next/server';
import { handleInteraction, verifyInteraction, type Interaction } from '@/lib/discord/interactions';

/**
 * The Discord Interactions Endpoint (set as "Interactions Endpoint URL" in the Developer Portal).
 *
 * Authenticated by Discord's Ed25519 signature, NOT the session cookie — this is Discord calling us,
 * and the caller's identity is the Discord user inside the verified body. The raw body must be read
 * as text before parsing, since the signature covers the exact bytes.
 *
 * Discord requires an answer within 3 seconds. Slow handlers defer: the response here is the
 * "thinking…" acknowledgement, and `after()` fills the reply in once it has been sent.
 */

// The deferred work runs inside this budget. Interaction tokens last 15 minutes; a lookup needs
// nowhere near that, but a cold start plus the CoC API can take more than a few seconds.
export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const valid = verifyInteraction({
    rawBody,
    signature: request.headers.get('x-signature-ed25519'),
    timestamp: request.headers.get('x-signature-timestamp'),
    publicKeyHex: process.env.DISCORD_PUBLIC_KEY,
  });
  if (!valid) return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 });

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Malformed body' }, { status: 400 });
  }

  const { body, background } = await handleInteraction(interaction);
  if (background) after(background);
  return NextResponse.json(body);
}
